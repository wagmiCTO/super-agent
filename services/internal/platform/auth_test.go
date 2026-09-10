package platform

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/chain"
	"github.com/wagmiCTO/super-agent/services/internal/keys"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

// A wallet registers a request-signing key with its own signature; from
// then on its requests must be signed by that key, and unsigned, badly
// signed, stale or foreign-key requests are refused. A wallet without a
// registered key is served as before.
func TestSignedRequests(t *testing.T) {
	own, _ := newService(t, &fakeVenue{})
	wallet, err := chain.ParseKey("0x" + strings.Repeat("42", 32))
	if err != nil {
		t.Fatal(err)
	}
	addr := "0x" + hex.EncodeToString(wallet.Address[:])
	r := NewRegistry(storeWithKey(t, addr), func(context.Context, keys.Key) (venue.Adapter, error) {
		return &fakeVenue{}, nil
	}, testLimits(), nil, nil, nil)
	h := Handler(own, nil, WithRegistry(r))

	call := func(method, uri string, body []byte, hdr http.Header) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, uri, bytes.NewReader(body))
		req.Header.Set(AccountHeader, addr)
		for k, v := range hdr {
			req.Header[k] = v
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	// Before registration: routing only.
	if rec := call(http.MethodGet, "/v1/state?strategy=direction", nil, nil); rec.Code != http.StatusOK {
		t.Fatalf("unsigned before registration: %d %s", rec.Code, rec.Body)
	}

	// Register: the wallet signs the message naming the key.
	pub, priv, _ := ed25519.GenerateKey(nil)
	issued := time.Now().UTC().Truncate(time.Second)
	sig := wallet.SignPersonal([]byte(RegistrationMessage(addr, pub, issued)))
	body, _ := json.Marshal(registerAuthKeyDTO{Address: addr, PublicKey: hex.EncodeToString(pub), IssuedAt: issued.Format(time.RFC3339), Signature: "0x" + hex.EncodeToString(sig)})
	if rec := call(http.MethodPost, "/v1/auth/keys", body, nil); rec.Code != http.StatusOK {
		t.Fatalf("register: %d %s", rec.Code, rec.Body)
	}
	// A signature by another wallet does not register a key for this one.
	other, _ := chain.ParseKey("0x" + strings.Repeat("43", 32))
	pub2, _, _ := ed25519.GenerateKey(nil)
	sig2 := other.SignPersonal([]byte(RegistrationMessage(addr, pub2, issued)))
	body2, _ := json.Marshal(registerAuthKeyDTO{Address: addr, PublicKey: hex.EncodeToString(pub2), IssuedAt: issued.Format(time.RFC3339), Signature: "0x" + hex.EncodeToString(sig2)})
	if rec := call(http.MethodPost, "/v1/auth/keys", body2, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("foreign registration: %d %s", rec.Code, rec.Body)
	}

	// After registration: unsigned is refused, signed is served.
	if rec := call(http.MethodGet, "/v1/state?strategy=direction", nil, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("unsigned after registration: %d %s", rec.Code, rec.Body)
	}
	uri := "/v1/state?strategy=direction"
	if rec := call(http.MethodGet, uri, nil, SignRequest(priv, http.MethodGet, uri, nil, time.Now())); rec.Code != http.StatusOK {
		t.Fatalf("signed: %d %s", rec.Code, rec.Body)
	}
	// The signature covers the body.
	closeBody := []byte(`{"symbol":"MON","strategy":"direction"}`)
	hdr := SignRequest(priv, http.MethodPost, "/v1/orders/close", []byte(`{"symbol":"ETH"}`), time.Now())
	if rec := call(http.MethodPost, "/v1/orders/close", closeBody, hdr); rec.Code != http.StatusUnauthorized {
		t.Fatalf("body swapped: %d %s", rec.Code, rec.Body)
	}
	// ...and the path.
	hdr = SignRequest(priv, http.MethodGet, "/v1/trades?symbol=MON", nil, time.Now())
	if rec := call(http.MethodGet, uri, nil, hdr); rec.Code != http.StatusUnauthorized {
		t.Fatalf("path swapped: %d %s", rec.Code, rec.Body)
	}
	// Stale timestamps are refused.
	hdr = SignRequest(priv, http.MethodGet, uri, nil, time.Now().Add(-authSkew-time.Minute))
	if rec := call(http.MethodGet, uri, nil, hdr); rec.Code != http.StatusUnauthorized {
		t.Fatalf("stale: %d %s", rec.Code, rec.Body)
	}
	// An unregistered key, even with a valid signature, is refused.
	_, stranger, _ := ed25519.GenerateKey(nil)
	hdr = SignRequest(stranger, http.MethodGet, uri, nil, time.Now())
	if rec := call(http.MethodGet, uri, nil, hdr); rec.Code != http.StatusUnauthorized {
		t.Fatalf("stranger key: %d %s", rec.Code, rec.Body)
	}
	// Requests without the wallet header are untouched.
	req := httptest.NewRequest(http.MethodGet, "/v1/state", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("platform account: %d", rec.Code)
	}
}

func TestPersonalSignRoundTrip(t *testing.T) {
	k, _ := chain.ParseKey("0x" + strings.Repeat("07", 32))
	msg := []byte("hello, wallet")
	sig := k.SignPersonal(msg)
	got, err := chain.RecoverPersonal(msg, sig)
	if err != nil || got != k.Address {
		t.Fatalf("recovered %x, want %x (%v)", got, k.Address, err)
	}
	if got, _ := chain.RecoverPersonal([]byte("other"), sig); got == k.Address {
		t.Fatal("another message recovered the same signer")
	}
	// v as 0/1 is accepted too, as some wallets send it.
	sig[64] -= 27
	if got, err := chain.RecoverPersonal(msg, sig); err != nil || got != k.Address {
		t.Fatalf("v=0/1: %x %v", got, err)
	}
}
