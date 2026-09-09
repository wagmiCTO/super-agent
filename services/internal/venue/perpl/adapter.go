package perpl

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

// blockInterval is how long a Monad block takes. Measured against the live API
// on 2026-09-08: 3687 blocks in 1115 seconds on testnet, 4323 in 1314 on
// mainnet — ~302 ms both times. It is used only to express order_ttl_blocks as
// a duration for the engine; every order still computes its own last execution
// block from the heartbeat.
const blockInterval = 302 * time.Millisecond

// contextTTL bounds how stale the cached market configuration may get. Fee
// tiers, order TTL and decimals all change without notice.
const contextTTL = 30 * time.Second

// Adapter is the Perpl implementation of venue.Adapter.
var _ venue.Adapter = (*Adapter)(nil)

// Adapter is the Perpl implementation of venue.Adapter.
type Adapter struct {
	cfg   Config
	log   *slog.Logger
	rest  *restClient
	md    *mdClient
	trade *tradingClient

	mu           sync.Mutex
	ctxFetchedAt time.Time
	markets      map[string]market // by symbol
	byID         map[int]market
	collateral   token

	// clientIDs maps our idempotency key onto the venue's request id, and
	// resting orders onto the venue's order id so Cancel can find them.
	reqByClient     map[string]uint64
	clientByReq     map[uint64]string
	orderIDByClient map[string]uint64
	marketByClient  map[string]int

	positions map[uint64]position

	// marks is the live mark price per market from the market-state stream.
	// Unrealized PnL is valued against it; the context's snapshot is only a
	// fallback until the first frame arrives.
	marks    map[int]fixed.D
	markFeed sync.Once
}

// New builds an adapter. Without credentials the trading methods return
// venue.ErrNoCredentials and market data still works, which is what keeps
// market-data development unblocked while an exchange account is provisioned.
func New(ctx context.Context, cfg Config, log *slog.Logger) (*Adapter, error) {
	if log == nil {
		log = slog.Default()
	}
	if cfg.Network.APIURL == "" {
		cfg.Network = Testnet
	}
	if cfg.Network.Name == Mainnet.Name {
		log.Warn("perpl adapter is on MAINNET — orders will move real money",
			"exchange", cfg.Network.ExchangeAddress)
	}

	a := &Adapter{
		cfg:             cfg,
		log:             log,
		md:              newMDClient(cfg.Network.WSURL, log),
		markets:         make(map[string]market),
		byID:            make(map[int]market),
		reqByClient:     make(map[string]uint64),
		clientByReq:     make(map[uint64]string),
		orderIDByClient: make(map[string]uint64),
		marketByClient:  make(map[string]int),
		positions:       make(map[uint64]position),
		marks:           make(map[int]fixed.D),
	}

	var sgn *signer
	if cfg.HasCredentials() {
		var err error
		sgn, err = newSigner(cfg.APIKey, cfg.APIKeySecret, cfg.Network.ChainID)
		if err != nil {
			return nil, err
		}
	}
	a.rest = newRESTClient(cfg.Network.APIURL, cfg.HTTPTimeout, sgn)

	if _, err := a.refreshContext(ctx); err != nil {
		return nil, err
	}

	if sgn != nil {
		a.trade = newTradingClient(cfg.Network.WSURL, sgn, cfg.AccountID, log)
		// Subscribe before connecting so the initial snapshots are seen.
		go a.trackPositions(ctx, a.trade.subscribePositions(256))
		go a.trackOrders(ctx, a.trade.subscribeOrders(256))
		if err := a.trade.start(ctx); err != nil {
			return nil, err
		}
		// A trading adapter values positions continuously; start the mark
		// feed now rather than on the first Positions call.
		a.startMarkFeed(ctx)
	}
	return a, nil
}

// startMarkFeed subscribes to the venue's market-state stream once and keeps
// the latest mark per market. Frames arrive every block, so a position's
// unrealized PnL moves at the venue's own cadence instead of freezing on the
// mark the context happened to carry when it was last fetched.
func (a *Adapter) startMarkFeed(ctx context.Context) {
	a.markFeed.Do(func() {
		stream := fmt.Sprintf("market-state@%d", a.cfg.Network.ChainID)
		err := a.md.subscribe(ctx, stream, func(mt int, raw []byte) {
			if mt != msgMarketState {
				return
			}
			var msg marketStateUpdate
			if err := jsonUnmarshal(raw, &msg); err != nil {
				return
			}
			a.mu.Lock()
			defer a.mu.Unlock()
			for idStr, st := range msg.Data {
				id, err := strconv.Atoi(idStr)
				if err != nil {
					continue
				}
				m, ok := a.byID[id]
				if !ok || st.Mark <= 0 {
					continue
				}
				if mark, err := fixed.FromScaled(st.Mark, m.Config.PriceDecimals); err == nil {
					a.marks[id] = mark
				}
			}
		})
		if err != nil {
			a.log.Warn("perpl: mark feed not started; PnL will use the context snapshot", "err", err)
		}
	})
}

// markFor returns the live mark for a market, falling back to the context
// snapshot. ok is false when neither is usable.
func (a *Adapter) markFor(m market) (fixed.D, bool) {
	a.mu.Lock()
	live, ok := a.marks[m.ID]
	a.mu.Unlock()
	if ok && live.IsPos() {
		return live, true
	}
	mark, err := fixed.FromScaled(m.State.Mark, m.Config.PriceDecimals)
	if err != nil || !mark.IsPos() {
		return 0, false
	}
	return mark, true
}

// Name identifies the venue.
func (a *Adapter) Name() string { return "perpl" }

// WalletAddress is the wallet that owns the trading account, or "" without
// credentials.
func (a *Adapter) WalletAddress() string {
	if a.trade == nil {
		return ""
	}
	return a.trade.currentAccount().Address
}

// Close releases both sockets.
func (a *Adapter) Close() error {
	a.md.close()
	if a.trade != nil {
		a.trade.close()
	}
	return nil
}

// --- market data ---

func (a *Adapter) refreshContext(ctx context.Context) (map[string]market, error) {
	a.mu.Lock()
	if time.Since(a.ctxFetchedAt) < contextTTL && len(a.markets) > 0 {
		out := a.markets
		a.mu.Unlock()
		return out, nil
	}
	a.mu.Unlock()

	res, err := a.rest.fetchContext(ctx)
	if err != nil {
		return nil, err
	}

	bySymbol := make(map[string]market, len(res.Markets))
	byID := make(map[int]market, len(res.Markets))
	for _, m := range res.Markets {
		bySymbol[m.ticker()] = m
		byID[m.ID] = m
	}

	var collateral token
	if len(res.Instances) > 0 {
		for _, tk := range res.Tokens {
			if tk.ID == res.Instances[0].CollateralTokenID {
				collateral = tk
				break
			}
		}
	}
	if collateral.Decimals == 0 && len(res.Tokens) > 0 {
		collateral = res.Tokens[0]
	}

	a.mu.Lock()
	a.markets, a.byID, a.collateral, a.ctxFetchedAt = bySymbol, byID, collateral, time.Now()
	a.mu.Unlock()
	return bySymbol, nil
}

// Markets returns every market with the fee schedule that applies to this
// account's current tier.
func (a *Adapter) Markets(ctx context.Context) ([]venue.Market, error) {
	ms, err := a.refreshContext(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]venue.Market, 0, len(ms))
	for _, m := range ms {
		vm, err := a.toVenueMarket(m)
		if err != nil {
			return nil, err
		}
		out = append(out, vm)
	}
	return out, nil
}

// Market returns one market by symbol.
func (a *Adapter) Market(ctx context.Context, symbol string) (venue.Market, error) {
	m, err := a.rawMarket(ctx, symbol)
	if err != nil {
		return venue.Market{}, err
	}
	return a.toVenueMarket(m)
}

func (a *Adapter) rawMarket(ctx context.Context, symbol string) (market, error) {
	ms, err := a.refreshContext(ctx)
	if err != nil {
		return market{}, err
	}
	m, ok := ms[strings.ToUpper(symbol)]
	if !ok {
		return market{}, fmt.Errorf("%w: %s on perpl", venue.ErrUnknownMarket, symbol)
	}
	return m, nil
}

func (a *Adapter) toVenueMarket(m market) (venue.Market, error) {
	tier := 0
	if a.trade != nil {
		tier = a.trade.currentAccount().FeeTier
	}
	postingFee, err := a.parseAmount(m.Config.RecycleFee)
	if err != nil {
		return venue.Market{}, fmt.Errorf("perpl: %s recycle_fee: %w", m.ticker(), err)
	}
	return venue.Market{
		Symbol:  m.ticker(),
		VenueID: strconv.Itoa(m.ID),
		// initial_margin and maintenance_margin are leverages in
		// hundredths: 1500 is 15x, and liquidation at 2500 is 25x.
		MaxLeverage:         fixed.FromInt(int64(m.Config.InitialMargin)).Div(fixed.FromInt(100)),
		LiquidationLeverage: fixed.FromInt(int64(m.Config.MaintenanceMargin)).Div(fixed.FromInt(100)),
		PriceTick:           tickFor(m.Config.PriceDecimals),
		SizeStep:            tickFor(m.Config.SizeDecimals),
		Fees: venue.FeeSchedule{
			MakerRate:   fixed.Micros(m.Config.feeMicros(tier, true)),
			TakerRate:   fixed.Micros(m.Config.feeMicros(tier, false)),
			BuilderRate: builderRate(a.cfg.BuilderFeePer100K),
			ChargedOn:   venue.FeeOnOpen,
			PostingFee:  postingFee,
		},
		OrderTTL:        time.Duration(m.OrderTTLBlocks) * blockInterval,
		MaxSlippage:     fixed.Bps(int64(m.MaxSlippageBps)),
		FundingInterval: time.Duration(m.FundingIntervalSec) * time.Second,
	}, nil
}

// Candles returns closed bars from the REST history endpoint.
func (a *Adapter) Candles(ctx context.Context, symbol string, period time.Duration, from, to time.Time) ([]venue.Candle, error) {
	m, err := a.rawMarket(ctx, symbol)
	if err != nil {
		return nil, err
	}
	res := int(period / time.Second)
	if !supportedResolution(res) {
		return nil, fmt.Errorf("perpl: unsupported candle period %s", period)
	}
	raw, err := a.rest.fetchCandles(ctx, m.ID, res, from, to)
	if err != nil {
		return nil, err
	}
	out := make([]venue.Candle, 0, len(raw))
	for _, c := range raw {
		vc, err := a.toVenueCandle(m, period, c)
		if err != nil {
			return nil, err
		}
		out = append(out, vc)
	}
	return out, nil
}

// StreamCandles emits bars as the venue updates them, including the forming
// bar; callers use Candle.Closed to tell them apart.
func (a *Adapter) StreamCandles(ctx context.Context, symbol string, period time.Duration) (<-chan venue.Candle, error) {
	m, err := a.rawMarket(ctx, symbol)
	if err != nil {
		return nil, err
	}
	res := int(period / time.Second)
	if !supportedResolution(res) {
		return nil, fmt.Errorf("perpl: unsupported candle period %s", period)
	}

	out := make(chan venue.Candle, 256)
	stream := fmt.Sprintf("candles@%d*%d", m.ID, res)
	err = a.md.subscribe(ctx, stream, func(mt int, raw []byte) {
		if mt != msgCandlesSnapshot && mt != msgCandlesUpdate {
			return
		}
		var series candleSeries
		if err := jsonUnmarshal(raw, &series); err != nil {
			a.log.Warn("perpl: bad candle frame", "err", err)
			return
		}
		for _, c := range series.Data {
			vc, err := a.toVenueCandle(m, period, c)
			if err != nil {
				continue
			}
			trySend(out, vc)
		}
	})
	if err != nil {
		return nil, err
	}
	go closeOnDone(ctx, out)
	return out, nil
}

// StreamBook emits L2 snapshots. Levels reported with zero orders are removals.
func (a *Adapter) StreamBook(ctx context.Context, symbol string) (<-chan venue.Book, error) {
	m, err := a.rawMarket(ctx, symbol)
	if err != nil {
		return nil, err
	}
	out := make(chan venue.Book, 64)
	err = a.md.subscribe(ctx, fmt.Sprintf("order-book@%d", m.ID), func(mt int, raw []byte) {
		if mt != msgBookSnapshot && mt != msgBookUpdate {
			return
		}
		var msg bookMessage
		if err := jsonUnmarshal(raw, &msg); err != nil {
			return
		}
		trySend(out, venue.Book{
			At:   msTime(msg.At.Time),
			Bids: a.toLevels(m, msg.Bids),
			Asks: a.toLevels(m, msg.Asks),
		})
	})
	if err != nil {
		return nil, err
	}
	go closeOnDone(ctx, out)
	return out, nil
}

// StreamTickers emits mark, oracle and last prices for every market.
func (a *Adapter) StreamTickers(ctx context.Context) (<-chan venue.Ticker, error) {
	out := make(chan venue.Ticker, 256)
	stream := fmt.Sprintf("market-state@%d", a.cfg.Network.ChainID)
	err := a.md.subscribe(ctx, stream, func(mt int, raw []byte) {
		if mt != msgMarketState {
			return
		}
		var msg marketStateUpdate
		if err := jsonUnmarshal(raw, &msg); err != nil {
			return
		}
		for idStr, st := range msg.Data {
			id, err := strconv.Atoi(idStr)
			if err != nil {
				continue
			}
			a.mu.Lock()
			m, ok := a.byID[id]
			a.mu.Unlock()
			if !ok {
				continue
			}
			d := m.Config.PriceDecimals
			trySend(out, venue.Ticker{
				At:     msTime(st.At.Time),
				Symbol: m.ticker(),
				Mark:   fixed.MustFromScaled(st.Mark, d),
				Oracle: fixed.MustFromScaled(st.Oracle, d),
				Last:   fixed.MustFromScaled(st.Last, d),
				Bid:    fixed.MustFromScaled(st.Bid, d),
				Ask:    fixed.MustFromScaled(st.Ask, d),
			})
		}
	})
	if err != nil {
		return nil, err
	}
	go closeOnDone(ctx, out)
	return out, nil
}

// --- trading ---

// Account returns the balance and, crucially, whether the venue will accept
// orders at all: CanTrade is false until allowOrderForwarding(true) has been
// called on-chain.
func (a *Adapter) Account(ctx context.Context) (venue.Account, error) {
	if a.trade == nil {
		return venue.Account{}, venue.ErrNoCredentials
	}
	st := a.trade.currentAccount()
	balance, err := a.parseAmount(st.Balance)
	if err != nil {
		return venue.Account{}, err
	}
	locked, err := a.parseAmount(st.Locked)
	if err != nil {
		return venue.Account{}, err
	}
	return venue.Account{
		VenueID:  strconv.FormatUint(st.ID, 10),
		Balance:  balance,
		Locked:   locked,
		CanTrade: st.Forwarding && !st.Frozen,
		Frozen:   st.Frozen,
		FeeTier:  st.FeeTier,
	}, nil
}

// Place submits an order and returns once the venue has accepted or refused it.
func (a *Adapter) Place(ctx context.Context, req venue.OrderRequest) (venue.Order, error) {
	if a.trade == nil {
		return venue.Order{}, venue.ErrNoCredentials
	}
	m, err := a.rawMarket(ctx, req.Symbol)
	if err != nil {
		return venue.Order{}, err
	}
	acct := a.trade.currentAccount()
	if acct.ID == 0 {
		return venue.Order{}, fmt.Errorf("%w: call createAccount on %s", venue.ErrNoExchangeAccount, a.cfg.Network.ExchangeAddress)
	}
	if !acct.Forwarding {
		return venue.Order{}, fmt.Errorf("%w: call allowOrderForwarding(true) on %s", venue.ErrForwardingDisabled, a.cfg.Network.ExchangeAddress)
	}

	wire, err := a.buildOrder(ctx, m, acct, req)
	if err != nil {
		return venue.Order{}, err
	}

	a.mu.Lock()
	a.reqByClient[req.ClientID] = wire.RequestID
	a.clientByReq[wire.RequestID] = req.ClientID
	a.marketByClient[req.ClientID] = m.ID
	a.mu.Unlock()

	// An order lives at most order_ttl_blocks; wait a little beyond that so a
	// timeout means the venue really said nothing.
	wait := time.Duration(m.OrderTTLBlocks)*blockInterval + 5*time.Second
	o, err := a.trade.submit(ctx, wire, wait)
	if err != nil {
		var rej *Rejection
		if errorsAs(err, &rej) {
			return venue.Order{}, fmt.Errorf("%w: %w", venue.ErrRejected, rej)
		}
		return venue.Order{}, err
	}
	return a.toVenueOrder(m, o)
}

// buildOrder translates a venue request into the wire frame, applying every
// constraint the venue enforces rather than letting it reject the order.
func (a *Adapter) buildOrder(ctx context.Context, m market, acct accountState, req venue.OrderRequest) (orderRequest, error) {
	if req.ClientID == "" {
		return orderRequest{}, fmt.Errorf("perpl: order requires a ClientID for idempotency")
	}
	if req.Side != venue.Long && req.Side != venue.Short {
		return orderRequest{}, fmt.Errorf("perpl: order requires a side")
	}

	maxLev := fixed.FromInt(int64(m.Config.InitialMargin)).Div(fixed.FromInt(100))
	lev := req.Leverage
	if lev.IsZero() {
		lev = fixed.FromInt(1)
	}
	if lev.Cmp(maxLev) > 0 {
		return orderRequest{}, fmt.Errorf("perpl: leverage %s exceeds %s maximum %s", lev, m.ticker(), maxLev)
	}

	size := req.Size
	if size.IsZero() {
		if req.Notional.IsZero() {
			return orderRequest{}, fmt.Errorf("perpl: order requires Size or Notional")
		}
		mark, err := a.markPrice(ctx, m)
		if err != nil {
			return orderRequest{}, err
		}
		size = req.Notional.Div(mark)
	}
	step := tickFor(m.Config.SizeDecimals)
	size = size.RoundDownTo(step)
	if !size.IsPos() {
		return orderRequest{}, fmt.Errorf("perpl: size rounds to zero at %s step %s", m.ticker(), step)
	}
	scaledSize, err := size.ToScaled(m.Config.SizeDecimals)
	if err != nil {
		return orderRequest{}, err
	}

	var scaledPrice int64
	if !req.IsMarket() {
		price := req.Price.RoundToNearest(tickFor(m.Config.PriceDecimals))
		if scaledPrice, err = price.ToScaled(m.Config.PriceDecimals); err != nil {
			return orderRequest{}, err
		}
	}

	head := a.trade.latestHead()
	if head == 0 {
		head = a.md.latestHead()
	}
	var lastBlock int64
	if head > 0 {
		// head < lb <= head + order_ttl_blocks; the server clamps down but
		// rejects anything already expired.
		lastBlock = head + int64(m.OrderTTLBlocks)
	}

	return orderRequest{
		MsgType:        msgOrderRequest,
		RequestID:      a.trade.nextRequestID(),
		Market:         m.ID,
		Account:        acct.ID,
		Type:           orderType(req.Side, req.Reduce),
		Price:          scaledPrice,
		Size:           scaledSize,
		MaxSlippageBps: slippageBps(req.MaxSlippage, m),
		Flags:          orderFlags(req),
		Leverage:       int(lev.Mul(fixed.FromInt(100)).Float64()),
		LastBlock:      lastBlock,
		BuilderFee:     a.cfg.BuilderFeePer100K,
	}, nil
}

// Cancel withdraws a resting order placed under the given ClientID.
func (a *Adapter) Cancel(ctx context.Context, clientID string) error {
	if a.trade == nil {
		return venue.ErrNoCredentials
	}
	a.mu.Lock()
	oid, haveOrder := a.orderIDByClient[clientID]
	mktID, haveMarket := a.marketByClient[clientID]
	a.mu.Unlock()
	if !haveOrder {
		return fmt.Errorf("perpl: no venue order id known for client id %s — it never reached the book", clientID)
	}
	if !haveMarket {
		return fmt.Errorf("perpl: no market known for client id %s", clientID)
	}
	m, ok := a.marketByID(mktID)
	if !ok {
		return fmt.Errorf("%w: market id %d", venue.ErrUnknownMarket, mktID)
	}

	head := a.trade.latestHead()
	var lastBlock int64
	if head > 0 {
		lastBlock = head + int64(m.OrderTTLBlocks)
	}
	req := orderRequest{
		MsgType:   msgOrderRequest,
		RequestID: a.trade.nextRequestID(),
		Market:    m.ID,
		Account:   a.trade.currentAccount().ID,
		OrderID:   oid,
		Type:      orderCancel,
		LastBlock: lastBlock,
	}
	if _, err := a.trade.submit(ctx, req, time.Duration(m.OrderTTLBlocks)*blockInterval+5*time.Second); err != nil {
		return err
	}
	return nil
}

// Positions returns open exposure, refreshed from the venue's own snapshots.
// It is the reconciliation source on startup.
func (a *Adapter) Positions(ctx context.Context) ([]venue.Position, error) {
	if a.trade == nil {
		return nil, venue.ErrNoCredentials
	}
	a.startMarkFeed(ctx)
	a.mu.Lock()
	raw := make([]position, 0, len(a.positions))
	for _, p := range a.positions {
		raw = append(raw, p)
	}
	a.mu.Unlock()

	out := make([]venue.Position, 0, len(raw))
	for _, p := range raw {
		if p.Status != positionStatusOpen {
			continue
		}
		vp, err := a.toVenuePosition(p)
		if err != nil {
			return nil, err
		}
		out = append(out, vp)
	}
	return out, nil
}

// StreamOrders emits order state transitions.
func (a *Adapter) StreamOrders(ctx context.Context) (<-chan venue.Order, error) {
	if a.trade == nil {
		return nil, venue.ErrNoCredentials
	}
	in := a.trade.subscribeOrders(256)
	out := make(chan venue.Order, 256)
	go func() {
		defer close(out)
		for {
			select {
			case <-ctx.Done():
				return
			case o := <-in:
				m, ok := a.marketByID(o.Market)
				if !ok {
					continue
				}
				vo, err := a.toVenueOrder(m, o)
				if err != nil {
					continue
				}
				trySend(out, vo)
			}
		}
	}()
	return out, nil
}

// StreamFills emits executions with the fee actually charged.
func (a *Adapter) StreamFills(ctx context.Context) (<-chan venue.Fill, error) {
	if a.trade == nil {
		return nil, venue.ErrNoCredentials
	}
	in := a.trade.subscribeFills(256)
	out := make(chan venue.Fill, 256)
	go func() {
		defer close(out)
		for {
			select {
			case <-ctx.Done():
				return
			case f := <-in:
				m, ok := a.marketByID(f.Market)
				if !ok {
					continue
				}
				vf, err := a.toVenueFill(m, f)
				if err != nil {
					continue
				}
				trySend(out, vf)
			}
		}
	}()
	return out, nil
}

func (a *Adapter) trackPositions(ctx context.Context, in <-chan position) {
	for {
		select {
		case <-ctx.Done():
			return
		case p := <-in:
			a.mu.Lock()
			if p.Status == positionStatusOpen {
				a.positions[p.PositionID] = p
			} else {
				delete(a.positions, p.PositionID)
			}
			a.mu.Unlock()
		}
	}
}

func (a *Adapter) trackOrders(ctx context.Context, in <-chan order) {
	for {
		select {
		case <-ctx.Done():
			return
		case o := <-in:
			a.mu.Lock()
			if client, ok := a.clientByReq[o.RequestID]; ok && o.OrderID != 0 {
				a.orderIDByClient[client] = o.OrderID
			}
			a.mu.Unlock()
		}
	}
}

func (a *Adapter) marketByID(id int) (market, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	m, ok := a.byID[id]
	return m, ok
}

// markPrice reads the venue's current mark price for sizing a notional order.
func (a *Adapter) markPrice(ctx context.Context, m market) (fixed.D, error) {
	fresh, err := a.rawMarket(ctx, m.ticker())
	if err != nil {
		return 0, err
	}
	price, err := fixed.FromScaled(fresh.State.Mark, fresh.Config.PriceDecimals)
	if err != nil {
		return 0, err
	}
	if !price.IsPos() {
		return 0, fmt.Errorf("perpl: no mark price for %s", m.ticker())
	}
	return price, nil
}
