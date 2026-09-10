package platform

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/insight"
)

// fakeNansen answers the three endpoints the card reads and counts calls.
type fakeNansen struct {
	calls atomic.Int32
	fail  atomic.Bool
}

func (f *fakeNansen) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.calls.Add(1)
	if r.Header.Get("apikey") != "k" {
		http.Error(w, `{"message":"no key"}`, 401)
		return
	}
	if f.fail.Load() {
		w.WriteHeader(500)
		_, _ = w.Write([]byte(`{"code":"boom","message":"upstream down"}`))
		return
	}
	w.Header().Set("X-Nansen-Credits-Cost", "1")
	w.Header().Set("X-Nansen-Credits-Remaining", "42")
	switch r.URL.Path {
	case "/api/v1/token-screener":
		_, _ = w.Write([]byte(`{"data":[
			{"chain":"monad","token_address":"0x754704bc059f8c67012fed69bc8a327a5aafb603","token_symbol":"USDC","price_usd":1,"price_change":0,"buy_volume":1,"sell_volume":1,"volume":2,"netflow":0},
			{"chain":"monad","token_address":"0x3bd359c1119da7da1d913d1c4d2b7c461115433a","token_symbol":"WMON","market_cap_usd":9249472.9,"liquidity":2314702.7,"price_usd":0.02304912,"price_change":-0.0071411,"buy_volume":948200.72,"sell_volume":1030293.37,"volume":1978494.10,"netflow":-82092.65}
		],"pagination":{"page":1,"per_page":100,"is_last_page":true}}`))
	case "/api/v1/tgm/who-bought-sold":
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["date"] == nil {
			http.Error(w, `{"code":"missing_field","message":"date"}`, 422)
			return
		}
		_, _ = w.Write([]byte(`{"data":[
			{"address":"0xcee4","address_label":"","bought_volume_usd":160310.49,"sold_volume_usd":93253.25,"trade_volume_usd":67057.24},
			{"address":"0x4d35","address_label":"Fund X","bought_volume_usd":27951.59,"sold_volume_usd":0,"trade_volume_usd":27951.59},
			{"address":"0xdead","address_label":"","bought_volume_usd":100,"sold_volume_usd":50000,"trade_volume_usd":49900}
		],"pagination":{"page":1,"per_page":20,"is_last_page":false}}`))
	case "/api/v1/tgm/flows":
		_, _ = w.Write([]byte(`{"data":[
			{"date":"2026-09-11T08:00:00Z","bucket_end":"2026-09-11T09:00:00Z","is_complete":false,"price_usd":0.0230,"total_inflows_count":331593.7,"total_outflows_count":-163472.9},
			{"date":"2026-09-11T07:00:00Z","bucket_end":"2026-09-11T08:00:00Z","is_complete":true,"price_usd":0.0231,"total_inflows_count":2958501.7,"total_outflows_count":-610931.3}
		],"pagination":{"page":1,"per_page":6,"is_last_page":true}}`))
	default:
		http.Error(w, "no such endpoint", 404)
	}
}

func newTestContext(t *testing.T) (*MarketContext, *fakeNansen) {
	t.Helper()
	fake := &fakeNansen{}
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	n, err := insight.NewNansen("k", srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	m := NewMarketContext(n, map[string]TokenRef{"mon": {Chain: "monad", Address: "0x3BD359C1119DA7DA1D913D1C4D2B7C461115433A", Symbol: "MON"}}, time.Hour, nil)
	return m, fake
}

// The card is built from the screener row for the market's token, with
// the day's biggest buyers and sellers and the last hours of flows, and
// reads as one sentence.
func TestMarketContextCard(t *testing.T) {
	m, fake := newTestContext(t)
	c, err := m.Card(context.Background(), "mon")
	if err != nil {
		t.Fatal(err)
	}
	if c.TokenSymbol != "WMON" || c.PriceUSD != 0.02304912 || c.Lean != "balanced" || c.Source != "nansen" {
		t.Fatalf("card = %+v", c)
	}
	if len(c.TopBuyers) != 2 || c.TopBuyers[0].Address != "0xcee4" || c.TopBuyers[1].Label != "Fund X" {
		t.Fatalf("buyers = %+v", c.TopBuyers)
	}
	if len(c.TopSellers) != 1 || c.TopSellers[0].Address != "0xdead" {
		t.Fatalf("sellers = %+v", c.TopSellers)
	}
	if len(c.Hours) != 2 || c.Hours[1].OutflowUSD <= 0 || !c.Hours[1].Complete {
		t.Fatalf("hours = %+v", c.Hours)
	}
	if !strings.HasPrefix(c.Headline, "WMON is barely down (0.7%), buyers and sellers about even, on $2.0M of volume in 24h.") {
		t.Fatalf("headline = %q", c.Headline)
	}
	if fake.calls.Load() != 3 {
		t.Fatalf("calls = %d, want 3", fake.calls.Load())
	}
	// Within the TTL nothing is fetched again, and nothing is spent.
	if _, err := m.Card(context.Background(), "MON"); err != nil || fake.calls.Load() != 3 {
		t.Fatalf("second read: err=%v calls=%d", err, fake.calls.Load())
	}
	if _, err := m.Card(context.Background(), "ETH"); err == nil {
		t.Fatal("an unknown market got a card")
	}
}

// After the TTL a refresh that fails serves the last card, marked stale;
// with no card yet the error is returned.
func TestMarketContextStaleOnFailure(t *testing.T) {
	m, fake := newTestContext(t)
	now := time.Now()
	m.now = func() time.Time { return now }
	fake.fail.Store(true)
	if _, err := m.Card(context.Background(), "mon"); err == nil {
		t.Fatal("first read succeeded with the source down")
	}
	// Right after a failure with nothing cached: still an error, not an
	// empty card, and the source is not asked again within the minute.
	calls := fake.calls.Load()
	if c, err := m.Card(context.Background(), "mon"); err == nil || c.Symbol != "" {
		t.Fatalf("after failure: %v %+v", err, c)
	}
	if fake.calls.Load() != calls {
		t.Fatal("source asked again within the retry window")
	}
	fake.fail.Store(false)
	now = now.Add(2 * time.Hour)
	if c, err := m.Card(context.Background(), "mon"); err != nil || c.Stale {
		t.Fatalf("fresh card: %v %+v", err, c)
	}
	fake.fail.Store(true)
	now = now.Add(2 * time.Hour)
	c, err := m.Card(context.Background(), "mon")
	if err != nil || !c.Stale || c.TokenSymbol != "WMON" {
		t.Fatalf("stale card: %v %+v", err, c)
	}
}

func TestLeanAndMoney(t *testing.T) {
	for _, tc := range []struct {
		buy, sell float64
		want      string
	}{{100, 50, "buyers"}, {50, 100, "sellers"}, {100, 95, "balanced"}, {0, 0, "balanced"}} {
		if got := lean(tc.buy, tc.sell); got != tc.want {
			t.Errorf("lean(%v, %v) = %q, want %q", tc.buy, tc.sell, got, tc.want)
		}
	}
	for v, want := range map[float64]string{950: "$950", 82092.65: "$82k", 1978494: "$2.0M", -82092: "-$82k", 2.5e9: "$2.5B"} {
		if got := money(v); got != want {
			t.Errorf("money(%v) = %q, want %q", v, got, want)
		}
	}
}
