package perpl

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"strings"
	"testing"
	"time"
)

// A fixed seed so the canonical strings and signatures are reproducible. This
// key is a test fixture and has never been enrolled anywhere.
const testSeedHex = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"

func testSigner(t *testing.T, chainID int64) *signer {
	t.Helper()
	s, err := newSigner("pk_test", testSeedHex, chainID)
	if err != nil {
		t.Fatalf("newSigner: %v", err)
	}
	s.now = func() time.Time { return time.UnixMilli(1788867902000) }
	s.nonce = func() (string, error) { return "AAECAwQFBgcICQoLDA0ODw", nil }
	return s
}

// The canonical strings are byte-exact contracts with the server; a stray space
// or a reordered field is a 401 that looks like a key problem.
func TestRESTCanonical(t *testing.T) {
	tests := []struct {
		name   string
		method string
		target string
		body   string
		want   []string
	}{
		{
			name:   "get with query string, empty body",
			method: "GET",
			target: "/v1/trading/fills?count=1",
			want: []string{
				"10143",
				"GET",
				"/v1/trading/fills?count=1",
				"1788867902000",
				"AAECAwQFBgcICQoLDA0ODw",
				// sha256 of the empty string
				"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			},
		},
		{
			name:   "post with body",
			method: "POST",
			target: "/v1/api-key/payload",
			body:   `{"chain_id":10143}`,
			want: []string{
				"10143",
				"POST",
				"/v1/api-key/payload",
				"1788867902000",
				"AAECAwQFBgcICQoLDA0ODw",
				"", // body hash is checked for shape below, not pinned
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := restCanonical(10143, tc.method, tc.target, "1788867902000", "AAECAwQFBgcICQoLDA0ODw", []byte(tc.body))
			lines := strings.Split(got, "\n")
			if len(lines) != 6 {
				t.Fatalf("canonical has %d lines, want 6:\n%s", len(lines), got)
			}
			for i := range 5 {
				if lines[i] != tc.want[i] {
					t.Errorf("line %d = %q, want %q", i, lines[i], tc.want[i])
				}
			}
			if len(lines[5]) != 64 {
				t.Errorf("body hash %q is not a 64-char hex digest", lines[5])
			}
		})
	}
}

func TestWSCanonical(t *testing.T) {
	got := wsCanonical(10143, "1788867902000", "AAECAwQFBgcICQoLDA0ODw")
	want := "10143\ntrading-ws-signin\n1788867902000\nAAECAwQFBgcICQoLDA0ODw"
	if got != want {
		t.Errorf("wsCanonical =\n%q\nwant\n%q", got, want)
	}
}

// The signature must verify against the public key the server holds, and be
// unpadded base64url — padded base64 is rejected.
func TestRESTHeadersVerify(t *testing.T) {
	s := testSigner(t, 10143)
	headers, err := s.restHeaders("GET", "/v1/trading/fills?count=1", nil)
	if err != nil {
		t.Fatalf("restHeaders: %v", err)
	}
	for _, h := range []string{"X-API-Key", "X-API-Timestamp", "X-API-Nonce", "X-API-Signature"} {
		if headers[h] == "" {
			t.Errorf("missing header %s", h)
		}
	}
	if strings.Contains(headers["X-API-Signature"], "=") {
		t.Errorf("signature %q is padded; the server expects unpadded base64url", headers["X-API-Signature"])
	}
	sig, err := base64.RawURLEncoding.DecodeString(headers["X-API-Signature"])
	if err != nil {
		t.Fatalf("signature is not base64url: %v", err)
	}
	canonical := restCanonical(10143, "GET", "/v1/trading/fills?count=1", headers["X-API-Timestamp"], headers["X-API-Nonce"], nil)
	if !ed25519.Verify(publicKey(t), []byte(canonical), sig) {
		t.Error("signature does not verify against the canonical string")
	}
}

func TestSignInFrameVerifies(t *testing.T) {
	s := testSigner(t, 10143)
	frame, err := s.signInFrame()
	if err != nil {
		t.Fatalf("signInFrame: %v", err)
	}
	if frame.MsgType != msgAPIKeySignIn {
		t.Errorf("mt = %d, want %d", frame.MsgType, msgAPIKeySignIn)
	}
	if frame.ChainID != 10143 {
		t.Errorf("chain_id = %d, want 10143", frame.ChainID)
	}
	sig, err := base64.RawURLEncoding.DecodeString(frame.Signature)
	if err != nil {
		t.Fatalf("signature is not base64url: %v", err)
	}
	if !ed25519.Verify(publicKey(t), []byte(wsCanonical(10143, frame.Timestamp, frame.Nonce)), sig) {
		t.Error("sign-in signature does not verify")
	}
}

// A nonce is single-use within the validity window, so two calls must differ.
func TestNoncesAreUnique(t *testing.T) {
	seen := make(map[string]bool, 64)
	for range 64 {
		n, err := randomNonce()
		if err != nil {
			t.Fatalf("randomNonce: %v", err)
		}
		if seen[n] {
			t.Fatalf("duplicate nonce %q", n)
		}
		seen[n] = true
	}
}

// Perpl's own tooling hands out a 32-byte seed; some libraries hand out the
// 64-byte expanded key. Both must work, and anything else must fail loudly.
func TestNewSignerAcceptsSeedAndFullKey(t *testing.T) {
	seed, err := hex.DecodeString(testSeedHex)
	if err != nil {
		t.Fatal(err)
	}
	full := ed25519.NewKeyFromSeed(seed)

	tests := []struct {
		name    string
		secret  string
		wantErr bool
	}{
		{"32-byte seed", testSeedHex, false},
		{"32-byte seed with 0x", "0x" + testSeedHex, false},
		{"64-byte private key", hex.EncodeToString(full), false},
		{"not hex", "zzzz", true},
		{"wrong length", "0011", true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := newSigner("pk", tc.secret, 10143)
			if (err != nil) != tc.wantErr {
				t.Errorf("newSigner error = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}

func publicKey(t *testing.T) ed25519.PublicKey {
	t.Helper()
	seed, err := hex.DecodeString(testSeedHex)
	if err != nil {
		t.Fatal(err)
	}
	return ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey)
}
