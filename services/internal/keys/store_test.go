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
	if err := s.Delete("0xdef"); err != nil {
		t.Fatal(err)
	}

	again, err := WithFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if again.Len() != 1 {
		t.Fatalf("keys after reopen = %d, want 1", again.Len())
	}
	got, err := again.Get("0xabc")
	if err != nil {
		t.Fatal(err)
	}
	if got.APIKey != "tok" || !got.PrivateKey.Equal(priv) || got.BuilderID != 18 || !got.EnrolledAt.Equal(k.EnrolledAt) {
		t.Errorf("reloaded key = %+v", got)
	}
}
