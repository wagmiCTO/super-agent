package platform

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"sort"
	"sync"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/chain"
	"github.com/wagmiCTO/super-agent/services/internal/eip712"
	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/store"
	"github.com/wagmiCTO/super-agent/services/internal/strategy"
)

// Prize keeps the StrategyPrizePool contract fed and settled: every closed
// round trip adds a fixed amount to its strategy's pool for the week (sent in
// batches, one transaction per strategy), and once a week is over the top of
// each board is published as that week's winners. Payouts are the winners'
// own claims; the platform never holds them.
type Prize struct {
	client   *chain.Client
	key      *chain.Key
	contract [20]byte
	token    [20]byte
	chainID  uint64
	perTrade *big.Int // token units per closed trade
	store    *store.Store
	log      *slog.Logger
	now      func() time.Time

	mu      sync.Mutex
	due     map[fundKey]*big.Int // funding owed, not yet sent
	sent    int
	failed  int
	lastErr string
}

type fundKey struct {
	week     uint64
	strategy string
}

// PrizeConfig is what the platform needs to fund and settle.
type PrizeConfig struct {
	RPCURL     string
	PrivateKey string
	Contract   string
	Token      string
	// PerTrade is the amount added to the pool per closed trade, in the
	// token's units (AUSD micros).
	PerTrade *big.Int
}

// Shares of the pool for first, second and third, in percent.
var prizeShares = []int64{50, 30, 20}

// NewPrize connects, checks the settler is authorised, and makes sure the
// pool may pull the token from the settler.
func NewPrize(ctx context.Context, cfg PrizeConfig, st *store.Store, log *slog.Logger) (*Prize, error) {
	if log == nil {
		log = slog.Default()
	}
	key, err := chain.ParseKey(cfg.PrivateKey)
	if err != nil {
		return nil, err
	}
	contract, err := chain.ParseAddress(cfg.Contract)
	if err != nil {
		return nil, err
	}
	token, err := chain.ParseAddress(cfg.Token)
	if err != nil {
		return nil, err
	}
	if cfg.PerTrade == nil || cfg.PerTrade.Sign() < 0 {
		return nil, errors.New("platform: prize per trade must be >= 0")
	}
	client := chain.NewClient(cfg.RPCURL)
	chainID, err := client.ChainID(ctx)
	if err != nil {
		return nil, fmt.Errorf("platform: prize: %w", err)
	}
	p := &Prize{client: client, key: key, contract: contract, token: token, chainID: chainID, perTrade: cfg.PerTrade, store: st, log: log, now: time.Now, due: make(map[fundKey]*big.Int)}
	ok, err := p.boolCall(ctx, chain.Encode("settlers(address)", key.Address))
	if err != nil {
		return nil, fmt.Errorf("platform: prize: %w", err)
	}
	if !ok {
		return nil, fmt.Errorf("platform: prize settler %s is not authorised on %s", addrHex(key.Address), cfg.Contract)
	}
	if err := p.ensureAllowance(ctx); err != nil {
		return nil, fmt.Errorf("platform: prize: %w", err)
	}
	log.Info("prize pool ready", "contract", cfg.Contract, "token", cfg.Token, "settler", addrHex(key.Address), "per_trade", cfg.PerTrade.String())
	return p, nil
}

func addrHex(a [20]byte) string { return "0x" + hex.EncodeToString(a[:]) }

// StrategyKey is how a strategy id is written on-chain: keccak256 of the id.
func StrategyKey(id string) [32]byte { return eip712.Keccak256([]byte(id)) }

// WeekOf mirrors the contract: weeks start Monday 00:00 UTC.
func WeekOf(t time.Time) uint64 { return uint64((t.Unix() + 3*86400) / (7 * 86400)) }

// WeekStart is the first second of a week index.
func WeekStart(week uint64) time.Time { return time.Unix(int64(week)*7*86400-3*86400, 0).UTC() }

func (p *Prize) Contract() string { return addrHex(p.contract) }
func (p *Prize) Token() string    { return addrHex(p.token) }

// OnClosed is the ledger hook: one more contribution to this week's pool.
func (p *Prize) OnClosed(t Trade) {
	if p.perTrade.Sign() == 0 {
		return
	}
	k := fundKey{week: WeekOf(t.ClosedAt), strategy: t.Strategy}
	p.mu.Lock()
	if p.due[k] == nil {
		p.due[k] = new(big.Int)
	}
	p.due[k].Add(p.due[k], p.perTrade)
	p.mu.Unlock()
}

const (
	fundEvery   = 30 * time.Second
	settleEvery = 10 * time.Minute
	prizeTxWait = 90 * time.Second
	prizeGas    = 120 // percent margin over the estimate
)

// Run flushes funding every fundEvery and checks last week's settlement
// every settleEvery, until ctx ends.
func (p *Prize) Run(ctx context.Context) {
	fund := time.NewTicker(fundEvery)
	settle := time.NewTicker(settleEvery)
	defer fund.Stop()
	defer settle.Stop()
	p.settleDue(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-fund.C:
			p.flush(ctx)
		case <-settle.C:
			p.settleDue(ctx)
		}
	}
}

// flush sends one fund transaction per (week, strategy) owed.
func (p *Prize) flush(ctx context.Context) {
	p.mu.Lock()
	batch := p.due
	p.due = make(map[fundKey]*big.Int)
	p.mu.Unlock()
	for k, amount := range batch {
		if err := p.send(ctx, chain.Encode("fund(uint64,bytes32,uint256)", k.week, StrategyKey(k.strategy), amount)); err != nil {
			p.mu.Lock()
			p.failed++
			p.lastErr = err.Error()
			// Put it back; the next flush tries again.
			if p.due[k] == nil {
				p.due[k] = new(big.Int)
			}
			p.due[k].Add(p.due[k], amount)
			p.mu.Unlock()
			p.log.Warn("prize funding failed, will retry", "week", k.week, "strategy", k.strategy, "err", err)
			continue
		}
		p.mu.Lock()
		p.sent++
		p.mu.Unlock()
		p.log.Info("prize pool funded", "week", k.week, "strategy", k.strategy, "amount", amount.String())
	}
}

// settleDue publishes last week's winners for every strategy whose pool has
// money and is not settled yet.
func (p *Prize) settleDue(ctx context.Context) {
	if p.store == nil {
		return
	}
	last := WeekOf(p.now()) - 1
	for _, s := range strategy.Catalog {
		settled, err := p.boolCall(ctx, chain.Encode("settled(uint64,bytes32)", last, StrategyKey(s.ID)))
		if err != nil || settled {
			continue
		}
		pool, err := p.uintCall(ctx, chain.Encode("pool(uint64,bytes32)", last, StrategyKey(s.ID)))
		if err != nil || pool.Sign() == 0 {
			continue
		}
		winners, err := p.winners(ctx, last, s.ID, pool)
		if err != nil {
			p.log.Warn("prize winners not computed", "week", last, "strategy", s.ID, "err", err)
			continue
		}
		var addrs, amounts, pnls [][32]byte
		for _, w := range winners {
			a, err := chain.ParseAddress(w.Wallet)
			if err != nil {
				continue
			}
			addrs = append(addrs, chain.Word(a))
			amounts = append(amounts, chain.Word(w.Amount))
			pnls = append(pnls, chain.Word(collateralMicros(w.PnL)))
		}
		data := chain.EncodeCall("settle(uint64,bytes32,address[],uint256[],int128[])",
			[][32]byte{chain.Word(last), StrategyKey(s.ID)}, [][][32]byte{addrs, amounts, pnls})
		if err := p.send(ctx, data); err != nil {
			p.log.Warn("prize settlement failed", "week", last, "strategy", s.ID, "err", err)
			continue
		}
		for _, w := range winners {
			if err := p.store.SavePrize(ctx, store.PrizeRecord{Week: last, Strategy: s.ID, Wallet: w.Wallet, Amount: w.Amount.String(), PnL: w.PnL, SettledAt: p.now()}); err != nil {
				p.log.Warn("prize not journaled", "week", last, "strategy", s.ID, "wallet", w.Wallet, "err", err)
			}
		}
		p.log.Info("prize settled", "week", last, "strategy", s.ID, "pool", pool.String(), "winners", len(winners))
	}
}

// Winner is one line of a settlement.
type Winner struct {
	Wallet string
	PnL    fixed.D
	Amount *big.Int
}

// winners ranks the week's board and splits the pool 50/30/20 among the top
// three with a positive result. Wallets that are not chain addresses (the
// platform's own account) cannot claim and are skipped.
func (p *Prize) winners(ctx context.Context, week uint64, strategyID string, pool *big.Int) ([]Winner, error) {
	rows, err := p.store.Boards(ctx, WeekStart(week), WeekStart(week+1), 10)
	if err != nil {
		return nil, err
	}
	b := rows[strategyID]
	if b == nil {
		return nil, nil
	}
	sort.Slice(b.Top, func(i, j int) bool { return b.Top[i].PnL > b.Top[j].PnL })
	var out []Winner
	for _, s := range b.Top {
		if len(out) == len(prizeShares) || !s.PnL.IsPos() {
			break
		}
		if _, err := chain.ParseAddress(s.Wallet); err != nil {
			continue
		}
		amount := new(big.Int).Mul(pool, big.NewInt(prizeShares[len(out)]))
		amount.Div(amount, big.NewInt(100))
		out = append(out, Winner{Wallet: s.Wallet, PnL: s.PnL, Amount: amount})
	}
	return out, nil
}

// collateralMicros converts a fixed-point collateral amount to 6 decimals.
func collateralMicros(d fixed.D) *big.Int {
	v := new(big.Int).SetInt64(int64(d))
	return v.Div(v, big.NewInt(int64(fixed.Scale)/1_000_000))
}

// ensureAllowance approves the pool to pull the token once, for a long time.
func (p *Prize) ensureAllowance(ctx context.Context) error {
	have, err := p.uintCallTo(ctx, p.token, chain.Encode("allowance(address,address)", p.key.Address, p.contract))
	if err != nil {
		return err
	}
	// Enough for a very long time at any sane per-trade amount.
	floor := new(big.Int).Mul(big.NewInt(1_000_000), big.NewInt(1_000_000)) // 1M AUSD
	if have.Cmp(floor) >= 0 {
		return nil
	}
	max := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))
	if err := p.sendTo(ctx, p.token, chain.Encode("approve(address,uint256)", p.contract, max)); err != nil {
		return fmt.Errorf("approve: %w", err)
	}
	p.log.Info("prize pool approved to pull the token", "token", addrHex(p.token))
	return nil
}

func (p *Prize) send(ctx context.Context, data []byte) error { return p.sendTo(ctx, p.contract, data) }

// sendTo signs, submits and waits for one transaction.
func (p *Prize) sendTo(ctx context.Context, to [20]byte, data []byte) error {
	ctx, cancel := context.WithTimeout(ctx, prizeTxWait)
	defer cancel()
	nonce, err := p.client.Nonce(ctx, p.key.Address)
	if err != nil {
		return err
	}
	feeCap, tipCap, err := p.client.Fees(ctx)
	if err != nil {
		return err
	}
	gas, err := p.client.EstimateGas(ctx, p.key.Address, to, data)
	if err != nil {
		return err
	}
	raw, err := p.key.Sign(chain.Tx{ChainID: p.chainID, Nonce: nonce, TipCap: tipCap, FeeCap: feeCap, Gas: gas * prizeGas / 100, To: &to, Value: new(big.Int), Data: data})
	if err != nil {
		return err
	}
	hash, err := p.client.SendRaw(ctx, raw)
	if err != nil {
		return err
	}
	rcpt, err := p.client.WaitMined(ctx, hash, time.Second)
	if err != nil {
		return err
	}
	if rcpt.Status != 1 {
		return fmt.Errorf("transaction reverted in block %d (0x%x)", rcpt.BlockNumber, hash)
	}
	return nil
}

func (p *Prize) boolCall(ctx context.Context, data []byte) (bool, error) {
	out, err := p.client.Call(ctx, p.contract, data)
	if err != nil {
		return false, err
	}
	w, err := chain.Words(out)
	if err != nil || len(w) < 1 {
		return false, errors.New("bad return")
	}
	return w[0][31] == 1, nil
}

func (p *Prize) uintCall(ctx context.Context, data []byte) (*big.Int, error) {
	return p.uintCallTo(ctx, p.contract, data)
}

func (p *Prize) uintCallTo(ctx context.Context, to [20]byte, data []byte) (*big.Int, error) {
	out, err := p.client.Call(ctx, to, data)
	if err != nil {
		return nil, err
	}
	w, err := chain.Words(out)
	if err != nil || len(w) < 1 {
		return nil, errors.New("bad return")
	}
	return new(big.Int).SetBytes(w[0][:]), nil
}

// PoolStatus is what the lobby shows about a strategy's prize this week.
type PoolStatus struct {
	Strategy string
	Pool     *big.Int
}

// Pools reads this week's pool for every strategy.
func (p *Prize) Pools(ctx context.Context, week uint64) ([]PoolStatus, error) {
	out := make([]PoolStatus, 0, len(strategy.Catalog))
	for _, s := range strategy.Catalog {
		v, err := p.uintCallTo(ctx, p.contract, chain.Encode("pool(uint64,bytes32)", week, StrategyKey(s.ID)))
		if err != nil {
			return nil, err
		}
		out = append(out, PoolStatus{Strategy: s.ID, Pool: v})
	}
	return out, nil
}

// PrizeOf reads a wallet's prize for a week and whether it was claimed.
func (p *Prize) PrizeOf(ctx context.Context, week uint64, strategyID, wallet string) (*big.Int, bool, error) {
	a, err := chain.ParseAddress(wallet)
	if err != nil {
		return nil, false, err
	}
	out, err := p.client.Call(ctx, p.contract, chain.Encode("prizeOf(uint64,bytes32,address)", week, StrategyKey(strategyID), a))
	if err != nil {
		return nil, false, err
	}
	w, err := chain.Words(out)
	if err != nil || len(w) != 2 {
		return nil, false, errors.New("prizeOf: bad return")
	}
	return new(big.Int).SetBytes(w[0][:]), w[1][31] == 1, nil
}

// Stats reports the funding queue for the API.
type PrizeStats struct {
	Sent, Failed int
	LastError    string
	Due          int
}

func (p *Prize) Stats() PrizeStats {
	p.mu.Lock()
	defer p.mu.Unlock()
	return PrizeStats{Sent: p.sent, Failed: p.failed, LastError: p.lastErr, Due: len(p.due)}
}
