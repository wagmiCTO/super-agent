package platform

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

// The report on the platform's own account: every strategy enabled, an
// open position with its stop and what it can still lose, usage against
// the limits, and the market's volatility from candles. Then close-all
// flattens it.
func TestRiskReportAndCloseAll(t *testing.T) {
	t0 := time.Now().Add(-40 * time.Minute).Truncate(time.Minute)
	var candles []venue.Candle
	p := 0.025
	for i := 0; i < 35; i++ {
		if i%2 == 0 {
			p *= 1.002
		} else {
			p /= 1.002
		}
		c := fixed.MustParse(trimFloat(p))
		candles = append(candles, venue.Candle{Open: t0.Add(time.Duration(i) * time.Minute), Period: time.Minute, O: c, H: c, L: c, C: c})
	}
	fv := &fakeVenue{candles: candles}
	svc, _ := newService(t, fv)
	h := Handler(svc, nil, WithOwnAccount(true), WithLedger(NewLedger()))

	body := `{"symbol":"MON","side":"long","notional":"10","leverage":"2","horizon_seconds":600,"max_loss":"0.5","strategy":"direction"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/orders/open", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("open: %d %s", rec.Code, rec.Body)
	}
	fv.mark("MON", fixed.MustParse("-1"))

	req = httptest.NewRequest(http.MethodGet, "/v1/risk", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("risk: %d %s", rec.Code, rec.Body)
	}
	var out riskReportDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Strategies) != 3 || !out.Strategies[0].Enabled || out.Strategies[0].ID != "direction" {
		t.Fatalf("strategies = %+v", out.Strategies)
	}
	if len(out.Open) != 1 {
		t.Fatalf("open = %+v", out.Open)
	}
	pos := out.Open[0]
	// Collateral 5, stop at 50% → stop pnl −2.5; down 1 already → 1.5 still at risk.
	if pos.MaxLoss != "0.5" || pos.StopPnL != "-2.5" || pos.AtRisk != "1.5" || pos.Strategy != "direction" || pos.ClosesAt == "" {
		t.Fatalf("position = %+v", pos)
	}
	u := out.Strategies[0].Usage
	if u == nil || u.OpenPositions != 1 || u.Exposure != "10" || u.DailyLossLeft == "" {
		t.Fatalf("usage = %+v", u)
	}
	if out.Totals.AtRisk != "1.5" || out.Totals.Exposure != "10" {
		t.Fatalf("totals = %+v", out.Totals)
	}
	if len(out.Market) != 1 || out.Market[0].Symbol != "MON" || out.Market[0].Vol1mBps < 15 || out.Market[0].Vol1mBps > 25 {
		t.Fatalf("market = %+v", out.Market)
	}
	// The shared service is read once: the same position is not counted three times.
	if out.Strategies[1].Open == nil || len(out.Strategies[1].Open) != 1 {
		t.Fatalf("second strategy sees %+v", out.Strategies[1].Open)
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/risk/close-all", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("close-all: %d %s", rec.Code, rec.Body)
	}
	var res struct {
		Closed  int                 `json:"closed"`
		Results []closeAllResultDTO `json:"results"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if res.Closed != 1 || len(res.Results) != 1 || !res.Results[0].Closed {
		t.Fatalf("close-all = %+v", res)
	}
	if ps, _ := fv.Positions(req.Context()); len(ps) != 0 {
		t.Fatal("position still open after close-all")
	}
	// After the round trip the journal-backed stats show one loss today.
	req = httptest.NewRequest(http.MethodGet, "/v1/risk", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Totals.Today == nil || out.Totals.Today.Trades != 1 || out.Totals.Today.ByReason["manual"] != 1 {
		t.Fatalf("today after close = %+v", out.Totals.Today)
	}

	// Without a wallet and without own-account access there is no report.
	closed := Handler(svc, nil)
	req = httptest.NewRequest(http.MethodGet, "/v1/risk", nil)
	rec = httptest.NewRecorder()
	closed.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("closed platform: %d", rec.Code)
	}
}
