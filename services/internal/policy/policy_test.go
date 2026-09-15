package policy

import (
	"errors"
	"testing"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

const account = "acct-1"

func testLimits() Limits {
	return Limits{
		AllowedSymbols:   []string{"MON", "BTC"},
		MinNotional:      fixed.FromInt(5),
		MaxNotional:      fixed.FromInt(100),
		MaxLeverage:      fixed.FromInt(3),
		MaxTotalExposure: fixed.FromInt(150),
		MaxOpenPositions: 2,
		DailyLoss:        fixed.FromInt(50),
		Cooldown:         10 * time.Second,
	}
}

// testEngine returns an engine with a controllable clock, so cooldowns and day
// rollovers are tested without sleeping.
func testEngine(t *testing.T, now *time.Time) *Engine {
	t.Helper()
	e := New()
	e.now = func() time.Time { return *now }
	if err := e.SetLimits(account, testLimits()); err != nil {
		t.Fatalf("SetLimits: %v", err)
	}
	return e
}

func openReq(notional, leverage int64) Request {
	return Request{
		Account:  account,
		Symbol:   "MON",
		Notional: fixed.FromInt(notional),
		Leverage: fixed.FromInt(leverage),
	}
}

func denialReason(t *testing.T, err error) Reason {
	t.Helper()
	if err == nil {
		t.Fatal("expected a denial, got nil")
	}
	if !errors.Is(err, ErrDenied) {
		t.Fatalf("error %v does not match ErrDenied", err)
	}
	var d *Denial
	if !errors.As(err, &d) {
		t.Fatalf("error %v does not carry a *Denial", err)
	}
	return d.Reason
}

func TestAuthorize(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name string
		req  Request
		want Reason // "" means allowed
	}{
		{"ordinary open", openReq(50, 2), ""},
		{"at the notional ceiling", openReq(100, 2), ""},
		{"at the leverage ceiling", openReq(50, 3), ""},
		{"symbol not whitelisted", Request{Account: account, Symbol: "PUMP", Notional: fixed.FromInt(50), Leverage: fixed.FromInt(2)}, ReasonSymbolNotAllowed},
		{"symbol case is ignored", Request{Account: account, Symbol: "mon", Notional: fixed.FromInt(50), Leverage: fixed.FromInt(2)}, ""},
		{"notional too large", openReq(101, 2), ReasonNotionalTooLarge},
		{"notional too small", openReq(4, 2), ReasonNotionalTooSmall},
		{"notional zero", openReq(0, 2), ReasonMalformed},
		{"leverage too high", openReq(50, 4), ReasonLeverageTooHigh},
		{"missing account", Request{Symbol: "MON", Notional: fixed.FromInt(50)}, ReasonMalformed},
		{"missing symbol", Request{Account: account, Notional: fixed.FromInt(50)}, ReasonMalformed},
		{"unknown account", Request{Account: "nobody", Symbol: "MON", Notional: fixed.FromInt(50), Leverage: fixed.FromInt(1)}, ReasonMalformed},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			e := testEngine(t, &now)
			err := e.Authorize(tc.req)
			if tc.want == "" {
				if err != nil {
					t.Fatalf("expected allowed, got %v", err)
				}
				return
			}
			if got := denialReason(t, err); got != tc.want {
				t.Errorf("reason = %s, want %s", got, tc.want)
			}
		})
	}
}

// An account with no limits configured must be denied rather than defaulted to
// something permissive.
func TestUnconfiguredAccountIsDenied(t *testing.T) {
	now := time.Now()
	e := New()
	e.now = func() time.Time { return now }
	if err := e.Authorize(openReq(10, 1)); err == nil {
		t.Fatal("an account with no limits was allowed to trade")
	}
}

// Closing is the one thing that is never refused. A risk control that traps
// someone in a position makes the risk worse, not better.
func TestClosingIsAlwaysAllowed(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	e := testEngine(t, &now)

	closeReq := Request{Account: account, Symbol: "PUMP", Reduce: true, Notional: fixed.FromInt(10_000), Leverage: fixed.FromInt(50)}

	e.Kill("operator halted trading")
	if err := e.Authorize(closeReq); err != nil {
		t.Errorf("closing refused while killed: %v", err)
	}

	e.Revive()
	e.RecordClose(account, fixed.FromInt(100), fixed.FromInt(-100)) // blow the daily loss limit
	if err := e.Authorize(closeReq); err != nil {
		t.Errorf("closing refused after the daily loss limit: %v", err)
	}
	e.RecordOpen(account, fixed.FromInt(10)) // start a cooldown
	if err := e.Authorize(closeReq); err != nil {
		t.Errorf("closing refused during cooldown: %v", err)
	}
	// ...but opening in the same conditions is refused.
	if err := e.Authorize(openReq(10, 1)); err == nil {
		t.Error("opening was allowed after the daily loss limit was reached")
	}
}

func TestKillSwitch(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	e := testEngine(t, &now)

	if err := e.Authorize(openReq(10, 1)); err != nil {
		t.Fatalf("expected allowed before kill: %v", err)
	}
	e.Kill("venue outage")

	killed, reason := e.Killed()
	if !killed || reason != "venue outage" {
		t.Errorf("Killed() = %v, %q", killed, reason)
	}
	if got := denialReason(t, e.Authorize(openReq(10, 1))); got != ReasonKillSwitch {
		t.Errorf("reason = %s, want %s", got, ReasonKillSwitch)
	}

	e.Revive()
	if err := e.Authorize(openReq(10, 1)); err != nil {
		t.Errorf("expected allowed after revive: %v", err)
	}
}

func TestCooldown(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	e := testEngine(t, &now)

	if err := e.Authorize(openReq(10, 1)); err != nil {
		t.Fatalf("first open: %v", err)
	}
	e.RecordOpen(account, fixed.FromInt(10))

	if got := denialReason(t, e.Authorize(openReq(10, 1))); got != ReasonCooldown {
		t.Fatalf("reason = %s, want %s", got, ReasonCooldown)
	}

	now = now.Add(9 * time.Second)
	if got := denialReason(t, e.Authorize(openReq(10, 1))); got != ReasonCooldown {
		t.Errorf("still inside cooldown: reason = %s", got)
	}
	now = now.Add(2 * time.Second)
	if err := e.Authorize(openReq(10, 1)); err != nil {
		t.Errorf("cooldown should have expired: %v", err)
	}
}

// A refused order must not start a cooldown: RecordOpen is called only after
// the venue accepts the order.
func TestDeniedOrderDoesNotStartCooldown(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	e := testEngine(t, &now)

	if err := e.Authorize(openReq(1000, 1)); err == nil {
		t.Fatal("expected the oversized order to be denied")
	}
	if err := e.Authorize(openReq(10, 1)); err != nil {
		t.Errorf("a denied order started a cooldown: %v", err)
	}
}

func TestDailyLossLimitAndRollover(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	e := testEngine(t, &now)

	e.RecordOpen(account, fixed.FromInt(50))
	e.RecordClose(account, fixed.FromInt(50), fixed.MustParse("-30"))
	now = now.Add(time.Minute)

	if err := e.Authorize(openReq(10, 1)); err != nil {
		t.Fatalf("30 of a 50 loss limit should still allow trading: %v", err)
	}
	if got := e.Snapshot(account).DailyLoss; got != fixed.FromInt(30) {
		t.Errorf("DailyLoss = %s, want 30", got)
	}

	e.RecordOpen(account, fixed.FromInt(50))
	e.RecordClose(account, fixed.FromInt(50), fixed.MustParse("-25"))
	now = now.Add(time.Minute)

	if got := denialReason(t, e.Authorize(openReq(10, 1))); got != ReasonDailyLossReached {
		t.Fatalf("reason = %s, want %s", got, ReasonDailyLossReached)
	}

	// The budget is judged on the day's net result: a win earns back the room
	// a loss took, because "how much am I down today" is the question the
	// budget answers. 55 lost, then 100 made: the day is up 45.
	e.RecordOpen(account, fixed.FromInt(10))
	e.RecordClose(account, fixed.FromInt(10), fixed.FromInt(100))
	now = now.Add(time.Minute)
	if err := e.Authorize(openReq(10, 1)); err != nil {
		t.Errorf("a day that is net up is still refused: %v", err)
	}
	if got := e.Snapshot(account).DailyLoss; !got.IsZero() {
		t.Errorf("DailyLoss after a net-up day = %s, want 0", got)
	}
	// And the next loss counts from zero, not from below it: 30 down on a
	// day that was 45 up is 30 down... no — it is the net that counts, so
	// 45 up then 30 down is still up 15, and a further 60 down is 45 down.
	e.RecordOpen(account, fixed.FromInt(10))
	e.RecordClose(account, fixed.FromInt(10), fixed.MustParse("-30"))
	if got := e.Snapshot(account).DailyLoss; !got.IsZero() {
		t.Errorf("DailyLoss after +45 −30 = %s, want 0", got)
	}
	e.RecordOpen(account, fixed.FromInt(10))
	e.RecordClose(account, fixed.FromInt(10), fixed.MustParse("-60"))
	if got := e.Snapshot(account).DailyLoss; got != fixed.FromInt(45) {
		t.Errorf("DailyLoss after +45 −30 −60 = %s, want 45", got)
	}
	now = now.Add(time.Minute)
	if err := e.Authorize(openReq(10, 1)); err != nil {
		t.Errorf("45 of a 50 loss limit should still allow trading: %v", err)
	}
	e.RecordOpen(account, fixed.FromInt(10))
	e.RecordClose(account, fixed.FromInt(10), fixed.MustParse("-5"))
	now = now.Add(time.Minute)
	if got := denialReason(t, e.Authorize(openReq(10, 1))); got != ReasonDailyLossReached {
		t.Fatalf("reason at 50 of 50 = %s, want %s", got, ReasonDailyLossReached)
	}

	// The next UTC day resets it.
	now = time.Date(2026, 9, 9, 0, 0, 1, 0, time.UTC)
	if err := e.Authorize(openReq(10, 1)); err != nil {
		t.Errorf("daily loss did not reset after midnight UTC: %v", err)
	}
}

func TestOpenPositionAndExposureLimits(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	e := testEngine(t, &now)

	e.RecordOpen(account, fixed.FromInt(100))
	now = now.Add(time.Minute)
	e.RecordOpen(account, fixed.FromInt(100))
	now = now.Add(time.Minute)

	if got := denialReason(t, e.Authorize(openReq(10, 1))); got != ReasonTooManyPositions {
		t.Fatalf("reason = %s, want %s", got, ReasonTooManyPositions)
	}

	e.RecordClose(account, fixed.FromInt(100), fixed.FromInt(0))
	if err := e.Authorize(openReq(10, 1)); err != nil {
		t.Fatalf("a slot freed up but opening was refused: %v", err)
	}
	// 100 is still open, so another 100 would put total exposure at 200
	// against a 150 cap - even though each position is within MaxNotional.
	if got := denialReason(t, e.Authorize(openReq(100, 1))); got != ReasonExposureTooLarge {
		t.Errorf("reason = %s, want %s", got, ReasonExposureTooLarge)
	}
}

// After a restart the engine trusts the exchange, not its own memory.
func TestReconcileReplacesLocalState(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	e := testEngine(t, &now)

	e.RecordOpen(account, fixed.FromInt(100))
	e.RecordOpen(account, fixed.FromInt(100))

	e.Reconcile(account, []venue.Position{
		{Symbol: "MON", EntryPrice: fixed.MustParse("0.025"), Size: fixed.FromInt(400)}, // 10
	})

	snap := e.Snapshot(account)
	if snap.OpenPositions != 1 {
		t.Errorf("OpenPositions = %d, want 1", snap.OpenPositions)
	}
	if want := fixed.FromInt(10); snap.Exposure != want {
		t.Errorf("Exposure = %s, want %s", snap.Exposure, want)
	}
	if err := e.Authorize(openReq(10, 1)); err == nil {
		t.Error("reconcile cleared the cooldown, which belongs to our own history")
	}
}

func TestLimitsValidate(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(*Limits)
		wantErr bool
	}{
		{"valid", func(*Limits) {}, false},
		{"no symbols", func(l *Limits) { l.AllowedSymbols = nil }, true},
		{"zero max notional", func(l *Limits) { l.MaxNotional = 0 }, true},
		{"min above max", func(l *Limits) { l.MinNotional = fixed.FromInt(200) }, true},
		{"negative min", func(l *Limits) { l.MinNotional = fixed.FromInt(-1) }, true},
		{"zero leverage", func(l *Limits) { l.MaxLeverage = 0 }, true},
		{"zero positions", func(l *Limits) { l.MaxOpenPositions = 0 }, true},
		{"zero daily loss", func(l *Limits) { l.DailyLoss = 0 }, true},
		{"negative cooldown", func(l *Limits) { l.Cooldown = -time.Second }, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			l := testLimits()
			tc.mutate(&l)
			if err := l.Validate(); (err != nil) != tc.wantErr {
				t.Errorf("Validate() = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}

// The zero Limits value must deny, so a struct that was never filled in cannot
// silently permit trading.
func TestZeroLimitsAreInvalid(t *testing.T) {
	if err := (Limits{}).Validate(); err == nil {
		t.Error("the zero Limits value validated")
	}
}

func TestFromOrder(t *testing.T) {
	got := FromOrder(account, venue.OrderRequest{
		Symbol:   "MON",
		Reduce:   true,
		Notional: fixed.FromInt(25),
		Leverage: fixed.FromInt(3),
	})
	want := Request{Account: account, Symbol: "MON", Reduce: true, Notional: fixed.FromInt(25), Leverage: fixed.FromInt(3)}
	if got != want {
		t.Errorf("FromOrder = %+v, want %+v", got, want)
	}
}

// Opening records the requested notional; closing subtracts what the venue
// actually filled, which lot rounding makes slightly different. Once no
// position is open, exposure must read exactly zero.
func TestExposureIsZeroWhenFlat(t *testing.T) {
	e := New()
	account := "480"
	e.RecordOpen(account, fixed.FromInt(10))
	closed, err := fixed.Parse("9.95705")
	if err != nil {
		t.Fatal(err)
	}
	e.RecordClose(account, closed, 0)
	if got := e.Snapshot(account).Exposure; got != 0 {
		t.Fatalf("exposure when flat = %s, want 0", got)
	}
}

// A wallet trading three strategies through three keys is one person with
// one day: the accounts share the budget, the cooldown and the count of
// open positions through their limits' Group.
func TestGroupSharesOneDay(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	e := testEngine(t, &now)
	l, _ := e.Limits(account)
	l.Group = "wallet"
	l.MaxOpenPositions = 2
	l.Cooldown = 0
	for _, a := range []string{"wallet/direction", "wallet/ma-cross", "wallet/rsi"} {
		if err := e.SetLimits(a, l); err != nil {
			t.Fatal(err)
		}
	}
	open := func(a string) error {
		return e.Authorize(Request{Account: a, Symbol: "MON", Notional: fixed.FromInt(10), Leverage: fixed.FromInt(1)})
	}
	e.RecordOpen("wallet/direction", fixed.FromInt(10))
	e.RecordOpen("wallet/ma-cross", fixed.FromInt(10))
	if got := denialReason(t, open("wallet/rsi")); got != ReasonTooManyPositions {
		t.Fatalf("third strategy saw its own count: reason = %s", got)
	}
	e.RecordClose("wallet/direction", fixed.FromInt(10), fixed.MustParse("-50"))
	e.RecordClose("wallet/ma-cross", fixed.FromInt(10), fixed.FromInt(0))
	if got := e.Snapshot("wallet/rsi").DailyLoss; got != fixed.FromInt(50) {
		t.Fatalf("the loss did not reach the sibling: %s", got)
	}
	if got := denialReason(t, open("wallet/rsi")); got != ReasonDailyLossReached {
		t.Fatalf("a sibling's loss did not spend the budget: reason = %s", got)
	}
	// An account outside the group keeps its own day.
	if err := open(account); err != nil {
		t.Fatalf("an unrelated account was refused: %v", err)
	}
}
