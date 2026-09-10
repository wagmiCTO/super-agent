package seal

import (
	"bytes"
	"strings"
	"testing"
)

const testKey = "0x" + "22222222222222222222222222222222" + "22222222222222222222222222222222"

func TestRoundTrip(t *testing.T) {
	s, err := New(testKey)
	if err != nil {
		t.Fatal(err)
	}
	secret := []byte("ed25519 seed bytes, 32 of them..")
	sealed, err := s.Seal(secret, "0xabc/direction")
	if err != nil {
		t.Fatal(err)
	}
	if !Sealed(sealed) || bytes.Contains(sealed, secret) {
		t.Fatal("record is not sealed")
	}
	got, err := s.Open(sealed, "0xabc/direction")
	if err != nil || !bytes.Equal(got, secret) {
		t.Fatalf("open: %v %q", err, got)
	}
	// Same key, another owner: refused.
	if _, err := s.Open(sealed, "0xdef/direction"); err == nil {
		t.Fatal("a record opened under another label")
	}
	// Another key: refused.
	other, _ := New(strings.Replace(testKey, "2222", "3333", 1))
	if _, err := other.Open(sealed, "0xabc/direction"); err == nil {
		t.Fatal("a record opened under another key")
	}
	// Plaintext is recognisable as such.
	if Sealed(secret) {
		t.Fatal("plaintext reported as sealed")
	}
	if _, err := s.Open(secret, ""); err == nil {
		t.Fatal("plaintext opened")
	}
}

func TestKeyValidation(t *testing.T) {
	for _, k := range []string{"", "abc", "0x" + strings.Repeat("1", 63), strings.Repeat("zz", 32)} {
		if _, err := New(k); err == nil {
			t.Fatalf("accepted key %q", k)
		}
	}
}
