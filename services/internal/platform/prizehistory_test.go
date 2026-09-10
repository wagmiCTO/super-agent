package platform

import (
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/envio"
)

// fakeEnvio answers the pools query like Hasura would, and counts calls.
type fakeEnvio struct {
	calls atomic.Int32
	fail  atomic.Bool
}

func (f *fakeEnvio) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.calls.Add(1)
	if f.fail.Load() {
		http.Error(w, "down", 502)
		return
	}
	k := StrategyKey("direction")
	strategy := "0x" + hex.EncodeToString(k[:])
	_, _ = w.Write([]byte(`{"data":{"Pool":[
		{"id":"2958-` + strategy + `","week":"2958","strategy":"` + strategy + `","funded":"300000","fundings":3,"settled":true,"settledAt":"1789200000","carried":"0","winners":2,"claimed":"150000",
		 "prizes":[{"wallet":"0xaaa","rank":1,"amount":"150000","pnl":"3000000","claimed":true,"claimedAt":"1789203600","claimTx":"0xtx"},{"wallet":"0xbbb","rank":2,"amount":"90000","pnl":"1000000","claimed":false,"claimedAt":null,"claimTx":null}]},
		{"id":"2958-0xunknown","week":"2958","strategy":"0xunknown","funded":"100000","fundings":1,"settled":false,"settledAt":null,"carried":"0","winners":0,"claimed":"0","prizes":[]}
	],"Totals":[{"funded":"400000","paid":"240000","claimed":"150000","pools":2,"settledPools":1}]}}`))
}

// The history resolves strategy keys back to ids, keeps unknown keys as
// they are, and serves the endpoint's wire shape; within a minute the
// indexer is asked once, and after a failure the last answer is served
// stale.
func TestPrizeHistory(t *testing.T) {
	fake := &fakeEnvio{}
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	c, err := envio.New(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	ph := NewPrizeHistory(c, nil)
	now := time.Now()
	ph.now = func() time.Time { return now }

	own, _ := newService(t, &fakeVenue{})
	h := Handler(own, nil, WithPrizeHistory(ph))
	get := func() (int, historyDTO) {
		req := httptest.NewRequest(http.MethodGet, "/v1/prizes/history?limit=5", nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		var out historyDTO
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}
	code, out := get()
	if code != http.StatusOK {
		t.Fatalf("status %d", code)
	}
	if len(out.Pools) != 2 || out.Pools[0].Strategy != "direction" || out.Pools[0].Week != 2958 || !out.Pools[0].Settled || out.Pools[0].SettledAt == "" {
		t.Fatalf("pools = %+v", out.Pools)
	}
	if !strings.HasPrefix(out.Pools[1].Strategy, "0x") {
		t.Fatalf("unknown strategy key was dropped: %+v", out.Pools[1])
	}
	if p := out.Pools[0].Prizes; len(p) != 2 || !p[0].Claimed || p[0].ClaimTx != "0xtx" || p[1].Claimed || p[1].ClaimedAt != "" {
		t.Fatalf("prizes = %+v", p)
	}
	if out.Totals.Funded != "400000" || out.Totals.SettledPools != 1 || out.Source != "envio" || out.Stale {
		t.Fatalf("totals = %+v", out)
	}
	if _, _ = get(); fake.calls.Load() != 1 {
		t.Fatalf("indexer asked %d times within the cache window", fake.calls.Load())
	}
	now = now.Add(2 * time.Minute)
	fake.fail.Store(true)
	code, out = get()
	if code != http.StatusOK || !out.Stale || len(out.Pools) != 2 {
		t.Fatalf("after failure: %d %+v", code, out)
	}
	// Without a configured indexer the endpoint says so.
	bare := Handler(own, nil)
	req := httptest.NewRequest(http.MethodGet, "/v1/prizes/history", nil)
	rec := httptest.NewRecorder()
	bare.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured: %d", rec.Code)
	}
}
