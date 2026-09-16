package platform

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/deposit"
	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/insight"
	"github.com/wagmiCTO/super-agent/services/internal/keys"
	"github.com/wagmiCTO/super-agent/services/internal/policy"
	"github.com/wagmiCTO/super-agent/services/internal/store"
	"github.com/wagmiCTO/super-agent/services/internal/strategy"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

// Handler exposes the service over HTTP. Every amount in the wire format is a
// decimal string: JSON numbers are floats on the other side, and money is not.
//
// The contract is api/openapi.yaml; this file is the implementation of it and
// must not drift from it.
func Handler(s *Service, log *slog.Logger, opts ...Option) http.Handler {
	if log == nil {
		log = slog.Default()
	}
	var o options
	for _, opt := range opts {
		opt(&o)
	}
	authKeys := o.authKeys
	if authKeys == nil {
		authKeys = NewMemAuthKeys()
	}
	limitsStore := o.limits
	if limitsStore == nil {
		limitsStore = NewMemLimits()
	}
	referrals := o.referrals
	if referrals == nil {
		referrals = NewMemReferrals()
	}
	h := &handler{svc: s, log: log, enroll: o.enrollment, registry: o.registry, signals: o.signals, ledger: o.ledger, prize: o.prize, auth: newAuthenticator(authKeys), context: o.context, deposits: o.deposits, history: o.history, ownAccount: o.ownAccount, limits: limitsStore, referrals: referrals}
	if o.ledger != nil {
		s.UseLedger(o.ledger)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/auth/keys", h.registerAuthKey)
	mux.HandleFunc("POST /v1/exchange/enroll/payload", h.enrollPayload)
	mux.HandleFunc("POST /v1/exchange/enroll", h.enrollFinish)
	mux.HandleFunc("GET /v1/exchange/key", h.enrolledKey)
	mux.HandleFunc("GET /v1/exchange/keys", h.enrolledKeys)
	mux.HandleFunc("GET /v1/exchange/network", h.exchangeNetwork)
	mux.HandleFunc("GET /v1/signals/ma-cross", h.maCross)
	mux.HandleFunc("GET /v1/signals/rsi", h.rsi)
	mux.HandleFunc("GET /v1/leaderboard", h.leaderboard)
	mux.HandleFunc("GET /v1/leaderboard/standings", h.standings)
	mux.HandleFunc("GET /v1/prizes", h.prizes)
	mux.HandleFunc("GET /v1/prizes/history", h.prizeHistory)
	mux.HandleFunc("GET /v1/candles", h.candles)
	mux.HandleFunc("GET /v1/trades", h.trades)
	mux.HandleFunc("GET /v1/trades/{id}", h.trade)
	mux.HandleFunc("GET /v1/risk", h.risk)
	mux.HandleFunc("POST /v1/risk/close-all", h.closeAll)
	mux.HandleFunc("GET /v1/referral", h.referral)
	mux.HandleFunc("POST /v1/referral/claim", h.claimReferral)
	mux.HandleFunc("GET /v1/limits", h.getLimits)
	mux.HandleFunc("PUT /v1/limits", h.putLimits)
	mux.HandleFunc("GET /v1/context", h.marketContext)
	mux.HandleFunc("GET /v1/deposit/options", h.depositOptions)
	mux.HandleFunc("POST /v1/deposit/quote", h.depositQuote)
	mux.HandleFunc("GET /v1/deposit/status", h.depositStatus)
	mux.HandleFunc("GET /v1/health", h.health)
	mux.HandleFunc("GET /v1/markets", h.markets)
	mux.HandleFunc("GET /v1/state", h.state)
	mux.HandleFunc("POST /v1/orders/open", h.open)
	mux.HandleFunc("POST /v1/orders/close", h.close)
	mux.HandleFunc("POST /v1/kill", h.kill)
	mux.HandleFunc("POST /v1/revive", h.revive)
	var out http.Handler = h.auth.middleware(mux, log)
	if len(o.corsOrigins) > 0 {
		out = cors(out, o.corsOrigins)
	}
	return logRequests(out, log)
}

// Option configures the handler.
type Option func(*options)

type options struct {
	corsOrigins []string
	enrollment  *Enrollment
	registry    *Registry
	signals     *Signals
	ledger      *Ledger
	prize       *Prize
	authKeys    AuthKeys
	context     *MarketContext
	deposits    *Deposits
	history     *PrizeHistory
	ownAccount  bool
	limits      LimitsStore
	referrals   Referrals
}

// WithOwnAccount lets requests without a wallet header trade the
// platform's own exchange account. Off, the API serves enrolled wallets
// only; the platform's account stays what the signals and the browser
// tests run on, reachable from nowhere else. Keep it off in production.
func WithOwnAccount(enabled bool) Option {
	return func(o *options) { o.ownAccount = enabled }
}

// WithPrizeHistory serves the chain's record of the weekly prizes from the
// Envio indexer; without it /v1/prizes/history answers 503.
func WithPrizeHistory(p *PrizeHistory) Option {
	return func(o *options) { o.history = p }
}

// WithMarketContext serves the Nansen card; without it /v1/context answers 503.
func WithMarketContext(m *MarketContext) Option {
	return func(o *options) { o.context = m }
}

// WithDeposits serves any-chain deposits over Aurora; without it the
// deposit endpoints answer 503.
func WithDeposits(d *Deposits) Option {
	return func(o *options) { o.deposits = d }
}

// WithAuthKeys persists request-signing keys (ADR 0005). Without it they
// live in memory and are forgotten on restart.
func WithAuthKeys(k AuthKeys) Option {
	return func(o *options) { o.authKeys = k }
}

// WithLimitsStore keeps each wallet's chosen limits. Without it the choices
// live in memory and are lost on restart.
func WithLimitsStore(s LimitsStore) Option {
	return func(o *options) { o.limits = s }
}

// WithReferrals keeps the invite codes and who brought whom. Without it
// they live in memory and are lost on restart.
func WithReferrals(r Referrals) Option {
	return func(o *options) { o.referrals = r }
}

// WithRegistry routes requests carrying X-Account-Address to that wallet's
// own service. Requests without the header use the platform's own account.
func WithRegistry(r *Registry) Option {
	return func(o *options) { o.registry = r }
}

// WithSignals serves the strategies' signals.
func WithSignals(s *Signals) Option {
	return func(o *options) { o.signals = s }
}

// WithLedger serves the leaderboard.
func WithLedger(l *Ledger) Option {
	return func(o *options) { o.ledger = l }
}

// WithPrize adds the prize pool to the leaderboard and serves claims.
func WithPrize(p *Prize) Option {
	return func(o *options) { o.prize = p }
}

// WithEnrollment exposes the API-key enrollment endpoints. Without it they
// answer 503: the platform can trade with its own key but cannot take on
// user wallets, which is the state before a builder code is configured.
func WithEnrollment(e *Enrollment) Option {
	return func(o *options) { o.enrollment = e }
}

// WithCORS allows browser pages served from the given origins to call the API.
// The native app never needs this; the web build of the same app does, because
// a browser will not let a page on one origin read a response from another.
// Origins are matched exactly, so a stray "*" cannot slip in.
func WithCORS(origins []string) Option {
	return func(o *options) { o.corsOrigins = origins }
}

func cors(next http.Handler, allowed []string) http.Handler {
	allow := make(map[string]bool, len(allowed))
	for _, a := range allowed {
		allow[strings.TrimRight(strings.TrimSpace(a), "/")] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && allow[origin] {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Vary", "Origin")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
			// Bypass-Tunnel-Reminder is what the app sends when the platform
			// sits behind a localtunnel during phone testing; harmless otherwise.
			h.Set("Access-Control-Allow-Headers", "Content-Type, "+AccountHeader+", "+StrategyHeader+", "+AuthKeyHeader+", "+AuthTimeHeader+", "+AuthSigHeader+", Bypass-Tunnel-Reminder")
			h.Set("Access-Control-Max-Age", "600")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

type handler struct {
	svc        *Service
	log        *slog.Logger
	enroll     *Enrollment
	registry   *Registry
	signals    *Signals
	ledger     *Ledger
	prize      *Prize
	auth       *authenticator
	context    *MarketContext
	deposits   *Deposits
	history    *PrizeHistory
	ownAccount bool
	limits     LimitsStore
	referrals  Referrals
}

// AccountHeader names the wallet a request acts for. On its own it is
// routing; a wallet that registered a request-signing key is also
// authenticated on every request (see auth.go).
const AccountHeader = "X-Account-Address"

// StrategyHeader names the strategy a request acts for, which picks the
// wallet's key for it (ADR 0005). The query parameter and, for orders, the
// body field say the same thing; the header wins when both are present.
const StrategyHeader = "X-Strategy"

// strategyOf reads the request's strategy from the header or the query.
func strategyOf(r *http.Request) string {
	if s := strings.TrimSpace(r.Header.Get(StrategyHeader)); s != "" {
		return s
	}
	return strings.TrimSpace(r.URL.Query().Get("strategy"))
}

// service picks the Service for a request: the wallet named in the header, or
// the platform's own. ok is false when the response has already been written.
func (h *handler) service(w http.ResponseWriter, r *http.Request) (*Service, bool) {
	return h.serviceFor(w, r, strategyOf(r))
}

// serviceFor is service with the strategy known from the body.
func (h *handler) serviceFor(w http.ResponseWriter, r *http.Request, strategyID string) (*Service, bool) {
	addr := strings.TrimSpace(r.Header.Get(AccountHeader))
	if addr == "" {
		if !h.ownAccount {
			writeJSON(w, http.StatusForbidden, errorDTO{Error: "own_account_disabled", Message: "this platform trades for enrolled wallets only — sign in with a passkey"})
			return nil, false
		}
		return h.svc, true
	}
	if h.registry == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "enrollment_unavailable", Message: "per-wallet trading is not enabled"})
		return nil, false
	}
	if strategyID == "" {
		strategyID = strategyOf(r)
	}
	svc, err := h.registry.Get(r.Context(), addr, strategyID)
	if err != nil {
		if errors.Is(err, ErrNoKey) {
			msg := "no exchange key is enrolled for this wallet"
			if strategyID != "" {
				msg = "this wallet has no key for the " + strategyID + " strategy yet — enable it first"
			}
			writeJSON(w, http.StatusNotFound, errorDTO{Error: "no_key", Message: msg})
			return nil, false
		}
		h.fail(w, err)
		return nil, false
	}
	return svc, true
}

// --- wire types ---

type marketDTO struct {
	Symbol              string  `json:"symbol"`
	MaxLeverage         string  `json:"max_leverage"`
	LiquidationLeverage string  `json:"liquidation_leverage"`
	PriceTick           string  `json:"price_tick"`
	SizeStep            string  `json:"size_step"`
	OrderTTLSeconds     float64 `json:"order_ttl_seconds"`
	Fees                feesDTO `json:"fees"`
}

type feesDTO struct {
	MakerRate          string `json:"maker_rate"`
	TakerRate          string `json:"taker_rate"`
	BuilderRate        string `json:"builder_rate"`
	ChargedOn          string `json:"charged_on"`
	PostingFee         string `json:"posting_fee"`
	RoundTripTaker     string `json:"round_trip_taker"`
	RoundTripTakerBps  string `json:"round_trip_taker_bps"`
	BreakEvenMoveTaker string `json:"break_even_move_taker"`
}

type accountDTO struct {
	ID       string `json:"id"`
	Balance  string `json:"balance"`
	Locked   string `json:"locked"`
	CanTrade bool   `json:"can_trade"`
	Frozen   bool   `json:"frozen"`
	FeeTier  int    `json:"fee_tier"`
	// Status explains why CanTrade is false so the app can show the right
	// next step instead of a generic "cannot trade".
	Status string `json:"status"`
}

// accountStatus classifies the venue account for the app: what stands
// between this wallet and its first order.
func accountStatus(a venue.Account) string {
	switch {
	case a.VenueID == "" || a.VenueID == "0":
		return "no_exchange_account"
	case a.Frozen:
		return "frozen"
	case !a.CanTrade:
		return "forwarding_disabled"
	default:
		return "active"
	}
}

type positionDTO struct {
	ID            string `json:"id"`
	Symbol        string `json:"symbol"`
	Side          string `json:"side"`
	Size          string `json:"size"`
	EntryPrice    string `json:"entry_price"`
	Notional      string `json:"notional"`
	Collateral    string `json:"collateral"`
	Leverage      string `json:"leverage"`
	UnrealizedPnL string `json:"unrealized_pnl"`
	FeesPaid      string `json:"fees_paid"`
	OpenedAt      string `json:"opened_at,omitempty"`
	// ClosesAt is when the horizon closes this position; absent without one.
	ClosesAt string `json:"closes_at,omitempty"`
	// MaxLoss is the armed stop as a fraction of collateral, and StopPnL the
	// unrealized result at which it closes; absent without a stop.
	MaxLoss string `json:"max_loss,omitempty"`
	StopPnL string `json:"stop_pnl,omitempty"`
	// TakeProfit is the armed target as a fraction of collateral, and TPPnL
	// the unrealized result at which it closes; absent without a target.
	TakeProfit string `json:"take_profit,omitempty"`
	TPPnL      string `json:"tp_pnl,omitempty"`
	// LiquidationPrice is where the venue would liquidate, estimated from
	// the entry, the leverage and the market's maintenance margin; absent
	// when the venue does not publish the latter.
	LiquidationPrice string `json:"liquidation_price,omitempty"`
}

type limitsDTO struct {
	AllowedSymbols   []string `json:"allowed_symbols"`
	MinNotional      string   `json:"min_notional"`
	MaxNotional      string   `json:"max_notional"`
	MaxLeverage      string   `json:"max_leverage"`
	MaxTotalExposure string   `json:"max_total_exposure"`
	MaxOpenPositions int      `json:"max_open_positions"`
	DailyLoss        string   `json:"daily_loss"`
	CooldownSeconds  float64  `json:"cooldown_seconds"`
}

type riskDTO struct {
	OpenPositions int    `json:"open_positions"`
	Exposure      string `json:"exposure"`
	DailyLoss     string `json:"daily_loss"`
	LastOpen      string `json:"last_open,omitempty"`
}

type stateDTO struct {
	Venue     string        `json:"venue"`
	Account   accountDTO    `json:"account"`
	Positions []positionDTO `json:"positions"`
	LastClose *lastCloseDTO `json:"last_close,omitempty"`
	Limits    limitsDTO     `json:"limits"`
	Risk      riskDTO       `json:"risk"`
	Killed    bool          `json:"killed"`
	KillNote  string        `json:"kill_note,omitempty"`
}

type openReqDTO struct {
	Symbol   string `json:"symbol"`
	Side     string `json:"side"`
	Notional string `json:"notional"`
	Leverage string `json:"leverage"`
	// HorizonSeconds closes the position after this long; 0 or absent
	// leaves it to the user.
	HorizonSeconds int `json:"horizon_seconds"`
	// Strategy tags the round trip for the leaderboard.
	Strategy string `json:"strategy"`
	// MaxLoss arms a stop: the fraction of collateral the position may
	// lose before the platform closes it. Absent or "0" arms none.
	MaxLoss string `json:"max_loss,omitempty"`
	// TakeProfit arms a target: the fraction of collateral the position
	// may make before the platform closes it. Absent or "0" arms none.
	TakeProfit string `json:"take_profit,omitempty"`
}

type lastCloseDTO struct {
	Symbol string `json:"symbol"`
	Side   string `json:"side"`
	Reason string `json:"reason"`
	Price  string `json:"price"`
	PnL    string `json:"pnl"`
	At     string `json:"at"`
}

type closeReqDTO struct {
	Symbol   string `json:"symbol"`
	Strategy string `json:"strategy,omitempty"`
}

type orderDTO struct {
	ClientID   string  `json:"client_id"`
	VenueID    string  `json:"venue_id"`
	Symbol     string  `json:"symbol"`
	Side       string  `json:"side"`
	Status     string  `json:"status"`
	Size       string  `json:"size"`
	FilledSize string  `json:"filled_size"`
	AvgPrice   string  `json:"avg_price"`
	Fee        string  `json:"fee"`
	BuilderFee string  `json:"builder_fee"`
	Rejection  *rejDTO `json:"rejection,omitempty"`
	UpdatedAt  string  `json:"updated_at,omitempty"`
}

type rejDTO struct {
	Code   string `json:"code"`
	Detail string `json:"detail,omitempty"`
}

type killReqDTO struct {
	Reason string `json:"reason"`
}

// errorDTO is the one error shape. `error` is a stable machine code; `message`
// is for a person. Policy denials add the limit that was hit.
type errorDTO struct {
	Error      string  `json:"error"`
	Message    string  `json:"message"`
	Limit      string  `json:"limit,omitempty"`
	Actual     string  `json:"actual,omitempty"`
	RetryAfter float64 `json:"retry_after_seconds,omitempty"`
}

// --- handlers ---

func (h *handler) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *handler) markets(w http.ResponseWriter, r *http.Request) {
	// Markets are the venue's, not an account's: served from the platform's
	// own connection for everyone.
	svc := h.svc
	ms, err := svc.Markets(r.Context())
	if err != nil {
		h.fail(w, err)
		return
	}
	out := make([]marketDTO, 0, len(ms))
	for _, m := range ms {
		out = append(out, toMarketDTO(m))
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *handler) state(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.service(w, r)
	if !ok {
		return
	}
	st, err := svc.State(r.Context())
	if err != nil {
		h.fail(w, err)
		return
	}
	// Markets once, for the liquidation price of what is open.
	markets := map[string]venue.Market{}
	if len(st.Positions) > 0 {
		if ms, err := h.svc.Markets(r.Context()); err == nil {
			for _, m := range ms {
				markets[m.Symbol] = m
			}
		}
	}
	writeJSON(w, http.StatusOK, toStateDTO(st, markets))
}

func (h *handler) open(w http.ResponseWriter, r *http.Request) {
	var in openReqDTO
	if err := decode(r, &in); err != nil {
		h.fail(w, err)
		return
	}
	req, err := parseOpen(in)
	if err != nil {
		h.fail(w, err)
		return
	}
	svc, ok := h.serviceFor(w, r, req.Strategy)
	if !ok {
		return
	}
	order, err := svc.Open(r.Context(), req)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toOrderDTO(order))
}

func (h *handler) close(w http.ResponseWriter, r *http.Request) {
	var in closeReqDTO
	if err := decode(r, &in); err != nil {
		h.fail(w, err)
		return
	}
	svc, ok := h.serviceFor(w, r, strings.TrimSpace(in.Strategy))
	if !ok {
		return
	}
	order, err := svc.Close(r.Context(), CloseRequest{Symbol: in.Symbol})
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toOrderDTO(order))
}

func (h *handler) kill(w http.ResponseWriter, r *http.Request) {
	var in killReqDTO
	if err := decode(r, &in); err != nil {
		h.fail(w, err)
		return
	}
	if strings.TrimSpace(in.Reason) == "" {
		h.fail(w, fmt.Errorf("%w: a reason is required to engage the kill switch", ErrInvalid))
		return
	}
	if !h.ownAccount {
		writeJSON(w, http.StatusForbidden, errorDTO{Error: "own_account_disabled", Message: "the kill switch is operated from the platform, not the API"})
		return
	}
	h.svc.Kill(in.Reason)
	h.log.Warn("kill switch engaged", "reason", in.Reason)
	writeJSON(w, http.StatusOK, map[string]any{"killed": true, "reason": in.Reason})
}

func (h *handler) revive(w http.ResponseWriter, r *http.Request) {
	if !h.ownAccount {
		writeJSON(w, http.StatusForbidden, errorDTO{Error: "own_account_disabled", Message: "the kill switch is operated from the platform, not the API"})
		return
	}
	h.svc.Revive()
	h.log.Warn("kill switch released")
	writeJSON(w, http.StatusOK, map[string]any{"killed": false})
}

// fail maps an error onto a status and the one error shape. The mapping is the
// contract: a policy denial is 403, a venue refusal is 422, bad input is 400.
func (h *handler) fail(w http.ResponseWriter, err error) {
	var denial *policy.Denial
	var rejection *venue.Rejection

	switch {
	case errors.As(err, &denial):
		writeJSON(w, http.StatusForbidden, errorDTO{
			Error:      string(denial.Reason),
			Message:    denial.Message,
			Limit:      zeroToEmpty(denial.Limit),
			Actual:     zeroToEmpty(denial.Actual),
			RetryAfter: denial.RetryAfter.Seconds(),
		})
	case errors.As(err, &rejection):
		writeJSON(w, http.StatusUnprocessableEntity, errorDTO{Error: "venue_rejected", Message: rejection.Error()})
	case errors.Is(err, venue.ErrRejected):
		writeJSON(w, http.StatusUnprocessableEntity, errorDTO{Error: "venue_rejected", Message: err.Error()})
	case isVenueHTTPError(err):
		writeJSON(w, http.StatusUnprocessableEntity, errorDTO{Error: "venue_rejected", Message: err.Error()})
	case errors.Is(err, venue.ErrUnknownMarket):
		writeJSON(w, http.StatusNotFound, errorDTO{Error: "unknown_market", Message: err.Error()})
	case errors.Is(err, ErrNoPosition):
		writeJSON(w, http.StatusNotFound, errorDTO{Error: "no_position", Message: err.Error()})
	case errors.Is(err, ErrInvalid):
		writeJSON(w, http.StatusBadRequest, errorDTO{Error: "invalid_request", Message: err.Error()})
	case errors.Is(err, venue.ErrNoExchangeAccount):
		// Not a refusal of this order: the wallet has no exchange account yet.
		writeJSON(w, http.StatusConflict, errorDTO{Error: "no_exchange_account", Message: "this wallet has no exchange account yet — fund it and activate trading first"})
	case errors.Is(err, venue.ErrForwardingDisabled):
		writeJSON(w, http.StatusConflict, errorDTO{Error: "forwarding_disabled", Message: "the exchange account has not authorized API trading yet"})
	case errors.Is(err, venue.ErrUnconfirmed):
		writeJSON(w, http.StatusGatewayTimeout, errorDTO{Error: "venue_unconfirmed", Message: "the exchange accepted the order but reported no outcome in time — check the position, then retry"})
	case errors.Is(err, venue.ErrDisconnected):
		// Not a refusal: the venue link dropped mid-request and the outcome is
		// unknown. The app re-reads state on its next poll; the player retries.
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "venue_disconnected", Message: "lost the exchange connection while placing the order — check the position and retry"})
	case isPartnerError(err):
		// Nansen or Aurora refused or failed: not ours, and their text is
		// written for people (a minimum amount, an unsupported pair).
		writeJSON(w, http.StatusBadGateway, errorDTO{Error: "partner_error", Message: partnerMessage(err)})
	case errors.Is(err, venue.ErrNoCredentials):
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "no_credentials", Message: "the service has no venue credentials"})
	default:
		h.log.Error("request failed", "err", err)
		writeJSON(w, http.StatusInternalServerError, errorDTO{Error: "internal", Message: "internal error"})
	}
}

// --- translation ---

func parseOpen(in openReqDTO) (OpenRequest, error) {
	var side venue.Side
	switch strings.ToLower(strings.TrimSpace(in.Side)) {
	case "long", "buy", "up":
		side = venue.Long
	case "short", "sell", "down":
		side = venue.Short
	default:
		return OpenRequest{}, fmt.Errorf("%w: side must be long or short", ErrInvalid)
	}
	notional, err := fixed.Parse(in.Notional)
	if err != nil {
		return OpenRequest{}, fmt.Errorf("%w: notional: %v", ErrInvalid, err)
	}
	leverage := fixed.FromInt(1)
	if strings.TrimSpace(in.Leverage) != "" {
		if leverage, err = fixed.Parse(in.Leverage); err != nil {
			return OpenRequest{}, fmt.Errorf("%w: leverage: %v", ErrInvalid, err)
		}
	}
	if in.HorizonSeconds < 0 {
		return OpenRequest{}, fmt.Errorf("%w: horizon_seconds must not be negative", ErrInvalid)
	}
	rules := strategy.Rules{Horizon: time.Duration(in.HorizonSeconds) * time.Second}
	var maxLoss, takeProfit fixed.D
	if strings.TrimSpace(in.MaxLoss) != "" {
		if maxLoss, err = fixed.Parse(in.MaxLoss); err != nil {
			return OpenRequest{}, fmt.Errorf("%w: max_loss: %v", ErrInvalid, err)
		}
	}
	if strings.TrimSpace(in.TakeProfit) != "" {
		if takeProfit, err = fixed.Parse(in.TakeProfit); err != nil {
			return OpenRequest{}, fmt.Errorf("%w: take_profit: %v", ErrInvalid, err)
		}
	}
	return OpenRequest{Symbol: in.Symbol, Side: side, Notional: notional, Leverage: leverage, Rules: rules, Strategy: strings.TrimSpace(in.Strategy), MaxLoss: maxLoss, TakeProfit: takeProfit}, nil
}

func toMarketDTO(m venue.Market) marketDTO {
	rt := m.Fees.RoundTripRate(false, false)
	return marketDTO{
		Symbol:              m.Symbol,
		MaxLeverage:         m.MaxLeverage.String(),
		LiquidationLeverage: m.LiquidationLeverage.String(),
		PriceTick:           m.PriceTick.String(),
		SizeStep:            m.SizeStep.String(),
		OrderTTLSeconds:     m.OrderTTL.Seconds(),
		Fees: feesDTO{
			MakerRate:          m.Fees.MakerRate.String(),
			TakerRate:          m.Fees.TakerRate.String(),
			BuilderRate:        m.Fees.BuilderRate.String(),
			ChargedOn:          m.Fees.ChargedOn.String(),
			PostingFee:         m.Fees.PostingFee.String(),
			RoundTripTaker:     rt.String(),
			RoundTripTakerBps:  rt.InBps().String(),
			BreakEvenMoveTaker: m.Fees.BreakEvenMove(false, false).String(),
		},
	}
}

// toStateDTO renders the state; markets, when given, add each position's
// liquidation price.
func toStateDTO(st State, markets map[string]venue.Market) stateDTO {
	positions := make([]positionDTO, 0, len(st.Positions))
	for _, p := range st.Positions {
		var m *venue.Market
		if mk, ok := markets[p.Symbol]; ok {
			m = &mk
		}
		positions = append(positions, toPositionDTO(p, st, m))
	}
	var last *lastCloseDTO
	if st.LastClose != nil {
		last = &lastCloseDTO{
			Symbol: st.LastClose.Symbol, Side: st.LastClose.Side.String(), Reason: string(st.LastClose.Reason),
			Price: st.LastClose.Price.String(), PnL: st.LastClose.PnL.String(), At: timeOrEmpty(st.LastClose.At),
		}
	}
	return stateDTO{
		Venue:     st.Venue,
		LastClose: last,
		Account: accountDTO{
			ID:       st.Account.VenueID,
			Balance:  st.Account.Balance.String(),
			Locked:   st.Account.Locked.String(),
			CanTrade: st.Account.CanTrade,
			Status:   accountStatus(st.Account),
			Frozen:   st.Account.Frozen,
			FeeTier:  st.Account.FeeTier,
		},
		Positions: positions,
		Limits: limitsDTO{
			AllowedSymbols:   st.Limits.AllowedSymbols,
			MinNotional:      st.Limits.MinNotional.String(),
			MaxNotional:      st.Limits.MaxNotional.String(),
			MaxLeverage:      st.Limits.MaxLeverage.String(),
			MaxTotalExposure: st.Limits.MaxTotalExposure.String(),
			MaxOpenPositions: st.Limits.MaxOpenPositions,
			DailyLoss:        st.Limits.DailyLoss.String(),
			CooldownSeconds:  st.Limits.Cooldown.Seconds(),
		},
		Risk: riskDTO{
			OpenPositions: st.Risk.OpenPositions,
			Exposure:      st.Risk.Exposure.String(),
			DailyLoss:     st.Risk.DailyLoss.String(),
			LastOpen:      timeOrEmpty(st.Risk.LastOpen),
		},
		Killed:   st.Killed,
		KillNote: st.KillNote,
	}
}

func toOrderDTO(o venue.Order) orderDTO {
	out := orderDTO{
		ClientID:   o.ClientID,
		VenueID:    o.VenueID,
		Symbol:     o.Symbol,
		Side:       o.Side.String(),
		Status:     o.Status.String(),
		Size:       o.Size.String(),
		FilledSize: o.FilledSize.String(),
		AvgPrice:   o.AvgPrice.String(),
		Fee:        o.Fee.String(),
		BuilderFee: o.BuilderFee.String(),
		UpdatedAt:  timeOrEmpty(o.UpdatedAt),
	}
	if o.Rejection != nil {
		out.Rejection = &rejDTO{Code: o.Rejection.Code, Detail: o.Rejection.Detail}
	}
	return out
}

// --- enrollment ---

type enrollPayloadReqDTO struct {
	Address string `json:"address"`
	Label   string `json:"label"`
	// Strategy and PublicKey enroll a device-derived key for one strategy
	// (ADR 0005); without them the platform generates a wallet-wide key.
	Strategy  string `json:"strategy,omitempty"`
	PublicKey string `json:"public_key,omitempty"`
}

type enrollPayloadDTO struct {
	Handle        string          `json:"handle"`
	Strategy      string          `json:"strategy,omitempty"`
	PublicKey     string          `json:"public_key"`
	SignInMessage string          `json:"sign_in_message"`
	TypedData     json.RawMessage `json:"typed_data"`
	Statement     string          `json:"statement"`
	BuilderID     int             `json:"builder_id"`
	MaxFee        int             `json:"max_builder_fee_per_100k"`
	ExpiresAt     string          `json:"expires_at"`
}

type enrollReqDTO struct {
	Handle          string `json:"handle"`
	SignInSignature string `json:"sign_in_signature"`
	Signature       string `json:"signature"`
	// PrivateKey is the derived key's 32-byte seed, 0x-hex; the platform
	// trades with it and stores it sealed.
	PrivateKey string `json:"private_key,omitempty"`
}

type enrolledKeyDTO struct {
	Address    string `json:"address"`
	Strategy   string `json:"strategy"`
	Derived    bool   `json:"derived"`
	Label      string `json:"label"`
	BuilderID  int    `json:"builder_id"`
	MaxFee     int    `json:"max_builder_fee_per_100k"`
	MaxFeePct  string `json:"max_builder_fee_pct"`
	EnrolledAt string `json:"enrolled_at"`
}

func (h *handler) enrollPayload(w http.ResponseWriter, r *http.Request) {
	if h.enroll == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "enrollment_unavailable", Message: "no builder code is configured"})
		return
	}
	var in enrollPayloadReqDTO
	if err := decode(r, &in); err != nil {
		h.fail(w, err)
		return
	}
	var pub []byte
	if pk := strings.TrimSpace(in.PublicKey); pk != "" {
		var err error
		if pub, err = hex.DecodeString(strings.TrimPrefix(pk, "0x")); err != nil {
			h.fail(w, fmt.Errorf("%w: public_key must be hex", ErrInvalid))
			return
		}
	}
	res, err := h.enroll.Payload(r.Context(), PayloadRequest{Address: in.Address, Strategy: in.Strategy, Label: in.Label, PublicKey: pub})
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, enrollPayloadDTO{
		Handle:        res.Handle,
		Strategy:      res.Strategy,
		PublicKey:     res.PublicKey,
		SignInMessage: res.SignInMessage,
		TypedData:     res.TypedData,
		Statement:     res.Statement,
		BuilderID:     res.BuilderID,
		MaxFee:        res.MaxFee,
		ExpiresAt:     timeOrEmpty(res.ExpiresAt),
	})
}

func (h *handler) enrollFinish(w http.ResponseWriter, r *http.Request) {
	if h.enroll == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "enrollment_unavailable", Message: "no builder code is configured"})
		return
	}
	var in enrollReqDTO
	if err := decode(r, &in); err != nil {
		h.fail(w, err)
		return
	}
	k, err := h.enroll.Enroll(r.Context(), in.Handle, in.SignInSignature, in.Signature, in.PrivateKey)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toEnrolledKeyDTO(k))
}

func toEnrolledKeyDTO(k keys.Key) enrolledKeyDTO {
	return enrolledKeyDTO{
		Address: k.Address, Strategy: k.Strategy, Derived: k.Derived, Label: k.Label, BuilderID: k.BuilderID,
		MaxFee: k.MaxBuilderFeePer100K, MaxFeePct: k.MaxBuilderFeePct, EnrolledAt: timeOrEmpty(k.EnrolledAt),
	}
}

// enrolledKeys lists a wallet's keys: which strategies are enabled.
func (h *handler) enrolledKeys(w http.ResponseWriter, r *http.Request) {
	if h.enroll == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "enrollment_unavailable", Message: "no builder code is configured"})
		return
	}
	address := r.URL.Query().Get("address")
	if !isAddress(strings.TrimSpace(address)) {
		h.fail(w, fmt.Errorf("%w: address must be 0x followed by 40 hex characters", ErrInvalid))
		return
	}
	list := h.enroll.Keys(address)
	out := make([]enrolledKeyDTO, 0, len(list))
	for _, k := range list {
		out = append(out, toEnrolledKeyDTO(k))
	}
	writeJSON(w, http.StatusOK, out)
}

type exchangeNetworkDTO struct {
	Network              string `json:"network"`
	ChainID              int64  `json:"chain_id"`
	RPCURL               string `json:"rpc_url"`
	Explorer             string `json:"explorer"`
	ExchangeAddress      string `json:"exchange_address"`
	CollateralToken      string `json:"collateral_token"`
	CollateralSymbol     string `json:"collateral_symbol"`
	CollateralDecimals   int    `json:"collateral_decimals"`
	MinAccountOpenAmount string `json:"min_account_open_amount"`
	MinAccountOpenRaw    string `json:"min_account_open_raw"`
}

// exchangeNetwork serves the on-chain coordinates for activating a wallet's
// exchange account. Public: nothing here is per-wallet.
func (h *handler) exchangeNetwork(w http.ResponseWriter, r *http.Request) {
	if h.enroll == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "enrollment_unavailable", Message: "no builder code is configured"})
		return
	}
	act, err := h.enroll.Activation(r.Context())
	if err != nil {
		h.fail(w, err)
		return
	}
	raw, err := strconv.ParseInt(act.MinAccountOpenAmount, 10, 64)
	if err != nil {
		h.fail(w, fmt.Errorf("min_account_open_amount %q: %w", act.MinAccountOpenAmount, err))
		return
	}
	minOpen, err := fixed.FromScaled(raw, act.CollateralDecimals)
	if err != nil {
		h.fail(w, fmt.Errorf("min_account_open_amount %q: %w", act.MinAccountOpenAmount, err))
		return
	}
	writeJSON(w, http.StatusOK, exchangeNetworkDTO{
		Network: act.Network, ChainID: act.ChainID, RPCURL: act.RPCURL, Explorer: act.Explorer,
		ExchangeAddress: act.ExchangeAddress, CollateralToken: act.CollateralToken,
		CollateralSymbol: act.CollateralSymbol, CollateralDecimals: act.CollateralDecimals,
		MinAccountOpenAmount: minOpen.String(), MinAccountOpenRaw: act.MinAccountOpenAmount,
	})
}

// --- signals ---

type signalPointDTO struct {
	At    string `json:"at"`
	Open  string `json:"open"`
	High  string `json:"high"`
	Low   string `json:"low"`
	Close string `json:"close"`
	Fast  string `json:"fast,omitempty"`
	Slow  string `json:"slow,omitempty"`
}

type signalWindowDTO struct {
	Side      string `json:"side"`
	OpenedAt  string `json:"opened_at"`
	ExpiresAt string `json:"expires_at"`
}

type signalCrossDTO struct {
	Side string `json:"side"`
	At   string `json:"at"`
}

type maCrossDTO struct {
	Symbol        string           `json:"symbol"`
	PeriodSeconds int              `json:"period_seconds"`
	Fast          int              `json:"fast"`
	Slow          int              `json:"slow"`
	Ready         bool             `json:"ready"`
	Trend         string           `json:"trend"`
	Forming       bool             `json:"forming"`
	Window        *signalWindowDTO `json:"window,omitempty"`
	LastCross     *signalCrossDTO  `json:"last_cross,omitempty"`
	Points        []signalPointDTO `json:"points"`
}

type rsiCrossDTO struct {
	Side  string `json:"side"`
	At    string `json:"at"`
	Value string `json:"value"`
}

type rsiPointDTO struct {
	At    string `json:"at"`
	Close string `json:"close"`
	Value string `json:"value,omitempty"`
}

type rsiDTO struct {
	Symbol        string           `json:"symbol"`
	PeriodSeconds int              `json:"period_seconds"`
	Length        int              `json:"length"`
	Oversold      string           `json:"oversold"`
	Overbought    string           `json:"overbought"`
	Ready         bool             `json:"ready"`
	Value         string           `json:"value"`
	Forming       bool             `json:"forming"`
	Window        *signalWindowDTO `json:"window,omitempty"`
	LastCross     *rsiCrossDTO     `json:"last_cross,omitempty"`
	Points        []rsiPointDTO    `json:"points"`
}

// rsi serves the RSI signal for a market: the index, the zones, and whether
// an entry is on offer right now.
func (h *handler) rsi(w http.ResponseWriter, r *http.Request) {
	if h.signals == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "signals_unavailable", Message: "no signals are running"})
		return
	}
	symbol := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("symbol")))
	st, ok := h.signals.RSI(symbol)
	if !ok {
		writeJSON(w, http.StatusNotFound, errorDTO{Error: "unknown_market", Message: "no signal for this market"})
		return
	}
	out := rsiDTO{
		Symbol: st.Symbol, PeriodSeconds: int(st.Period / time.Second), Length: st.Length, Oversold: st.Oversold.String(), Overbought: st.Overbought.String(),
		Ready: st.Ready, Value: st.Value.String(), Forming: st.Forming, Points: make([]rsiPointDTO, 0, len(st.Points)),
	}
	for _, p := range st.Points {
		d := rsiPointDTO{At: p.At.UTC().Format(time.RFC3339), Close: p.Close.String()}
		if !p.Value.IsZero() {
			d.Value = p.Value.String()
		}
		out.Points = append(out.Points, d)
	}
	if st.Window != nil {
		out.Window = &signalWindowDTO{Side: st.Window.Side.String(), OpenedAt: timeOrEmpty(st.Window.OpenedAt), ExpiresAt: timeOrEmpty(st.Window.ExpiresAt)}
	}
	if st.LastCross != nil {
		out.LastCross = &rsiCrossDTO{Side: st.LastCross.Side.String(), At: timeOrEmpty(st.LastCross.At), Value: st.LastCross.Value.String()}
	}
	writeJSON(w, http.StatusOK, out)
}

// maCross serves the MA Cross signal for a market: the chart, the trend,
// and whether an entry is on offer right now. Public and shared: the signal
// is about the market, not the caller.
func (h *handler) maCross(w http.ResponseWriter, r *http.Request) {
	if h.signals == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "signals_unavailable", Message: "no signals are running"})
		return
	}
	symbol := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("symbol")))
	st, ok := h.signals.MACross(symbol)
	if !ok {
		writeJSON(w, http.StatusNotFound, errorDTO{Error: "unknown_market", Message: "no signal for this market"})
		return
	}
	out := maCrossDTO{
		Symbol: st.Symbol, PeriodSeconds: int(st.Period / time.Second), Fast: st.Fast, Slow: st.Slow,
		Ready: st.Ready, Trend: string(st.Trend), Forming: st.Forming, Points: make([]signalPointDTO, 0, len(st.Points)),
	}
	for _, p := range st.Points {
		d := signalPointDTO{At: p.At.UTC().Format(time.RFC3339), Open: p.Open.String(), High: p.High.String(), Low: p.Low.String(), Close: p.Close.String()}
		if !p.Fast.IsZero() {
			d.Fast = p.Fast.String()
		}
		if !p.Slow.IsZero() {
			d.Slow = p.Slow.String()
		}
		out.Points = append(out.Points, d)
	}
	if st.Window != nil {
		out.Window = &signalWindowDTO{Side: st.Window.Side.String(), OpenedAt: timeOrEmpty(st.Window.OpenedAt), ExpiresAt: timeOrEmpty(st.Window.ExpiresAt)}
	}
	if st.LastCross != nil {
		out.LastCross = &signalCrossDTO{Side: st.LastCross.Side.String(), At: timeOrEmpty(st.LastCross.At)}
	}
	writeJSON(w, http.StatusOK, out)
}

// --- candles ---

type candleDTO struct {
	Time   int64  `json:"t"`
	Open   string `json:"o"`
	High   string `json:"h"`
	Low    string `json:"l"`
	Close  string `json:"c"`
	Volume string `json:"v"`
}

// candles serves OHLCV history for the chart from the platform's own
// market-data connection: ?symbol=MON&period_seconds=60&from=<unix>&to=<unix>.
// Public and shared, like the signals.
func (h *handler) candles(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	period, err := strconv.Atoi(q.Get("period_seconds"))
	if err != nil || period <= 0 {
		writeJSON(w, http.StatusBadRequest, errorDTO{Error: "invalid", Message: "period_seconds must be a positive integer"})
		return
	}
	from, err1 := strconv.ParseInt(q.Get("from"), 10, 64)
	to, err2 := strconv.ParseInt(q.Get("to"), 10, 64)
	if err1 != nil || err2 != nil {
		writeJSON(w, http.StatusBadRequest, errorDTO{Error: "invalid", Message: "from and to must be unix seconds"})
		return
	}
	bars, err := h.svc.Candles(r.Context(), q.Get("symbol"), time.Duration(period)*time.Second, time.Unix(from, 0), time.Unix(to, 0))
	if err != nil {
		h.fail(w, err)
		return
	}
	out := make([]candleDTO, 0, len(bars))
	for _, b := range bars {
		out = append(out, candleDTO{Time: b.Open.Unix(), Open: b.O.String(), High: b.H.String(), Low: b.L.String(), Close: b.C.String(), Volume: b.Volume.String()})
	}
	writeJSON(w, http.StatusOK, out)
}

// --- trades ---

type tradeDTO struct {
	// ID names the round trip for the card that reports it. Absent for a
	// trade the process has in memory but the journal never saw.
	ID          string `json:"id,omitempty"`
	Strategy    string `json:"strategy"`
	Symbol      string `json:"symbol"`
	Side        string `json:"side"`
	Size        string `json:"size"`
	EntryPrice  string `json:"entry_price"`
	EntryFee    string `json:"entry_fee"`
	ExitPrice   string `json:"exit_price,omitempty"`
	ExitFee     string `json:"exit_fee,omitempty"`
	PnL         string `json:"pnl,omitempty"`
	CloseReason string `json:"close_reason,omitempty"`
	OpenedAt    string `json:"opened_at"`
	ClosedAt    string `json:"closed_at,omitempty"`
	// What the position was made of and how far it ran. Absent on rows
	// journaled before the platform recorded them.
	Notional     string `json:"notional,omitempty"`
	Leverage     string `json:"leverage,omitempty"`
	Collateral   string `json:"collateral,omitempty"`
	StopPnL      string `json:"stop_pnl,omitempty"`
	TPPnL        string `json:"tp_pnl,omitempty"`
	WorstPnL     string `json:"worst_pnl,omitempty"`
	BestPnL      string `json:"best_pnl,omitempty"`
	OpenOrderID  string `json:"open_order_id,omitempty"`
	CloseOrderID string `json:"close_order_id,omitempty"`
}

// tradesPageDTO is one page of history and where the next one starts.
type tradesPageDTO struct {
	Trades []tradeDTO `json:"trades"`
	// NextCursor is empty on the last page.
	NextCursor string `json:"next_cursor,omitempty"`
}

// toTradeDTO renders one journaled round trip.
func toTradeDTO(t store.ClosedTrade) tradeDTO {
	d := tradeDTO{
		Strategy: t.Strategy, Symbol: t.Symbol, Side: t.Side, Size: t.Size.String(), EntryPrice: t.EntryPrice.String(),
		EntryFee: t.EntryFee.String(), OpenedAt: timeOrEmpty(t.OpenedAt), OpenOrderID: t.OpenOrderID, CloseOrderID: t.CloseOrderID,
	}
	if t.ID != 0 {
		d.ID = strconv.FormatInt(t.ID, 10)
	}
	if !t.ClosedAt.IsZero() {
		d.ExitPrice, d.ExitFee, d.PnL, d.CloseReason, d.ClosedAt = t.ExitPrice.String(), t.ExitFee.String(), t.PnL.String(), t.CloseReason, timeOrEmpty(t.ClosedAt)
	}
	// What was opened, as money: the size at the price it filled at.
	if t.Size.IsPos() && t.EntryPrice.IsPos() {
		d.Notional = t.Size.Mul(t.EntryPrice).String()
	}
	d.Leverage, d.Collateral = decimalOrEmpty(t.Leverage), decimalOrEmpty(t.Collateral)
	d.StopPnL, d.WorstPnL, d.BestPnL = decimalOrEmpty(t.StopPnL), decimalOrEmpty(t.WorstPnL), decimalOrEmpty(t.BestPnL)
	d.TPPnL = decimalOrEmpty(t.TakeProfitPnL)
	return d
}

// toPositionDTO renders one open position with its bounds: the horizon,
// the stop and the target the platform holds for it, and where the venue
// would liquidate it.
func toPositionDTO(p venue.Position, st State, market *venue.Market) positionDTO {
	d := positionDTO{
		ID:            p.VenueID,
		Symbol:        p.Symbol,
		Side:          p.Side.String(),
		Size:          p.Size.String(),
		EntryPrice:    p.EntryPrice.String(),
		Notional:      p.EntryPrice.Mul(p.Size).String(),
		Collateral:    p.Collateral.String(),
		Leverage:      p.Leverage.String(),
		UnrealizedPnL: p.UnrealizedPnL.String(),
		FeesPaid:      p.FeesPaid.String(),
		OpenedAt:      timeOrEmpty(p.OpenedAt),
		ClosesAt:      timeOrEmpty(st.Deadlines[p.Symbol]),
	}
	if ml, ok := st.Stops[p.Symbol]; ok && ml.IsPos() {
		d.MaxLoss = ml.String()
		d.StopPnL = p.Collateral.Mul(ml).Neg().String()
	}
	if tp, ok := st.TakeProfits[p.Symbol]; ok && tp.IsPos() {
		d.TakeProfit = tp.String()
		d.TPPnL = p.Collateral.Mul(tp).String()
	}
	if liq, _, ok := liquidationOf(p, market); ok {
		d.LiquidationPrice = liq.String()
	}
	return d
}

// liquidationOf estimates where the venue liquidates a position: at
// liquidation leverage L_liq the margin left is notional / L_liq, so the
// price may move 1/leverage − 1/L_liq against the entry. Fees and funding
// move it a little; the venue's own number is the one that counts.
func liquidationOf(p venue.Position, market *venue.Market) (price, distance fixed.D, ok bool) {
	if market == nil || !market.LiquidationLeverage.IsPos() || !p.EntryPrice.IsPos() || !p.Leverage.IsPos() {
		return 0, 0, false
	}
	one := fixed.FromInt(1)
	dist := one.Div(p.Leverage).Sub(one.Div(market.LiquidationLeverage))
	if !dist.IsPos() {
		return 0, 0, false
	}
	if p.Side == venue.Long {
		return p.EntryPrice.Mul(one.Sub(dist)), dist, true
	}
	return p.EntryPrice.Mul(one.Add(dist)), dist, true
}

func decimalOrEmpty(d *fixed.D) string {
	if d == nil {
		return ""
	}
	return d.String()
}

// trades lists the account's round trips, newest first, for the chart's
// marks and for history: ?symbol=MON&strategy=direction&limit=50&cursor=…
//
// One page at a time. History is a table that only grows, and a wallet that
// has played for a month should not have to wait for a month of rows to draw
// the first screen of them.
func (h *handler) trades(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.service(w, r)
	if !ok {
		return
	}
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	after, err := parseTradeCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		h.fail(w, err)
		return
	}
	// History leaves out the position that is still open; the chart's marks
	// want it, so this is asked for rather than assumed.
	closedOnly := r.URL.Query().Get("closed") == "1" || r.URL.Query().Get("closed") == "true"
	list, next, err := svc.TradesPage(r.Context(), store.TradeQuery{
		Symbol: r.URL.Query().Get("symbol"), Strategy: r.URL.Query().Get("strategy"),
		ClosedOnly: closedOnly, Limit: limit, After: after,
	})
	if err != nil {
		h.fail(w, err)
		return
	}
	out := tradesPageDTO{Trades: make([]tradeDTO, 0, len(list)), NextCursor: encodeTradeCursor(next)}
	for _, t := range list {
		out.Trades = append(out.Trades, toTradeDTO(t))
	}
	writeJSON(w, http.StatusOK, out)
}

// trade serves one round trip of the wallet's own, for the card that
// reports it. An id that belongs to another wallet is not found, because
// the wallet is part of the lookup rather than a check after it.
func (h *handler) trade(w http.ResponseWriter, r *http.Request) {
	svc, ok := h.service(w, r)
	if !ok {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		h.fail(w, fmt.Errorf("%w: trade id must be a number", ErrInvalid))
		return
	}
	t, found, err := svc.Trade(r.Context(), id)
	if err != nil {
		h.fail(w, err)
		return
	}
	if !found {
		writeJSON(w, http.StatusNotFound, errorDTO{Error: "no_trade", Message: "no such trade for this wallet"})
		return
	}
	writeJSON(w, http.StatusOK, toTradeDTO(t))
}

// A cursor is where the last page ended: the opening time and the row, so
// two trades opened in the same second cannot straddle a page boundary. It
// is opaque on purpose — the app carries it back, it does not read it.
func encodeTradeCursor(c store.TradeCursor) string {
	if c.IsZero() {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(fmt.Appendf(nil, "%d:%d", c.OpenedAt.UnixNano(), c.ID))
}

func parseTradeCursor(v string) (store.TradeCursor, error) {
	if strings.TrimSpace(v) == "" {
		return store.TradeCursor{}, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(v)
	if err != nil {
		return store.TradeCursor{}, fmt.Errorf("%w: cursor", ErrInvalid)
	}
	nanos, id, ok := strings.Cut(string(raw), ":")
	if !ok {
		return store.TradeCursor{}, fmt.Errorf("%w: cursor", ErrInvalid)
	}
	n, err1 := strconv.ParseInt(nanos, 10, 64)
	rowID, err2 := strconv.ParseInt(id, 10, 64)
	if err1 != nil || err2 != nil {
		return store.TradeCursor{}, fmt.Errorf("%w: cursor", ErrInvalid)
	}
	return store.TradeCursor{OpenedAt: time.Unix(0, n).UTC(), ID: rowID}, nil
}

// --- leaderboard ---

type standingDTO struct {
	Wallet string `json:"wallet"`
	PnL    string `json:"pnl"`
	Trades int    `json:"trades"`
	// Volume is what the wallet opened, in collateral units; the board is
	// ordered by it. Absent on the lobby's boards, which are by result.
	Volume string `json:"volume,omitempty"`
}

type boardDTO struct {
	ID        string        `json:"id"`
	Name      string        `json:"name"`
	Tagline   string        `json:"tagline"`
	Rhythm    string        `json:"rhythm"`
	PnL       string        `json:"pnl"`
	Players   int           `json:"players"`
	Trades    int           `json:"trades"`
	ActiveNow int           `json:"active_now"`
	Top       []standingDTO `json:"top"`
}

type prizePoolDTO struct {
	Strategy string `json:"strategy"`
	Pool     string `json:"pool"` // collateral units, decimal
}

type prizeWinnerDTO struct {
	Strategy string `json:"strategy"`
	Wallet   string `json:"wallet"`
	Amount   string `json:"amount"` // collateral units, decimal
	PnL      string `json:"pnl"`
	Claimed  bool   `json:"claimed"`
}

type prizeDTO struct {
	Contract string           `json:"contract"`
	Token    string           `json:"token"`
	Week     uint64           `json:"week"`
	Pools    []prizePoolDTO   `json:"pools"`
	LastWeek uint64           `json:"last_week"`
	Winners  []prizeWinnerDTO `json:"winners"`
}

type leaderboardDTO struct {
	WeekStart string `json:"week_start"`
	// Period is "week" (the week containing now) or "all" (every trade on
	// record). The prize is weekly whichever is asked for.
	Period string `json:"period"`
	// Source is "journal" when the boards come from the database, "memory"
	// when from the process (no database, or it is unreachable).
	Source string     `json:"source"`
	Boards []boardDTO `json:"boards"`
	// Prize is the on-chain pool, when one is configured.
	Prize *prizeDTO `json:"prize,omitempty"`
}

// tokenDecimal renders token units (AUSD micros) as a decimal string.
func tokenDecimal(units string) string {
	d, err := fixed.Parse(units)
	if err != nil {
		return units
	}
	return d.Div(fixed.FromInt(1_000_000)).String()
}

// prizeCache keeps the last prize block for a short while: the lobby polls
// every few seconds and each read is several calls to the chain.
var prizeCache struct {
	mu   sync.Mutex
	week uint64
	at   time.Time
	dto  *prizeDTO
}

const prizeCacheTTL = 30 * time.Second

// prizeBlock reads this week's pools and last week's winners.
func (h *handler) prizeBlock(r *http.Request, week uint64) *prizeDTO {
	prizeCache.mu.Lock()
	if prizeCache.dto != nil && prizeCache.week == week && time.Since(prizeCache.at) < prizeCacheTTL {
		dto := prizeCache.dto
		prizeCache.mu.Unlock()
		return dto
	}
	prizeCache.mu.Unlock()
	dto := h.readPrizeBlock(r, week)
	if dto != nil {
		prizeCache.mu.Lock()
		prizeCache.week, prizeCache.at, prizeCache.dto = week, time.Now(), dto
		prizeCache.mu.Unlock()
	}
	return dto
}

func (h *handler) readPrizeBlock(r *http.Request, week uint64) *prizeDTO {
	pools, err := h.prize.Pools(r.Context(), week)
	if err != nil {
		h.log.Warn("prize pools not read", "err", err)
		return nil
	}
	out := &prizeDTO{Contract: h.prize.Contract(), Token: h.prize.Token(), Week: week, LastWeek: week - 1, Pools: make([]prizePoolDTO, 0, len(pools)), Winners: []prizeWinnerDTO{}}
	for _, p := range pools {
		out.Pools = append(out.Pools, prizePoolDTO{Strategy: p.Strategy, Pool: tokenDecimal(p.Pool.String())})
	}
	if h.prize.store != nil {
		recs, err := h.prize.store.Prizes(r.Context(), week-1)
		if err == nil {
			for _, rec := range recs {
				_, claimed, err := h.prize.PrizeOf(r.Context(), rec.Week, rec.Strategy, rec.Wallet)
				if err != nil {
					claimed = false
				}
				out.Winners = append(out.Winners, prizeWinnerDTO{Strategy: rec.Strategy, Wallet: rec.Wallet, Amount: tokenDecimal(rec.Amount), PnL: rec.PnL.String(), Claimed: claimed})
			}
		}
	}
	return out
}

// prizes lists a wallet's published prizes and whether each was claimed.
func (h *handler) prizes(w http.ResponseWriter, r *http.Request) {
	if h.prize == nil || h.prize.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "prize_unavailable", Message: "no prize pool is configured"})
		return
	}
	address := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("address")))
	if address == "" {
		writeJSON(w, http.StatusBadRequest, errorDTO{Error: "invalid", Message: "address is required"})
		return
	}
	recs, err := h.prize.store.PrizesFor(r.Context(), address)
	if err != nil {
		h.fail(w, err)
		return
	}
	out := make([]prizeWinnerDTO, 0, len(recs))
	for _, rec := range recs {
		_, claimed, err := h.prize.PrizeOf(r.Context(), rec.Week, rec.Strategy, rec.Wallet)
		if err != nil {
			claimed = false
		}
		out = append(out, prizeWinnerDTO{Strategy: rec.Strategy, Wallet: rec.Wallet, Amount: tokenDecimal(rec.Amount), PnL: rec.PnL.String(), Claimed: claimed})
	}
	writeJSON(w, http.StatusOK, map[string]any{"contract": h.prize.Contract(), "prizes": out, "weeks": weeksOf(recs)})
}

func weeksOf(recs []store.PrizeRecord) []uint64 {
	out := make([]uint64, 0, len(recs))
	for _, r := range recs {
		out = append(out, r.Week)
	}
	return out
}

// leaderboard serves the boards: one per strategy, in lobby order. `period`
// is "week" by default, or "all" for every trade on record; the prize block
// is this week's either way, because that is the only week that pays.
func (h *handler) leaderboard(w http.ResponseWriter, r *http.Request) {
	if h.ledger == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "leaderboard_unavailable", Message: "no ledger is running"})
		return
	}
	period := strings.TrimSpace(r.URL.Query().Get("period"))
	if period != "" && period != "week" && period != "all" {
		writeJSON(w, http.StatusBadRequest, errorDTO{Error: "invalid_request", Message: "period must be week or all"})
		return
	}
	lb := h.ledger.Leaderboard()
	if period == "all" {
		lb = h.ledger.AllTime()
	}
	out := leaderboardDTO{WeekStart: timeOrEmpty(lb.WeekStart), Period: lb.Period, Source: lb.Source, Boards: make([]boardDTO, 0, len(lb.Boards))}
	if h.prize != nil {
		out.Prize = h.prizeBlock(r, WeekOf(lb.WeekStart))
	}
	for _, b := range lb.Boards {
		d := boardDTO{
			ID: b.Strategy.ID, Name: b.Strategy.Name, Tagline: b.Strategy.Tagline, Rhythm: b.Strategy.Rhythm,
			PnL: b.PnL.String(), Players: b.Players, Trades: b.Trades, ActiveNow: b.ActiveNow, Top: make([]standingDTO, 0, len(b.Top)),
		}
		for _, s := range b.Top {
			d.Top = append(d.Top, standingDTO{Wallet: s.Wallet, PnL: s.PnL.String(), Trades: s.Trades})
		}
		out.Boards = append(out.Boards, d)
	}
	writeJSON(w, http.StatusOK, out)
}

// standingsDTO is one page of a board.
type standingsDTO struct {
	Strategy  string        `json:"strategy"`
	Period    string        `json:"period"`
	Standings []standingDTO `json:"standings"`
	// Players is how many wallets are on this board altogether, not how
	// many this page carries.
	Players int `json:"players"`
	// NextOffset is where the next page starts; absent on the last.
	NextOffset int `json:"next_offset,omitempty"`
	// You is the asking wallet's own line and rank, whatever page it is on;
	// absent when the request names no wallet or the wallet never traded
	// this board.
	You *youDTO `json:"you,omitempty"`
}

type youDTO struct {
	standingDTO
	Rank int `json:"rank"`
}

// standings serves one board, one page at a time:
// ?strategy=direction&period=week&limit=25&offset=0. `strategy` empty or
// "all" is every strategy together, by wallet.
func (h *handler) standings(w http.ResponseWriter, r *http.Request) {
	if h.ledger == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "leaderboard_unavailable", Message: "no ledger is running"})
		return
	}
	q := r.URL.Query()
	period := strings.TrimSpace(q.Get("period"))
	if period == "" {
		period = "week"
	}
	if period != "week" && period != "all" {
		h.fail(w, fmt.Errorf("%w: period must be week or all", ErrInvalid))
		return
	}
	strategyID := strings.TrimSpace(q.Get("strategy"))
	if strategyID == "all" {
		strategyID = ""
	}
	if strategyID != "" && !strategy.Known(strategyID) {
		h.fail(w, fmt.Errorf("%w: unknown strategy %q", ErrInvalid, strategyID))
		return
	}
	limit, offset := 25, 0
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	if v := q.Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	rows, players, err := h.ledger.StandingsPage(period, strategyID, limit, offset)
	if err != nil {
		h.fail(w, err)
		return
	}
	out := standingsDTO{Strategy: q.Get("strategy"), Period: period, Standings: make([]standingDTO, 0, len(rows)), Players: players}
	if out.Strategy == "" {
		out.Strategy = "all"
	}
	for _, st := range rows {
		out.Standings = append(out.Standings, standingDTO{Wallet: st.Wallet, PnL: st.PnL.String(), Trades: st.Trades, Volume: st.Volume.String()})
	}
	if offset+len(rows) < players {
		out.NextOffset = offset + len(rows)
	}
	if wallet := strings.ToLower(strings.TrimSpace(r.Header.Get(AccountHeader))); wallet != "" {
		if st, rank, err := h.ledger.StandingOf(period, strategyID, wallet); err == nil && rank > 0 {
			out.You = &youDTO{standingDTO: standingDTO{Wallet: st.Wallet, PnL: st.PnL.String(), Trades: st.Trades, Volume: st.Volume.String()}, Rank: rank}
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *handler) enrolledKey(w http.ResponseWriter, r *http.Request) {
	if h.enroll == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "enrollment_unavailable", Message: "no builder code is configured"})
		return
	}
	address := r.URL.Query().Get("address")
	k, err := h.enroll.Key(address, r.URL.Query().Get("strategy"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, errorDTO{Error: "no_key", Message: "no exchange key is enrolled for this address"})
		return
	}
	writeJSON(w, http.StatusOK, toEnrolledKeyDTO(k))
}

// --- plumbing ---

const maxBody = 64 << 10

func decode(r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, maxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// isVenueHTTPError recognises a REST refusal from the venue, which the perpl
// package reports with the status and body in the message.
func isVenueHTTPError(err error) bool {
	return err != nil && strings.Contains(err.Error(), ": HTTP 4")
}

func zeroToEmpty(d fixed.D) string {
	if d.IsZero() {
		return ""
	}
	return d.String()
}

func timeOrEmpty(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

func logRequests(next http.Handler, log *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		log.Info("http", "method", r.Method, "path", r.URL.Path, "status", rec.status, "ms", time.Since(start).Milliseconds())
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// --- market context and deposits ---

func isPartnerError(err error) bool {
	var n *insight.APIError
	var a *deposit.APIError
	return errors.As(err, &n) || errors.As(err, &a)
}

func partnerMessage(err error) string {
	var n *insight.APIError
	var a *deposit.APIError
	switch {
	case errors.As(err, &a):
		return a.Message
	case errors.As(err, &n):
		return n.Message
	}
	return err.Error()
}

type contextTraderDTO struct {
	Address   string `json:"address"`
	Label     string `json:"label,omitempty"`
	BoughtUSD string `json:"bought_usd"`
	SoldUSD   string `json:"sold_usd"`
}

type contextHourDTO struct {
	At         string `json:"at"`
	InflowUSD  string `json:"inflow_usd"`
	OutflowUSD string `json:"outflow_usd"`
	Complete   bool   `json:"complete"`
}

type contextDTO struct {
	Symbol        string             `json:"symbol"`
	Chain         string             `json:"chain"`
	TokenAddress  string             `json:"token_address"`
	TokenSymbol   string             `json:"token_symbol"`
	PriceUSD      string             `json:"price_usd"`
	Change24hPct  string             `json:"change_24h_pct"`
	Volume24hUSD  string             `json:"volume_24h_usd"`
	BuyVolumeUSD  string             `json:"buy_volume_usd"`
	SellVolumeUSD string             `json:"sell_volume_usd"`
	NetflowUSD    string             `json:"netflow_usd"`
	LiquidityUSD  string             `json:"liquidity_usd"`
	MarketCapUSD  string             `json:"market_cap_usd"`
	Lean          string             `json:"lean"`
	Headline      string             `json:"headline"`
	Hours         []contextHourDTO   `json:"hours"`
	TopBuyers     []contextTraderDTO `json:"top_buyers"`
	TopSellers    []contextTraderDTO `json:"top_sellers"`
	Source        string             `json:"source"`
	UpdatedAt     string             `json:"updated_at"`
	Stale         bool               `json:"stale"`
}

func usd(v float64) string { return strconv.FormatFloat(v, 'f', 2, 64) }

func toContextDTO(c Card) contextDTO {
	out := contextDTO{
		Symbol: c.Symbol, Chain: c.Chain, TokenAddress: c.TokenAddress, TokenSymbol: c.TokenSymbol,
		PriceUSD: strconv.FormatFloat(c.PriceUSD, 'f', -1, 64), Change24hPct: strconv.FormatFloat(c.Change24h*100, 'f', 2, 64),
		Volume24hUSD: usd(c.Volume24hUSD), BuyVolumeUSD: usd(c.BuyVolumeUSD), SellVolumeUSD: usd(c.SellVolumeUSD), NetflowUSD: usd(c.NetflowUSD),
		LiquidityUSD: usd(c.LiquidityUSD), MarketCapUSD: usd(c.MarketCapUSD), Lean: c.Lean, Headline: c.Headline,
		Hours: []contextHourDTO{}, TopBuyers: []contextTraderDTO{}, TopSellers: []contextTraderDTO{},
		Source: c.Source, UpdatedAt: timeOrEmpty(c.UpdatedAt), Stale: c.Stale,
	}
	for _, h := range c.Hours {
		out.Hours = append(out.Hours, contextHourDTO{At: timeOrEmpty(h.At), InflowUSD: usd(h.InflowUSD), OutflowUSD: usd(h.OutflowUSD), Complete: h.Complete})
	}
	for _, t := range c.TopBuyers {
		out.TopBuyers = append(out.TopBuyers, contextTraderDTO{Address: t.Address, Label: t.Label, BoughtUSD: usd(t.BoughtUSD), SoldUSD: usd(t.SoldUSD)})
	}
	for _, t := range c.TopSellers {
		out.TopSellers = append(out.TopSellers, contextTraderDTO{Address: t.Address, Label: t.Label, BoughtUSD: usd(t.BoughtUSD), SoldUSD: usd(t.SoldUSD)})
	}
	return out
}

// marketContext serves the Nansen card for a market. Public: the same
// card for everyone, and it is about the asset, not the wallet.
func (h *handler) marketContext(w http.ResponseWriter, r *http.Request) {
	if h.context == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "context_unavailable", Message: "market context is not configured"})
		return
	}
	card, err := h.context.Card(r.Context(), r.URL.Query().Get("symbol"))
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toContextDTO(card))
}

type depositOptionDTO struct {
	AssetID   string `json:"asset_id"`
	Chain     string `json:"chain"`
	ChainName string `json:"chain_name"`
	Symbol    string `json:"symbol"`
	Decimals  int    `json:"decimals"`
	PriceUSD  string `json:"price_usd"`
}

type depositOptionsDTO struct {
	Destination struct {
		AssetID  string `json:"asset_id"`
		Chain    string `json:"chain"`
		Symbol   string `json:"symbol"`
		Decimals int    `json:"decimals"`
	} `json:"destination"`
	Options []depositOptionDTO `json:"options"`
}

func (h *handler) depositOptions(w http.ResponseWriter, r *http.Request) {
	if h.deposits == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "deposit_unavailable", Message: "any-chain deposits are not configured"})
		return
	}
	opts, dest, err := h.deposits.Options(r.Context())
	if err != nil {
		h.fail(w, err)
		return
	}
	var out depositOptionsDTO
	out.Destination.AssetID, out.Destination.Chain, out.Destination.Symbol, out.Destination.Decimals = dest.AssetID, dest.Chain, dest.Symbol, dest.Decimals
	out.Options = make([]depositOptionDTO, 0, len(opts))
	for _, o := range opts {
		out.Options = append(out.Options, depositOptionDTO{AssetID: o.AssetID, Chain: o.Chain, ChainName: o.ChainName, Symbol: o.Symbol, Decimals: o.Decimals, PriceUSD: strconv.FormatFloat(o.PriceUSD, 'f', -1, 64)})
	}
	writeJSON(w, http.StatusOK, out)
}

type depositQuoteReqDTO struct {
	OriginAsset string `json:"origin_asset"`
	Amount      string `json:"amount"`
	Dry         bool   `json:"dry,omitempty"`
}

type depositQuoteDTO struct {
	DepositAddress  string `json:"deposit_address,omitempty"`
	OriginAsset     string `json:"origin_asset"`
	AmountIn        string `json:"amount_in"`
	AmountInUSD     string `json:"amount_in_usd"`
	AmountOut       string `json:"amount_out"`
	AmountOutUSD    string `json:"amount_out_usd"`
	MinAmountOut    string `json:"min_amount_out"`
	TimeEstimateSec int    `json:"time_estimate_seconds"`
	Deadline        string `json:"deadline"`
	Dry             bool   `json:"dry"`
}

// depositQuote quotes a deposit into the requesting wallet: the recipient
// and the refund address are the wallet in X-Account-Address, never a
// body field, so a quote cannot be made to pay someone else.
func (h *handler) depositQuote(w http.ResponseWriter, r *http.Request) {
	if h.deposits == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "deposit_unavailable", Message: "any-chain deposits are not configured"})
		return
	}
	wallet := strings.TrimSpace(r.Header.Get(AccountHeader))
	if wallet == "" {
		h.fail(w, fmt.Errorf("%w: a deposit needs the wallet in %s", ErrInvalid, AccountHeader))
		return
	}
	var in depositQuoteReqDTO
	if err := decode(r, &in); err != nil {
		h.fail(w, err)
		return
	}
	q, err := h.deposits.Quote(r.Context(), in.OriginAsset, in.Amount, wallet, in.Dry)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, depositQuoteDTO{
		DepositAddress: q.DepositAddress, OriginAsset: q.OriginAsset, AmountIn: q.AmountIn, AmountInUSD: q.AmountInUSD,
		AmountOut: q.AmountOut, AmountOutUSD: q.AmountOutUSD, MinAmountOut: q.MinAmountOut,
		TimeEstimateSec: q.TimeEstimateSec, Deadline: timeOrEmpty(q.Deadline), Dry: q.Dry,
	})
}

type depositStatusDTO struct {
	Status    string   `json:"status"`
	UpdatedAt string   `json:"updated_at"`
	AmountIn  string   `json:"amount_in,omitempty"`
	AmountOut string   `json:"amount_out,omitempty"`
	TxHashes  []string `json:"tx_hashes"`
}

func (h *handler) depositStatus(w http.ResponseWriter, r *http.Request) {
	if h.deposits == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "deposit_unavailable", Message: "any-chain deposits are not configured"})
		return
	}
	s, err := h.deposits.Status(r.Context(), r.URL.Query().Get("deposit_address"))
	if err != nil {
		h.fail(w, err)
		return
	}
	if s.TxHashes == nil {
		s.TxHashes = []string{}
	}
	writeJSON(w, http.StatusOK, depositStatusDTO{Status: s.Status, UpdatedAt: timeOrEmpty(s.UpdatedAt), AmountIn: s.AmountIn, AmountOut: s.AmountOut, TxHashes: s.TxHashes})
}

// --- prize history from the indexer ---

type historyPrizeDTO struct {
	Wallet    string `json:"wallet"`
	Rank      int    `json:"rank"`
	Amount    string `json:"amount"`
	PnL       string `json:"pnl"`
	Claimed   bool   `json:"claimed"`
	ClaimedAt string `json:"claimed_at,omitempty"`
	ClaimTx   string `json:"claim_tx,omitempty"`
}

type historyPoolDTO struct {
	Week      uint64            `json:"week"`
	WeekStart string            `json:"week_start"`
	Strategy  string            `json:"strategy"`
	Funded    string            `json:"funded"`
	Fundings  int               `json:"fundings"`
	Settled   bool              `json:"settled"`
	SettledAt string            `json:"settled_at,omitempty"`
	Carried   string            `json:"carried"`
	Claimed   string            `json:"claimed"`
	Prizes    []historyPrizeDTO `json:"prizes"`
}

type historyDTO struct {
	Pools  []historyPoolDTO `json:"pools"`
	Totals struct {
		Funded       string `json:"funded"`
		Paid         string `json:"paid"`
		Claimed      string `json:"claimed"`
		Pools        int    `json:"pools"`
		SettledPools int    `json:"settled_pools"`
	} `json:"totals"`
	Source    string `json:"source"`
	Stale     bool   `json:"stale"`
	UpdatedAt string `json:"updated_at"`
}

// prizeHistory serves the weeks gone by as the chain recorded them. Amounts
// are the token's smallest units, as the contract emits them. Public.
func (h *handler) prizeHistory(w http.ResponseWriter, r *http.Request) {
	if h.history == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "history_unavailable", Message: "the prize indexer is not configured"})
		return
	}
	limit := 12
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	hist, err := h.history.Read(r.Context(), limit)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, errorDTO{Error: "partner_error", Message: err.Error()})
		return
	}
	out := historyDTO{Pools: []historyPoolDTO{}, Source: "envio", Stale: hist.Stale, UpdatedAt: timeOrEmpty(hist.UpdatedAt)}
	out.Totals.Funded, out.Totals.Paid, out.Totals.Claimed = hist.Totals.Funded, hist.Totals.Paid, hist.Totals.Claimed
	out.Totals.Pools, out.Totals.SettledPools = hist.Totals.Pools, hist.Totals.SettledPools
	for _, p := range hist.Pools {
		week, _ := strconv.ParseUint(p.Week, 10, 64)
		d := historyPoolDTO{
			Week: week, WeekStart: timeOrEmpty(p.WeekStart), Strategy: p.StrategyID, Funded: p.Funded, Fundings: p.Fundings,
			Settled: p.Settled, Carried: p.Carried, Claimed: p.Claimed, Prizes: []historyPrizeDTO{},
		}
		if d.Strategy == "" {
			d.Strategy = p.Strategy
		}
		if p.SettledAt != nil {
			d.SettledAt = unixString(*p.SettledAt)
		}
		for _, pr := range p.Prizes {
			pd := historyPrizeDTO{Wallet: pr.Wallet, Rank: pr.Rank, Amount: pr.Amount, PnL: pr.PnL, Claimed: pr.Claimed}
			if pr.ClaimedAt != nil {
				pd.ClaimedAt = unixString(*pr.ClaimedAt)
			}
			if pr.ClaimTx != nil {
				pd.ClaimTx = *pr.ClaimTx
			}
			d.Prizes = append(d.Prizes, pd)
		}
		out.Pools = append(out.Pools, d)
	}
	writeJSON(w, http.StatusOK, out)
}

// unixString turns the indexer's block timestamp (seconds, as a string)
// into RFC 3339.
func unixString(s string) string {
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return ""
	}
	return timeOrEmpty(time.Unix(n, 0).UTC())
}
