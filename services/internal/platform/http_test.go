package platform

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wagmiCTO/super-agent/services/internal/policy"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

func TestCORS(t *testing.T) {
	svc, _ := newService(t, &fakeVenue{})
	h := Handler(svc, nil, WithCORS([]string{"http://localhost:8081"}))

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
	h := Handler(svc, nil)
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
	h := Handler(svc, nil)
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
	h := Handler(svc, nil)
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
	h := Handler(svc, nil, WithCORS([]string{"http://localhost:8082"}))
	req := httptest.NewRequest(http.MethodOptions, "/v1/state", nil)
	req.Header.Set("Origin", "http://localhost:8082")
	req.Header.Set("Access-Control-Request-Headers", AccountHeader)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(strings.ToLower(got), strings.ToLower(AccountHeader)) {
		t.Fatalf("Allow-Headers = %q, must include %s", got, AccountHeader)
	}
}
