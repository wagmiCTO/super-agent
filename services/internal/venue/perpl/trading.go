package perpl

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

var (
	errNoCredentials = errors.New("perpl: no api key configured")
	// errDisconnected fails every request in flight when the socket drops. A
	// close carries no per-request status, so the outcome is unknown and the
	// caller must reconcile rather than assume the order was dropped.
	errDisconnected = fmt.Errorf("perpl: trading connection closed with requests in flight: %w", venue.ErrDisconnected)
)

// accountState is what the trading socket tells us about our own account. It is
// re-read from every account update: the fee tier and the order-forwarding flag
// both change out from under us.
type accountState struct {
	// Address is the wallet that owns the account, from the wallet snapshot.
	Address    string
	ID         uint64
	Frozen     bool
	Forwarding bool
	FeeTier    int
	Balance    string
	Locked     string
	LastReqID  uint64
}

// tradingClient owns the authenticated socket: sign-in, snapshots, order
// submission and the fan-out of order, fill and position updates.
type tradingClient struct {
	url    string
	signer *signer
	log    *slog.Logger
	// wantAccount pins the account to use when a wallet holds several.
	wantAccount uint64

	mu        sync.Mutex
	conn      *websocket.Conn
	connected bool
	// closing marks a deliberate shutdown, so the read error it causes is
	// not reported as a session failure.
	closing   bool
	account   accountState
	seq       int64  // outbound frame counter, never zero
	nextReqID uint64 // idempotency key, strictly increasing
	lastHB    int64  // heartbeat sequence, for gap detection
	head      int64

	statusWaiters map[int64]chan statusResponse
	orderWaiters  map[uint64]chan order

	orderSubs    []chan order
	fillSubs     []chan fill
	positionSubs []chan position

	ready     chan struct{} // closed once snapshots have arrived, or on a fatal error
	readyOnce sync.Once
	// noAccount is set when the snapshot listed no exchange account for the
	// wallet; the session then re-signs in periodically to discover one.
	noAccount bool
	startErr  error // set before ready is closed when the session cannot be established
}

func newTradingClient(baseURL string, s *signer, wantAccount uint64, log *slog.Logger) *tradingClient {
	return &tradingClient{
		url:           baseURL + "/ws/v1/trading",
		signer:        s,
		log:           log,
		wantAccount:   wantAccount,
		statusWaiters: make(map[int64]chan statusResponse),
		orderWaiters:  make(map[uint64]chan order),
		ready:         make(chan struct{}),
	}
}

// start launches the connection loop and blocks until the first snapshots have
// arrived or ctx is done.
func (t *tradingClient) start(ctx context.Context) error {
	if t.signer == nil {
		return errNoCredentials
	}
	go t.run(ctx)
	select {
	case <-t.ready:
		t.mu.Lock()
		defer t.mu.Unlock()
		return t.startErr
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (t *tradingClient) run(ctx context.Context) {
	attempt := 0
	for ctx.Err() == nil {
		err := t.session(ctx)
		if errors.Is(err, errRediscover) {
			// A deliberate reconnect, not a failure: no backoff.
			attempt = 0
			continue
		}
		if err != nil && ctx.Err() == nil && !t.isClosing() {
			t.log.Warn("perpl trading session ended", "err", err, "attempt", attempt)
		}
		t.failInFlight()
		if t.isClosing() || ctx.Err() != nil {
			return
		}
		// A rejected sign-in will not fix itself by retrying: the key is
		// wrong, revoked, or belongs to the other network. Surface it and
		// stop, so a caller blocked in start() gets an answer.
		if isAuthFailure(err) {
			t.mu.Lock()
			t.startErr = fmt.Errorf("perpl: trading sign-in rejected (3401): check PERPL_API_KEY, its scope, and that it belongs to %s: %w", t.url, err)
			t.mu.Unlock()
			t.readyOnce.Do(func() { close(t.ready) })
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(delayFor(attempt)):
		}
		attempt++
	}
}

func (t *tradingClient) session(ctx context.Context) error {
	conn, err := dial(ctx, t.url)
	if err != nil {
		return err
	}
	defer conn.CloseNow()

	// The sign-in frame must be first and must arrive within the server's
	// idle timeout (5s mainnet, 10s testnet).
	frame, err := t.signer.signInFrame()
	if err != nil {
		return err
	}
	if err := writeJSON(ctx, conn, frame); err != nil {
		return err
	}

	t.mu.Lock()
	t.conn, t.connected, t.lastHB = conn, true, 0
	t.mu.Unlock()
	defer func() {
		t.mu.Lock()
		t.conn, t.connected = nil, false
		t.mu.Unlock()
	}()

	sessCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	go t.keepAlive(sessCtx, conn)
	rediscover := make(chan struct{}, 1)
	go t.rediscover(sessCtx, rediscover)

	for {
		_, raw, err := conn.Read(ctx)
		if err != nil {
			select {
			case <-rediscover:
				t.log.Debug("perpl trading: session closed for rediscovery", "read_err", err)
				return errRediscover
			default:
			}
			t.log.Debug("perpl trading: session read ended", "err", err)
			return fmt.Errorf("perpl: trading read: %w", err)
		}
		if err := t.handle(raw); err != nil {
			return err
		}
	}
}

// errRediscover is how a session reports that it closed itself on purpose
// to sign in again and pick up an exchange account created after it started.
var errRediscover = errors.New("perpl: re-signing in to discover the exchange account")

// rediscoverInterval is how often a session with no exchange account signs
// in again. The venue does push an AccountUpdate when the account is created
// on-chain (seen 10 Sep 2026: three updates within seconds of createAccount),
// so this is a fallback for a missed frame, not the main path. Sign-in is
// cheap: one frame, well inside the rate budget.
const rediscoverInterval = 10 * time.Second

func (t *tradingClient) rediscover(ctx context.Context, fired chan<- struct{}) {
	ticker := time.NewTicker(rediscoverInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			t.mu.Lock()
			conn, again := t.conn, t.noAccount && t.account.ID == 0
			t.mu.Unlock()
			if !again || conn == nil {
				continue
			}
			fired <- struct{}{}
			t.log.Info("perpl trading: no exchange account yet, signing in again")
			_ = conn.Close(websocket.StatusNormalClosure, "rediscover")
			return
		}
	}
}

// keepAliveInterval is how often the client pings the trading socket.
//
// The docs suggest 30 seconds; measured on 2026-09-09 that gets the session
// closed with 1008 "ping timeout" about every two minutes, and any order in
// flight at that moment fails. The server's idle window is 5s on mainnet and
// 10s on testnet, so the ping has to sit inside the smaller one. At 3s that is
// 20 requests a minute against a budget of 60 (testnet) / 120 (mainnet).
const keepAliveInterval = 3 * time.Second

// keepAlive sends application-level pings so the server never sees the
// connection as idle.
func (t *tradingClient) keepAlive(ctx context.Context, conn *websocket.Conn) {
	ticker := time.NewTicker(keepAliveInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := writeJSON(ctx, conn, ping{MsgType: msgPing, Time: time.Now().UnixMilli()}); err != nil {
				return
			}
		}
	}
}

func (t *tradingClient) handle(raw []byte) error {
	mt, err := peekMsgType(raw)
	if err != nil {
		t.log.Warn("perpl trading: unparseable frame", "err", err)
		return nil
	}

	t.log.Debug("perpl trading frame", "mt", mt)
	switch mt {
	case msgWalletSnapshot:
		var w wallet
		if err := json.Unmarshal(raw, &w); err != nil {
			return fmt.Errorf("perpl: wallet snapshot: %w", err)
		}
		t.applyWallet(w)

	case msgAccountUpdate:
		var a account
		if err := json.Unmarshal(raw, &a); err != nil {
			return fmt.Errorf("perpl: account update: %w", err)
		}
		t.applyAccount(a)

	case msgStatusResponse:
		var s statusResponse
		if err := json.Unmarshal(raw, &s); err != nil {
			return fmt.Errorf("perpl: status response: %w", err)
		}
		t.deliverStatus(s)

	case msgOrdersSnapshot, msgOrdersUpdate:
		var m ordersMessage
		if err := json.Unmarshal(raw, &m); err != nil {
			return fmt.Errorf("perpl: orders: %w", err)
		}
		for _, o := range m.Data {
			t.deliverOrder(o)
		}

	case msgFillsUpdate:
		var m fillsMessage
		if err := json.Unmarshal(raw, &m); err != nil {
			return fmt.Errorf("perpl: fills: %w", err)
		}
		for _, f := range m.Data {
			t.broadcastFill(f)
		}

	case msgPositionsSnapshot, msgPositionsUpdate:
		var m positionsMessage
		if err := json.Unmarshal(raw, &m); err != nil {
			return fmt.Errorf("perpl: positions: %w", err)
		}
		for _, p := range m.Data {
			t.broadcastPosition(p)
		}

	case msgHeartbeat:
		var hb heartbeat
		if err := json.Unmarshal(raw, &hb); err != nil {
			return nil
		}
		return t.checkHeartbeat(hb)
	}
	return nil
}

// checkHeartbeat enforces the contiguous sequence the trading socket promises.
// A gap means frames were lost, and the only safe response is to reconnect and
// take fresh snapshots.
func (t *tradingClient) checkHeartbeat(hb heartbeat) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.head = hb.Head
	if t.lastHB != 0 && hb.Seq != t.lastHB+1 {
		return fmt.Errorf("perpl: heartbeat gap: got %d after %d", hb.Seq, t.lastHB)
	}
	t.lastHB = hb.Seq
	return nil
}

func (t *tradingClient) applyWallet(w wallet) {
	t.mu.Lock()
	t.lastHB = w.Seq
	t.account.Address = w.Address
	t.noAccount = true
	t.log.Debug("perpl wallet snapshot", "accounts", len(w.Accounts), "first_id", firstAccountID(w.Accounts))
	for _, a := range w.Accounts {
		if a.ID == 0 {
			// The venue lists a placeholder for a wallet with no account.
			continue
		}
		if t.wantAccount != 0 && a.ID != t.wantAccount {
			continue
		}
		t.setAccountLocked(a)
		t.account.Address = w.Address
		t.noAccount = false
		break
	}
	t.mu.Unlock()

	// The snapshot is the answer even when it lists no account: a wallet
	// that has enrolled a key but not yet created an exchange account is a
	// valid, if not yet tradable, session. Orders are refused by Place
	// until the account exists.
	t.readyOnce.Do(func() { close(t.ready) })
}

func (t *tradingClient) applyAccount(a account) {
	t.mu.Lock()
	if a.ID != 0 && (t.account.ID == 0 || a.ID == t.account.ID) {
		t.setAccountLocked(a)
		t.noAccount = false
	}
	t.mu.Unlock()
}

func (t *tradingClient) setAccountLocked(a account) {
	addr := t.account.Address
	t.account = accountState{
		Address:    addr,
		ID:         a.ID,
		Frozen:     a.Frozen,
		Forwarding: a.Forwarding,
		FeeTier:    a.FeeTier,
		Balance:    a.Balance,
		Locked:     a.Locked,
		LastReqID:  a.LastReqID,
	}
	// Seed the idempotency counter from the venue's own last forwarded id;
	// submitting rq <= lfr is rejected with reason 32.
	if a.LastReqID >= t.nextReqID {
		t.nextReqID = a.LastReqID + 1
	}
}

func firstAccountID(accts []account) uint64 {
	if len(accts) == 0 {
		return 0
	}
	return accts[0].ID
}

func (t *tradingClient) currentAccount() accountState {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.account
}

func (t *tradingClient) latestHead() int64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.head
}

func (t *tradingClient) deliverStatus(s statusResponse) {
	t.mu.Lock()
	ch := t.statusWaiters[s.CorrID]
	delete(t.statusWaiters, s.CorrID)
	t.mu.Unlock()
	if ch != nil {
		ch <- s
		close(ch)
	}
}

func (t *tradingClient) deliverOrder(o order) {
	t.mu.Lock()
	ch := t.orderWaiters[o.RequestID]
	subs := append([]chan order(nil), t.orderSubs...)
	t.mu.Unlock()

	if ch != nil {
		select {
		case ch <- o:
		default:
		}
	}
	for _, s := range subs {
		trySend(s, o)
	}
}

func (t *tradingClient) broadcastFill(f fill) {
	t.mu.Lock()
	subs := append([]chan fill(nil), t.fillSubs...)
	t.mu.Unlock()
	for _, s := range subs {
		trySend(s, f)
	}
}

func (t *tradingClient) broadcastPosition(p position) {
	t.mu.Lock()
	subs := append([]chan position(nil), t.positionSubs...)
	t.mu.Unlock()
	for _, s := range subs {
		trySend(s, p)
	}
}

// trySend never blocks the socket reader: falling behind is what gets a client
// disconnected with 1013.
func trySend[T any](ch chan T, v T) {
	select {
	case ch <- v:
	default:
	}
}

func (t *tradingClient) subscribeOrders(buf int) <-chan order {
	ch := make(chan order, buf)
	t.mu.Lock()
	t.orderSubs = append(t.orderSubs, ch)
	t.mu.Unlock()
	return ch
}

func (t *tradingClient) subscribeFills(buf int) <-chan fill {
	ch := make(chan fill, buf)
	t.mu.Lock()
	t.fillSubs = append(t.fillSubs, ch)
	t.mu.Unlock()
	return ch
}

func (t *tradingClient) subscribePositions(buf int) <-chan position {
	ch := make(chan position, buf)
	t.mu.Lock()
	t.positionSubs = append(t.positionSubs, ch)
	t.mu.Unlock()
	return ch
}

func (t *tradingClient) failInFlight() {
	t.mu.Lock()
	statuses := t.statusWaiters
	orders := t.orderWaiters
	t.statusWaiters = make(map[int64]chan statusResponse)
	t.orderWaiters = make(map[uint64]chan order)
	t.mu.Unlock()

	for _, ch := range statuses {
		close(ch)
	}
	for _, ch := range orders {
		close(ch)
	}
}

// submit sends one order frame and waits for both the gateway acknowledgement
// (mt:3) and the first order update (mt:24) for it.
//
// The two are different things and conflating them is the classic mistake here:
// code 0 on mt:3 means "accepted for forwarding", not "posted" and not
// "filled". A rejection that never reaches the chain — order forwarding not
// authorized, for instance — arrives on mt:24 with a failed status.
func (t *tradingClient) submit(ctx context.Context, req orderRequest, wait time.Duration) (order, error) {
	t.mu.Lock()
	conn, connected := t.conn, t.connected
	t.seq++
	if t.seq == 0 {
		t.seq = 1
	}
	req.Seq = t.seq
	statusCh := make(chan statusResponse, 1)
	orderCh := make(chan order, 4)
	t.statusWaiters[req.Seq] = statusCh
	t.orderWaiters[req.RequestID] = orderCh
	t.mu.Unlock()

	defer func() {
		t.mu.Lock()
		delete(t.statusWaiters, req.Seq)
		delete(t.orderWaiters, req.RequestID)
		t.mu.Unlock()
	}()

	if !connected {
		return order{}, errDisconnected
	}
	if err := writeJSON(ctx, conn, req); err != nil {
		return order{}, err
	}

	select {
	case <-ctx.Done():
		return order{}, ctx.Err()
	case st, ok := <-statusCh:
		if !ok {
			return order{}, errDisconnected
		}
		if st.Status.Code != 0 {
			return order{}, &Rejection{Stage: "gateway", Code: st.Status.Code, Reason: st.Status.Error}
		}
	}

	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return order{}, ctx.Err()
	case o, ok := <-orderCh:
		if !ok {
			return order{}, errDisconnected
		}
		return o, nil
	case <-timer.C:
		return order{}, fmt.Errorf("perpl: no order update for request %d within %s: %w", req.RequestID, wait, venue.ErrUnconfirmed)
	}
}

// nextRequestID returns the next idempotency key. It must strictly increase per
// account and starts from the venue's own last forwarded id.
func (t *tradingClient) nextRequestID() uint64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.nextReqID <= t.account.LastReqID {
		t.nextReqID = t.account.LastReqID + 1
	}
	id := t.nextReqID
	t.nextReqID++
	return id
}

func (t *tradingClient) isClosing() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.closing
}

func (t *tradingClient) close() {
	t.mu.Lock()
	t.closing = true
	conn := t.conn
	t.mu.Unlock()
	if conn != nil {
		_ = conn.Close(websocket.StatusNormalClosure, "")
	}
}

// isAuthFailure reports whether a session ended because the server rejected
// the sign-in frame (close code 3401).
func isAuthFailure(err error) bool {
	return websocket.CloseStatus(err) == closeUnauthorized
}

// closeUnauthorized is the server's close code for a rejected sign-in.
const closeUnauthorized websocket.StatusCode = 3401

// Rejection is the venue's refusal of an order, with the stage it happened at.
type Rejection struct {
	// Stage is "gateway" for a frame the gateway refused before the chain,
	// or "exchange" for an order the exchange failed.
	Stage  string
	Code   int
	Reason string
}

func (r *Rejection) Error() string {
	return fmt.Sprintf("perpl: order rejected at %s: code %d: %s", r.Stage, r.Code, r.Reason)
}
