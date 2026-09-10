package keys

import (
	"crypto/ed25519"
	"crypto/rand"
	"path/filepath"
	"testing"
	"time"
)

// A key put into a file-backed store is there after the store is reopened,
// and a deleted one is not.
func TestFileRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "keys.json")
	s, err := WithFile(path)
	if err != nil {
		t.Fatal(err)
	}
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	k := Key{Address: "0xABC", APIKey: "tok", PrivateKey: priv, Label: "x", BuilderID: 18, MaxBuilderFeePer100K: 50, MaxBuilderFeePct: "0.050%", EnrolledAt: time.Now().UTC().Truncate(time.Second)}
	if err := s.Put(k); err != nil {
		t.Fatal(err)
	}
	if err := s.Put(Key{Address: "0xDEF", APIKey: "tok2", PrivateKey: priv}); err != nil {
		t.Fatal(err)
	}
	if err := s.Put(Key{Address: "0xABC", Strategy: "rsi", APIKey: "tok-rsi", PrivateKey: priv, Derived: true}); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete("0xdef", ""); err != nil {
		t.Fatal(err)
	}

	again, err := WithFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if again.Len() != 2 {
		t.Fatalf("keys after reopen = %d, want 2", again.Len())
	}
	got, err := again.Get("0xabc", "")
	if err != nil {
		t.Fatal(err)
	}
	if got.APIKey != "tok" || !got.PrivateKey.Equal(priv) || got.BuilderID != 18 || !got.EnrolledAt.Equal(k.EnrolledAt) {
		t.Errorf("reloaded key = %+v", got)
	}
	if rsi, err := again.Get("0xabc", "rsi"); err != nil || rsi.APIKey != "tok-rsi" || !rsi.Derived {
		t.Errorf("reloaded strategy key = %+v, %v", rsi, err)
	}
}

// A strategy with its own key gets it; one without falls back to the
// wallet-wide key; a wallet with neither has nothing.
func TestResolvePrefersTheStrategyKey(t *testing.T) {
	s := New()
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	_ = s.Put(Key{Address: "0xabc", APIKey: "wide", PrivateKey: priv})
	_ = s.Put(Key{Address: "0xabc", Strategy: "rsi", APIKey: "rsi", PrivateKey: priv})
	if k, _ := s.Resolve("0xABC", "rsi"); k.APIKey != "rsi" {
		t.Fatalf("rsi resolved to %q", k.APIKey)
	}
	if k, _ := s.Resolve("0xabc", "direction"); k.APIKey != "wide" {
		t.Fatalf("direction resolved to %q, want the wallet-wide key", k.APIKey)
	}
	if _, err := s.Get("0xabc", "direction"); err != ErrNotFound {
		t.Fatal("Get fell back to the wallet-wide key")
	}
	if _, err := s.Resolve("0xdef", "rsi"); err != ErrNotFound {
		t.Fatal("an unknown wallet resolved a key")
	}
	if ks := s.ForWallet("0xabc"); len(ks) != 2 || ks[0].Strategy != "" || ks[1].Strategy != "rsi" {
		t.Fatalf("ForWallet = %+v", ks)
	}
}

// A derived key arrives as a public key; the private key is not generated.
func TestPreparePendingDerived(t *testing.T) {
	s := New()
	pub, _, _ := ed25519.GenerateKey(rand.Reader)
	p, err := s.PreparePending(PendingRequest{Address: "0xABC", Strategy: "rsi", Label: "x", BuilderID: 18, MaxFee: 50, PublicKey: pub})
	if err != nil {
		t.Fatal(err)
	}
	if !p.Derived || p.PrivateKey != nil || !p.PublicKey.Equal(pub) || p.Address != "0xabc" || p.Strategy != "rsi" {
		t.Fatalf("pending = %+v", p)
	}
	if _, err := s.PreparePending(PendingRequest{Address: "0xABC", PublicKey: []byte{1, 2, 3}}); err == nil {
		t.Fatal("accepted a short public key")
	}
	g, _ := s.PreparePending(PendingRequest{Address: "0xABC"})
	if g.Derived || g.PrivateKey == nil {
		t.Fatalf("generated pending = %+v", g)
	}
}
