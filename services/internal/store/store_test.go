package store

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"os"
	"testing"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
)

// These run against a real Postgres: TEST_DATABASE_URL (or DATABASE_URL).
// Each test works in its own wallet/account names, so they can share a
// database and re-run without cleanup.
func testStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		url = os.Getenv("DATABASE_URL")
	}
	if url == "" {
		t.Skip("no TEST_DATABASE_URL")
	}
	s, err := Open(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
}

func unique(prefix string) string { return prefix + "-" + time.Now().Format("150405.000000") }

func TestKeysRoundTrip(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	addr := unique("0xKEY")
	k := KeyRecord{Address: addr, APIKey: "tok", PrivateKey: priv, Label: "x", BuilderID: 18, MaxBuilderFeePer100K: 50, MaxBuilderFeePct: "0.050%", EnrolledAt: time.Now().UTC().Truncate(time.Microsecond)}
	if err := s.PutKey(ctx, k); err != nil {
		t.Fatal(err)
	}
	keys, err := s.Keys(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var found *KeyRecord
	for i := range keys {
		if keys[i].Address == addrLower(addr) {
			found = &keys[i]
		}
	}
	if found == nil || found.APIKey != "tok" || !found.PrivateKey.Equal(priv) || found.BuilderID != 18 || !found.EnrolledAt.Equal(k.EnrolledAt) {
		t.Fatalf("key = %+v", found)
	}
	if err := s.DeleteKey(ctx, addr); err != nil {
		t.Fatal(err)
	}
}

func addrLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}

func TestPolicyStateAndKill(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	acct := unique("acct")
	a := PolicyAccount{Account: acct, DayStart: time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC), RealizedLoss: fixed.MustParse("0.372858"), LastOpen: time.Now().UTC().Truncate(time.Microsecond), OpenPositions: 1, Exposure: fixed.MustParse("9.95705")}
	if err := s.SavePolicyAccount(ctx, a); err != nil {
		t.Fatal(err)
	}
	a.RealizedLoss = fixed.MustParse("1.5")
	if err := s.SavePolicyAccount(ctx, a); err != nil {
		t.Fatal(err)
	}
	all, err := s.PolicyAccounts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var got *PolicyAccount
	for i := range all {
		if all[i].Account == acct {
			got = &all[i]
		}
	}
	if got == nil || got.RealizedLoss != fixed.MustParse("1.5") || got.Exposure != a.Exposure || !got.LastOpen.Equal(a.LastOpen) || got.OpenPositions != 1 {
		t.Fatalf("policy account = %+v", got)
	}
	if err := s.SaveKill(ctx, true, "test"); err != nil {
		t.Fatal(err)
	}
	killed, note, err := s.Kill(ctx)
	if err != nil || !killed || note != "test" {
		t.Fatalf("kill = %v %q %v", killed, note, err)
	}
	_ = s.SaveKill(ctx, false, "")
}

func TestHorizons(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	acct := unique("hz")
	at := time.Now().Add(15 * time.Minute).UTC().Truncate(time.Microsecond)
	if err := s.SaveHorizon(ctx, Horizon{Account: acct, Symbol: "MON", ClosesAt: at}); err != nil {
		t.Fatal(err)
	}
	hs, err := s.Horizons(ctx, acct)
	if err != nil || len(hs) != 1 || !hs[0].ClosesAt.Equal(at) {
		t.Fatalf("horizons = %+v %v", hs, err)
	}
	if err := s.DeleteHorizon(ctx, acct, "MON"); err != nil {
		t.Fatal(err)
	}
	hs, _ = s.Horizons(ctx, acct)
	if len(hs) != 0 {
		t.Fatal("horizon not deleted")
	}
}

func TestTradesJournalAndBoards(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	w1, w2 := unique("0xw1"), unique("0xw2")
	now := time.Now().UTC()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(s.TradeOpened(ctx, w1, "direction", "MON", "o1", now.Add(-time.Hour)))
	st, ok, err := s.OpenStrategy(ctx, w1, "MON")
	if err != nil || !ok || st != "direction" {
		t.Fatalf("open strategy = %q %v %v", st, ok, err)
	}
	closed, err := s.TradeClosed(ctx, w1, "MON", "direction", "c1", fixed.MustParse("3"), now.Add(-30*time.Minute))
	must(err)
	if closed.Strategy != "direction" || closed.OpenOrderID != "o1" {
		t.Fatalf("closed = %+v", closed)
	}
	must(s.TradeOpened(ctx, w2, "ma-cross", "MON", "o2", now.Add(-20*time.Minute)))
	_, err = s.TradeClosed(ctx, w2, "MON", "ma-cross", "c2", fixed.MustParse("-1"), now.Add(-10*time.Minute))
	must(err)
	// A close with no open on record is journaled whole under the fallback.
	_, err = s.TradeClosed(ctx, w2, "BTC", "direction", "c3", fixed.MustParse("0.5"), now.Add(-5*time.Minute))
	must(err)
	// Open right now.
	must(s.TradeOpened(ctx, w1, "ma-cross", "MON", "o4", now))

	boards, err := s.Boards(ctx, now.Add(-2*time.Hour), now.Add(time.Hour), 10)
	must(err)
	dir := boards["direction"]
	// Other tests' wallets may be present; check ours by name.
	var w1Line, w2Line *Standing
	for i := range dir.Top {
		if dir.Top[i].Wallet == w1 {
			w1Line = &dir.Top[i]
		}
		if dir.Top[i].Wallet == w2 {
			w2Line = &dir.Top[i]
		}
	}
	if w1Line == nil || w1Line.PnL != fixed.FromInt(3) || w1Line.Trades != 1 {
		t.Fatalf("w1 on direction = %+v", w1Line)
	}
	if w2Line == nil || w2Line.PnL != fixed.MustParse("0.5") {
		t.Fatalf("w2 on direction = %+v", w2Line)
	}
	ma := boards["ma-cross"]
	if ma == nil || ma.ActiveNow < 1 {
		t.Fatalf("ma-cross = %+v", ma)
	}
}
