package platform

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/policy"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

// Handler exposes the service over HTTP. Every amount in the wire format is a
// decimal string: JSON numbers are floats on the other side, and money is not.
//
// The contract is api/openapi.yaml; this file is the implementation of it and
// must not drift from it.
func Handler(s *Service, log *slog.Logger) http.Handler {
	if log == nil {
		log = slog.Default()
	}
	h := &handler{svc: s, log: log}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/health", h.health)
	mux.HandleFunc("GET /v1/markets", h.markets)
	mux.HandleFunc("GET /v1/state", h.state)
	mux.HandleFunc("POST /v1/orders/open", h.open)
	mux.HandleFunc("POST /v1/orders/close", h.close)
	mux.HandleFunc("POST /v1/kill", h.kill)
	mux.HandleFunc("POST /v1/revive", h.revive)
	return logRequests(mux, log)
}

type handler struct {
	svc *Service
	log *slog.Logger
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
	ms, err := h.svc.Markets(r.Context())
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
	st, err := h.svc.State(r.Context())
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
	order, err := h.svc.Open(r.Context(), req)
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
	order, err := h.svc.Close(r.Context(), CloseRequest{Symbol: in.Symbol})
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
	case errors.Is(err, venue.ErrUnknownMarket):
		writeJSON(w, http.StatusNotFound, errorDTO{Error: "unknown_market", Message: err.Error()})
	case errors.Is(err, ErrNoPosition):
		writeJSON(w, http.StatusNotFound, errorDTO{Error: "no_position", Message: err.Error()})
	case errors.Is(err, ErrInvalid):
		writeJSON(w, http.StatusBadRequest, errorDTO{Error: "invalid_request", Message: err.Error()})
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
	return OpenRequest{Symbol: in.Symbol, Side: side, Notional: notional, Leverage: leverage}, nil
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
		})
	}
	return stateDTO{
		Venue: st.Venue,
		Account: accountDTO{
			ID:       st.Account.VenueID,
			Balance:  st.Account.Balance.String(),
			Locked:   st.Account.Locked.String(),
			CanTrade: st.Account.CanTrade,
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
