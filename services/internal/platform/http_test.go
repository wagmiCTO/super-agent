package platform

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/wagmiCTO/super-agent/services/internal/policy"
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
