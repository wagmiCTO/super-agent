package platform

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/keys"
	"github.com/wagmiCTO/super-agent/services/internal/policy"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

func TestCORS(t *testing.T) {
	svc, _ := newService(t, &fakeVenue{})
	h := Handler(svc, nil, WithOwnAccount(true), WithCORS([]string{"http://localhost:8081"}))

	tests := []struct {
		name       string
		method     string
		origin     string
		wantAllow  string
		wantStatus int
	}{
		{"preflight from an allowed origin", http.MethodOptions, "http://localhost:8081", "http://localhost:8081", http.StatusNoContent},
		{"request from an allowed origin", http.MethodGet, "http://localhost:8081", "http://localhost:8081", http.StatusOK},
		{"request from an unlisted origin gets no CORS headers", http.MethodGet, "http://evil.example", "", http.StatusOK},
		{"no origin header, plain request", http.MethodGet, "", "", http.StatusOK},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, "/v1/health", nil)
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
			if got := rec.Header().Get("Access-Control-Allow-Origin"); got != tc.wantAllow {
				t.Errorf("Allow-Origin = %q, want %q", got, tc.wantAllow)
			}
		})
	}
}

// Without the option no CORS headers are emitted at all.
func TestNoCORSByDefault(t *testing.T) {
	svc, _ := newService(t, &fakeVenue{})
	h := Handler(svc, nil, WithOwnAccount(true))
	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	req.Header.Set("Origin", "http://localhost:8081")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("unexpected Allow-Origin %q", got)
	}
}

// The policy denial shape must survive the HTTP layer intact: the app builds
// its message from these fields.
func TestDenialWireShape(t *testing.T) {
	svc, _ := newService(t, &fakeVenue{})
	h := Handler(svc, nil, WithOwnAccount(true))
	body := `{"symbol":"MON","side":"long","notional":"500","leverage":"1"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/orders/open", stringsReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403: %s", rec.Code, rec.Body.String())
	}
	want := `{"error":"` + string(policy.ReasonNotionalTooLarge) + `","message":"maximum position is 50","limit":"50","actual":"500"}`
	if got := trimNL(rec.Body.String()); got != want {
		t.Errorf("body = %s\nwant %s", got, want)
	}
}

func TestNoExchangeAccountIs409(t *testing.T) {
	svc, _ := newService(t, &fakeVenue{placeErr: venue.ErrNoExchangeAccount})
	h := Handler(svc, nil, WithOwnAccount(true))
	req := httptest.NewRequest(http.MethodPost, "/v1/orders/open", stringsReader(`{"symbol":"MON","side":"long","notional":"10","leverage":"1"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"error":"no_exchange_account"`) {
		t.Errorf("body = %s", rec.Body.String())
	}
}

func TestAccountStatus(t *testing.T) {
	cases := []struct {
		in   venue.Account
		want string
	}{
		{venue.Account{VenueID: "0"}, "no_exchange_account"},
		{venue.Account{}, "no_exchange_account"},
		{venue.Account{VenueID: "480", Frozen: true}, "frozen"},
		{venue.Account{VenueID: "480"}, "forwarding_disabled"},
		{venue.Account{VenueID: "480", CanTrade: true}, "active"},
	}
	for _, c := range cases {
		if got := accountStatus(c.in); got != c.want {
			t.Errorf("accountStatus(%+v) = %q, want %q", c.in, got, c.want)
		}
	}
}

// The account header is a custom header: a browser preflights it, and the
// screen silently keeps acting for the platform's own account if the
// preflight does not allow it.
func TestCORSAllowsAccountHeader(t *testing.T) {
	svc, _ := newService(t, &fakeVenue{})
	h := Handler(svc, nil, WithOwnAccount(true), WithCORS([]string{"http://localhost:8082"}))
	req := httptest.NewRequest(http.MethodOptions, "/v1/state", nil)
	req.Header.Set("Origin", "http://localhost:8082")
	req.Header.Set("Access-Control-Request-Headers", AccountHeader)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(strings.ToLower(got), strings.ToLower(AccountHeader)) {
		t.Fatalf("Allow-Headers = %q, must include %s", got, AccountHeader)
	}
}

func TestExchangeNetwork(t *testing.T) {
	svc, _ := newService(t, &fakeVenue{})
	fe := &fakeEnroller{t: t, builderID: 18, maxFee: 50}
	enr, err := NewEnrollment(fe, keys.New(), 18, 50, nil)
	if err != nil {
		t.Fatal(err)
	}
	h := Handler(svc, nil, WithEnrollment(enr))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/exchange/network", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var out exchangeNetworkDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.ChainID != 10143 || out.MinAccountOpenAmount != "100" || out.MinAccountOpenRaw != "100000000" || out.CollateralDecimals != 6 {
		t.Errorf("network = %+v", out)
	}
}

// A round trip through the API lands on the leaderboard under its strategy.
func TestLeaderboardCountsRoundTrips(t *testing.T) {
	svc, _ := newService(t, &fakeVenue{})
	ledger := NewLedger()
	h := Handler(svc, nil, WithLedger(ledger), WithOwnAccount(true))
	post := func(path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, path, stringsReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	if rec := post("/v1/orders/open", `{"symbol":"MON","side":"long","notional":"10","leverage":"1","strategy":"ma-cross"}`); rec.Code != http.StatusOK {
		t.Fatalf("open: %d %s", rec.Code, rec.Body.String())
	}
	if rec := post("/v1/orders/open", `{"symbol":"MON","side":"long","notional":"10","leverage":"1","strategy":"nope"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown strategy: %d %s", rec.Code, rec.Body.String())
	}
	if rec := post("/v1/orders/close", `{"symbol":"MON"}`); rec.Code != http.StatusOK {
		t.Fatalf("close: %d %s", rec.Code, rec.Body.String())
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/leaderboard", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("leaderboard: %d", rec.Code)
	}
	var out leaderboardDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Boards) != 3 || out.Boards[1].ID != "ma-cross" || out.Boards[1].Trades != 1 || out.Boards[1].Players != 1 {
		t.Errorf("boards = %+v", out.Boards)
	}
	if out.Boards[0].Trades != 0 {
		t.Errorf("direction board counted the ma-cross trade: %+v", out.Boards[0])
	}
}

func TestCandlesEndpoint(t *testing.T) {
	t0 := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	fv := &fakeVenue{candles: []venue.Candle{{Open: t0, Period: time.Minute, O: fixed.FromInt(1), H: fixed.FromInt(2), L: fixed.FromInt(1), C: fixed.FromInt(2)}}}
	svc, _ := newService(t, fv)
	h := Handler(svc, nil, WithOwnAccount(true))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/candles?symbol=mon&period_seconds=60&from=1789000000&to=1789003600", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var out []candleDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 || out[0].Time != t0.Unix() || out[0].High != "2" {
		t.Errorf("candles = %+v", out)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/candles?symbol=mon&period_seconds=0&from=1&to=2", nil))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("bad period: %d", rec.Code)
	}
}
