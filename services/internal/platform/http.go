package platform

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
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
	h := &handler{svc: s, log: log, enroll: o.enrollment, registry: o.registry, signals: o.signals, ledger: o.ledger, prize: o.prize}
	if o.ledger != nil {
		s.UseLedger(o.ledger)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/exchange/enroll/payload", h.enrollPayload)
	mux.HandleFunc("POST /v1/exchange/enroll", h.enrollFinish)
	mux.HandleFunc("GET /v1/exchange/key", h.enrolledKey)
	mux.HandleFunc("GET /v1/exchange/network", h.exchangeNetwork)
	mux.HandleFunc("GET /v1/signals/ma-cross", h.maCross)
	mux.HandleFunc("GET /v1/signals/rsi", h.rsi)
	mux.HandleFunc("GET /v1/leaderboard", h.leaderboard)
	mux.HandleFunc("GET /v1/prizes", h.prizes)
	mux.HandleFunc("GET /v1/candles", h.candles)
	mux.HandleFunc("GET /v1/trades", h.trades)
	mux.HandleFunc("GET /v1/health", h.health)
	mux.HandleFunc("GET /v1/markets", h.markets)
	mux.HandleFunc("GET /v1/state", h.state)
	mux.HandleFunc("POST /v1/orders/open", h.open)
	mux.HandleFunc("POST /v1/orders/close", h.close)
	mux.HandleFunc("POST /v1/kill", h.kill)
	mux.HandleFunc("POST /v1/revive", h.revive)
	var out http.Handler = mux
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
			h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			// Bypass-Tunnel-Reminder is what the app sends when the platform
			// sits behind a localtunnel during phone testing; harmless otherwise.
			h.Set("Access-Control-Allow-Headers", "Content-Type, "+AccountHeader+", Bypass-Tunnel-Reminder")
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
	svc      *Service
	log      *slog.Logger
	enroll   *Enrollment
	registry *Registry
	signals  *Signals
	ledger   *Ledger
	prize    *Prize
}

// AccountHeader names the wallet a request acts for. It is not authentication
// — that arrives with signed requests from the passkey wallet — and until it
// does the platform must bind to loopback only.
const AccountHeader = "X-Account-Address"

// service picks the Service for a request: the wallet named in the header, or
// the platform's own. ok is false when the response has already been written.
func (h *handler) service(w http.ResponseWriter, r *http.Request) (*Service, bool) {
	addr := strings.TrimSpace(r.Header.Get(AccountHeader))
	if addr == "" {
		return h.svc, true
	}
	if h.registry == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "enrollment_unavailable", Message: "per-wallet trading is not enabled"})
		return nil, false
	}
	svc, err := h.registry.Get(r.Context(), addr)
	if err != nil {
		if errors.Is(err, ErrNoKey) {
			writeJSON(w, http.StatusNotFound, errorDTO{Error: "no_key", Message: "no exchange key is enrolled for this wallet"})
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
	Symbol string `json:"symbol"`
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
	svc, ok := h.service(w, r)
	if !ok {
		return
	}
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
	writeJSON(w, http.StatusOK, toStateDTO(st))
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
	svc, ok := h.service(w, r)
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
	svc, ok := h.service(w, r)
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
	h.svc.Kill(in.Reason)
	h.log.Warn("kill switch engaged", "reason", in.Reason)
	writeJSON(w, http.StatusOK, map[string]any{"killed": true, "reason": in.Reason})
}

func (h *handler) revive(w http.ResponseWriter, r *http.Request) {
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
	return OpenRequest{Symbol: in.Symbol, Side: side, Notional: notional, Leverage: leverage, Rules: rules, Strategy: strings.TrimSpace(in.Strategy)}, nil
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

func toStateDTO(st State) stateDTO {
	positions := make([]positionDTO, 0, len(st.Positions))
	for _, p := range st.Positions {
		positions = append(positions, positionDTO{
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
		})
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
}

type enrollPayloadDTO struct {
	Handle        string          `json:"handle"`
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
}

type enrolledKeyDTO struct {
	Address    string `json:"address"`
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
	res, err := h.enroll.Payload(r.Context(), in.Address, in.Label)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, enrollPayloadDTO{
		Handle:        res.Handle,
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
	k, err := h.enroll.Enroll(r.Context(), in.Handle, in.SignInSignature, in.Signature)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, enrolledKeyDTO{
		Address: k.Address, Label: k.Label, BuilderID: k.BuilderID,
		MaxFee: k.MaxBuilderFeePer100K, MaxFeePct: k.MaxBuilderFeePct, EnrolledAt: timeOrEmpty(k.EnrolledAt),
	})
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
	Strategy   string `json:"strategy"`
	Symbol     string `json:"symbol"`
	Side       string `json:"side"`
	Size       string `json:"size"`
	EntryPrice string `json:"entry_price"`
	ExitPrice  string `json:"exit_price,omitempty"`
	PnL        string `json:"pnl,omitempty"`
	OpenedAt   string `json:"opened_at"`
	ClosedAt   string `json:"closed_at,omitempty"`
}

// trades lists the account's round trips in a market, newest first, for the
// chart's marks: ?symbol=MON&limit=50.
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
	list, err := svc.Trades(r.Context(), r.URL.Query().Get("symbol"), limit)
	if err != nil {
		h.fail(w, err)
		return
	}
	out := make([]tradeDTO, 0, len(list))
	for _, t := range list {
		d := tradeDTO{Strategy: t.Strategy, Symbol: t.Symbol, Side: t.Side, Size: t.Size.String(), EntryPrice: t.EntryPrice.String(), OpenedAt: timeOrEmpty(t.OpenedAt)}
		if !t.ClosedAt.IsZero() {
			d.ExitPrice, d.PnL, d.ClosedAt = t.ExitPrice.String(), t.PnL.String(), timeOrEmpty(t.ClosedAt)
		}
		out = append(out, d)
	}
	writeJSON(w, http.StatusOK, out)
}

// --- leaderboard ---

type standingDTO struct {
	Wallet string `json:"wallet"`
	PnL    string `json:"pnl"`
	Trades int    `json:"trades"`
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

// prizeBlock reads this week's pools and last week's winners.
func (h *handler) prizeBlock(r *http.Request, week uint64) *prizeDTO {
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

// leaderboard serves the week's boards: one per strategy, in lobby order.
func (h *handler) leaderboard(w http.ResponseWriter, r *http.Request) {
	if h.ledger == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "leaderboard_unavailable", Message: "no ledger is running"})
		return
	}
	lb := h.ledger.Leaderboard()
	out := leaderboardDTO{WeekStart: timeOrEmpty(lb.WeekStart), Source: lb.Source, Boards: make([]boardDTO, 0, len(lb.Boards))}
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

func (h *handler) enrolledKey(w http.ResponseWriter, r *http.Request) {
	if h.enroll == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "enrollment_unavailable", Message: "no builder code is configured"})
		return
	}
	address := r.URL.Query().Get("address")
	k, err := h.enroll.Key(address)
	if err != nil {
		writeJSON(w, http.StatusNotFound, errorDTO{Error: "no_key", Message: "no exchange key is enrolled for this address"})
		return
	}
	writeJSON(w, http.StatusOK, enrolledKeyDTO{
		Address: k.Address, Label: k.Label, BuilderID: k.BuilderID,
		MaxFee: k.MaxBuilderFeePer100K, MaxFeePct: k.MaxBuilderFeePct, EnrolledAt: timeOrEmpty(k.EnrolledAt),
	})
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
