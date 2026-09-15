package platform

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/policy"
)

// The loss budget is a share of the day's starting balance; the other two
// choices pass straight through; leverage is the venue's.
func TestComputeLimits(t *testing.T) {
	base := testLimits()
	l := ComputeLimits(base, SafeTier, fixed.FromInt(1000), 0, fixed.FromInt(15))
	if l.DailyLoss != fixed.FromInt(200) || l.MaxOpenPositions != 2 || l.Cooldown.Seconds() != 10 || l.MaxLeverage != fixed.FromInt(15) {
		t.Fatalf("safe limits = %+v", l)
	}
	// 80 left after losing 20: the budget is still 20% of the 100 the day began with.
	l = ComputeLimits(base, SafeTier, fixed.FromInt(80), fixed.FromInt(20), 0)
	if l.DailyLoss != fixed.FromInt(20) || l.MaxLeverage != base.MaxLeverage {
		t.Fatalf("mid-day limits = %+v", l)
	}
	// An empty account falls back to the platform's number rather than a zero limit.
	l = ComputeLimits(base, CeilingTier, 0, 0, 0)
	if l.DailyLoss != base.DailyLoss || l.MaxOpenPositions != 5 || l.Cooldown != 0 {
		t.Fatalf("empty-account limits = %+v", l)
	}
	if err := l.Validate(); err != nil {
		t.Fatalf("computed limits do not validate: %v", err)
	}
}

func TestLimitTierValidate(t *testing.T) {
	for _, tc := range []struct {
		name string
		tier LimitTier
		ok   bool
	}{
		{"safe", SafeTier, true},
		{"ceiling", CeilingTier, true},
		{"over budget", LimitTier{DailyLossPct: 76, MaxOpenPositions: 2, CooldownSeconds: 10}, false},
		{"too many positions", LimitTier{DailyLossPct: 20, MaxOpenPositions: 6, CooldownSeconds: 10}, false},
		{"negative cooldown", LimitTier{DailyLossPct: 20, MaxOpenPositions: 2, CooldownSeconds: -1}, false},
		{"zero budget", LimitTier{DailyLossPct: 0, MaxOpenPositions: 2, CooldownSeconds: 10}, false},
	} {
		if err := tc.tier.Validate(); (err == nil) != tc.ok {
			t.Errorf("%s: err = %v, want ok=%v", tc.name, err, tc.ok)
		}
	}
}

// The wallet's choice is stored, reported with the tiers, and in force on
// the next read: the balance-following limits pick it up.
func TestLimitsEndpointAndReport(t *testing.T) {
	fv := &fakeVenue{}
	svc, eng := newService(t, fv)
	prefs := NewMemLimits()
	base := testLimits()
	svc.UseLimits(func(ctx context.Context, balance, loss fixed.D) policy.Limits {
		return ComputeLimits(base, tierFor(ctx, prefs, svc.account), balance, loss, fixed.FromInt(3))
	})
	h := Handler(svc, nil, WithOwnAccount(true), WithLedger(NewLedger()), WithLimitsStore(prefs))

	get := func(path string) limitsBlockDTO {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s: %d %s", path, rec.Code, rec.Body)
		}
		if path == "/v1/risk" {
			var out riskReportDTO
			if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
				t.Fatal(err)
			}
			return out.Limits
		}
		var out limitsBlockDTO
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}

	// The safe tier, on a balance of 1000: a budget of 200.
	block := get("/v1/limits")
	if block.Chosen != SafeTier || block.Safe != SafeTier || block.Ceiling != CeilingTier || block.DayResetsAt == "" {
		t.Fatalf("block = %+v", block)
	}
	if block.Active == nil || block.Active.DailyLoss != "200" || block.Active.MaxOpenPositions != 2 || block.Active.CooldownSeconds != 10 || block.Balance != "1000" {
		t.Fatalf("active = %+v balance %s", block.Active, block.Balance)
	}

	// Out of the tiers: refused, nothing stored.
	req := httptest.NewRequest(http.MethodPut, "/v1/limits", strings.NewReader(`{"daily_loss_pct":90,"max_open_positions":2,"cooldown_seconds":10}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("over the ceiling: %d %s", rec.Code, rec.Body)
	}
	if _, ok, _ := prefs.WalletLimits(context.Background(), svc.account); ok {
		t.Fatal("a refused choice was stored")
	}

	// Into the danger zone: stored, reported, and in force.
	req = httptest.NewRequest(http.MethodPut, "/v1/limits", strings.NewReader(`{"daily_loss_pct":75,"max_open_positions":5,"cooldown_seconds":0}`))
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT: %d %s", rec.Code, rec.Body)
	}
	block = get("/v1/risk")
	if block.Chosen != CeilingTier {
		t.Fatalf("chosen after PUT = %+v", block.Chosen)
	}
	if block.Active == nil || block.Active.DailyLoss != "750" || block.Active.MaxOpenPositions != 5 || block.Active.CooldownSeconds != 0 {
		t.Fatalf("active after PUT = %+v", block.Active)
	}
	if l, _ := eng.Limits(svc.account); l.DailyLoss != fixed.FromInt(750) {
		t.Fatalf("engine limits = %+v", l)
	}
}
