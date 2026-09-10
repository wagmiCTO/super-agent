package store

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/seal"
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
	if err := s.DeleteKey(ctx, addr, ""); err != nil {
		t.Fatal(err)
	}
}

// Keys are one per (wallet, strategy); with a sealer the private key is
// encrypted at rest, rows written in the clear are re-sealed, and the
// wrong sealer cannot read them.
func TestStrategyKeysSealedAtRest(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	addr := unique("0xSEAL")
	put := func(strategy, token string) {
		t.Helper()
		if err := s.PutKey(ctx, KeyRecord{Address: addr, Strategy: strategy, APIKey: token, PrivateKey: priv, BuilderID: 18, MaxBuilderFeePer100K: 50, Derived: strategy != "", EnrolledAt: time.Now()}); err != nil {
			t.Fatal(err)
		}
	}
	put("", "wide")
	put("rsi", "rsi")
	t.Cleanup(func() { _ = s.DeleteKey(ctx, addr, ""); _ = s.DeleteKey(ctx, addr, "rsi") })
	mine := func(ks []KeyRecord) map[string]KeyRecord {
		out := map[string]KeyRecord{}
		for _, k := range ks {
			if k.Address == addrLower(addr) {
				out[k.Strategy] = k
			}
		}
		return out
	}
	ks, err := s.Keys(ctx)
	if err != nil {
		t.Fatal(err)
	}
	got := mine(ks)
	if len(got) != 2 || got["rsi"].APIKey != "rsi" || !got["rsi"].Derived || got[""].APIKey != "wide" || got[""].sealed {
		t.Fatalf("keys = %+v", got)
	}

	sl, _ := seal.New("0x" + strings.Repeat("ab", 32))
	if _, err := s.UseSealer(ctx, sl); err != nil {
		t.Fatal(err)
	}
	var raw []byte
	if err := s.pool.QueryRow(ctx, `select private_key from keys where address = $1 and strategy = 'rsi'`, addrLower(addr)).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if !seal.Sealed(raw) || bytes.Contains(raw, priv) {
		t.Fatal("private key is not sealed in the table")
	}
	ks, err = s.Keys(ctx)
	if err != nil {
		t.Fatal(err)
	}
	got = mine(ks)
	if !got["rsi"].sealed || !got["rsi"].PrivateKey.Equal(priv) || !got[""].PrivateKey.Equal(priv) {
		t.Fatalf("after sealing: %+v", got)
	}
	// Another process with another key cannot read them, and says so.
	other, _ := seal.New("0x" + strings.Repeat("cd", 32))
	s.sealer = other
	if _, err := s.Keys(ctx); err == nil {
		t.Fatal("sealed keys opened under the wrong key")
	}
	s.sealer = nil
	if _, err := s.Keys(ctx); err == nil {
		t.Fatal("sealed keys read without a sealer")
	}
	s.sealer = sl
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
	must(s.TradeOpened(ctx, w1, "direction", "MON", "o1", Fill{Side: "long", Size: fixed.FromInt(100), Price: fixed.MustParse("0.025")}, now.Add(-time.Hour)))
	st, ok, err := s.OpenStrategy(ctx, w1, "MON")
	if err != nil || !ok || st != "direction" {
		t.Fatalf("open strategy = %q %v %v", st, ok, err)
	}
	closed, err := s.TradeClosed(ctx, w1, "MON", "direction", "c1", Fill{Side: "long", Size: fixed.FromInt(100), Price: fixed.MustParse("0.026"), Fee: fixed.MustParse("0.001")}, fixed.MustParse("3"), "manual", now.Add(-30*time.Minute))
	must(err)
	if closed.Strategy != "direction" || closed.OpenOrderID != "o1" || closed.EntryPrice != fixed.MustParse("0.025") || closed.ExitPrice != fixed.MustParse("0.026") {
		t.Fatalf("closed = %+v", closed)
	}
	list, err := s.Trades(ctx, w1, "MON", "", 10)
	must(err)
	if len(list) != 1 || list[0].ExitPrice != fixed.MustParse("0.026") || list[0].ClosedAt.IsZero() || list[0].ExitFee != fixed.MustParse("0.001") || list[0].CloseReason != "manual" {
		t.Fatalf("trades = %+v", list)
	}
	if only, _ := s.Trades(ctx, w1, "MON", "ma-cross", 10); len(only) != 0 {
		t.Fatalf("strategy filter ignored: %+v", only)
	}
	must(s.TradeOpened(ctx, w2, "ma-cross", "MON", "o2", Fill{Side: "short", Size: fixed.FromInt(50), Price: fixed.MustParse("0.025")}, now.Add(-20*time.Minute)))
	_, err = s.TradeClosed(ctx, w2, "MON", "ma-cross", "c2", Fill{Side: "short", Size: fixed.FromInt(50), Price: fixed.MustParse("0.0255")}, fixed.MustParse("-1"), "horizon", now.Add(-10*time.Minute))
	must(err)
	// A close with no open on record is journaled whole under the fallback.
	_, err = s.TradeClosed(ctx, w2, "BTC", "direction", "c3", Fill{Side: "long", Size: fixed.FromInt(1), Price: fixed.FromInt(78000)}, fixed.MustParse("0.5"), "manual", now.Add(-5*time.Minute))
	must(err)
	// Open right now.
	must(s.TradeOpened(ctx, w1, "ma-cross", "MON", "o4", Fill{Side: "long", Size: fixed.FromInt(10), Price: fixed.MustParse("0.025")}, now))

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
