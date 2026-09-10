package platform

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/chain"
)

// Signed requests (ADR 0005).
//
// A wallet registers a request-signing key once: an Ed25519 public key the
// device derived from the passkey, bound to the wallet by the wallet's own
// signature over RegistrationMessage. From then on every request that names
// the wallet in X-Account-Address also carries the key, a timestamp and an
// Ed25519 signature over what the request is, and the platform serves
// nothing to that wallet without them. A wallet that never registered a
// key is served as before, so the pre-passkey path keeps working.
const (
	AuthKeyHeader  = "X-Auth-Key"
	AuthTimeHeader = "X-Auth-Time"
	AuthSigHeader  = "X-Auth-Signature"
	// authSkew bounds how far a request's timestamp may be from the
	// platform's clock, in either direction.
	authSkew = 5 * time.Minute
	// registrationWindow bounds how old a registration message may be.
	registrationWindow = 10 * time.Minute
)

// AuthKeys is what request authentication needs from storage.
type AuthKeys interface {
	AuthKeys(ctx context.Context, address string) ([][]byte, error)
	PutAuthKey(ctx context.Context, address string, publicKey []byte, at time.Time) error
}

// MemAuthKeys keeps registrations in memory: the store without a database.
type MemAuthKeys struct {
	mu   sync.Mutex
	keys map[string][][]byte
}

func NewMemAuthKeys() *MemAuthKeys { return &MemAuthKeys{keys: make(map[string][][]byte)} }

func (m *MemAuthKeys) AuthKeys(_ context.Context, address string) ([][]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([][]byte(nil), m.keys[strings.ToLower(address)]...), nil
}

func (m *MemAuthKeys) PutAuthKey(_ context.Context, address string, publicKey []byte, _ time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	addr := strings.ToLower(address)
	for _, k := range m.keys[addr] {
		if bytes.Equal(k, publicKey) {
			return nil
		}
	}
	m.keys[addr] = append(m.keys[addr], append([]byte(nil), publicKey...))
	return nil
}

// RegistrationMessage is what the wallet signs to bind a request-signing
// key to itself. The app builds the same text.
func RegistrationMessage(address string, publicKey []byte, issuedAt time.Time) string {
	return "TradeAgent request-signing key\n" +
		"Wallet: " + strings.ToLower(strings.TrimSpace(address)) + "\n" +
		"Key: " + hex.EncodeToString(publicKey) + "\n" +
		"Issued: " + issuedAt.UTC().Format(time.RFC3339)
}

// SigningString is what the request key signs: method, path with query,
// the timestamp header, and the hex SHA-256 of the body, newline-separated.
func SigningString(method, requestURI, authTime string, body []byte) []byte {
	sum := sha256.Sum256(body)
	return []byte(method + "\n" + requestURI + "\n" + authTime + "\n" + hex.EncodeToString(sum[:]))
}

// SignRequest produces the three headers for a request; the app's client
// does the same in TypeScript, and the tests use this.
func SignRequest(priv ed25519.PrivateKey, method, requestURI string, body []byte, now time.Time) http.Header {
	t := strconv.FormatInt(now.Unix(), 10)
	sig := ed25519.Sign(priv, SigningString(method, requestURI, t, body))
	h := http.Header{}
	h.Set(AuthKeyHeader, hex.EncodeToString(priv.Public().(ed25519.PublicKey)))
	h.Set(AuthTimeHeader, t)
	h.Set(AuthSigHeader, hex.EncodeToString(sig))
	return h
}

// authenticator checks signed requests against registered keys. It caches
// each wallet's key list briefly so a poll does not cost a query.
type authenticator struct {
	keys  AuthKeys
	now   func() time.Time
	mu    sync.Mutex
	cache map[string]cachedKeys
}

type cachedKeys struct {
	keys    [][]byte
	expires time.Time
}

const authCacheTTL = 30 * time.Second

func newAuthenticator(keys AuthKeys) *authenticator {
	return &authenticator{keys: keys, now: time.Now, cache: make(map[string]cachedKeys)}
}

func (a *authenticator) keysFor(ctx context.Context, address string) ([][]byte, error) {
	addr := strings.ToLower(address)
	a.mu.Lock()
	c, ok := a.cache[addr]
	a.mu.Unlock()
	if ok && a.now().Before(c.expires) {
		return c.keys, nil
	}
	ks, err := a.keys.AuthKeys(ctx, addr)
	if err != nil {
		return nil, err
	}
	a.mu.Lock()
	a.cache[addr] = cachedKeys{keys: ks, expires: a.now().Add(authCacheTTL)}
	a.mu.Unlock()
	return ks, nil
}

func (a *authenticator) forget(address string) {
	a.mu.Lock()
	delete(a.cache, strings.ToLower(address))
	a.mu.Unlock()
}

var errUnauthenticated = errors.New("unauthenticated")

// verify checks one request for a wallet with registered keys. It reads the
// body and puts it back for the handler.
func (a *authenticator) verify(r *http.Request, registered [][]byte) error {
	keyHex := strings.TrimSpace(r.Header.Get(AuthKeyHeader))
	timeStr := strings.TrimSpace(r.Header.Get(AuthTimeHeader))
	sigHex := strings.TrimSpace(r.Header.Get(AuthSigHeader))
	if keyHex == "" || timeStr == "" || sigHex == "" {
		return fmt.Errorf("%w: this wallet requires signed requests", errUnauthenticated)
	}
	pub, err := hex.DecodeString(strings.TrimPrefix(keyHex, "0x"))
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return fmt.Errorf("%w: bad %s", errUnauthenticated, AuthKeyHeader)
	}
	known := false
	for _, k := range registered {
		if bytes.Equal(k, pub) {
			known = true
			break
		}
	}
	if !known {
		return fmt.Errorf("%w: this key is not registered for the wallet", errUnauthenticated)
	}
	ts, err := strconv.ParseInt(timeStr, 10, 64)
	if err != nil {
		return fmt.Errorf("%w: bad %s", errUnauthenticated, AuthTimeHeader)
	}
	if d := a.now().Sub(time.Unix(ts, 0)); d > authSkew || d < -authSkew {
		return fmt.Errorf("%w: request time is off by more than %s", errUnauthenticated, authSkew)
	}
	sig, err := hex.DecodeString(strings.TrimPrefix(sigHex, "0x"))
	if err != nil || len(sig) != ed25519.SignatureSize {
		return fmt.Errorf("%w: bad %s", errUnauthenticated, AuthSigHeader)
	}
	var body []byte
	if r.Body != nil {
		body, err = io.ReadAll(io.LimitReader(r.Body, maxBody+1))
		if err != nil {
			return fmt.Errorf("%w: cannot read body", errUnauthenticated)
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
	}
	if !ed25519.Verify(ed25519.PublicKey(pub), SigningString(r.Method, r.URL.RequestURI(), timeStr, body), sig) {
		return fmt.Errorf("%w: signature does not match the request", errUnauthenticated)
	}
	return nil
}

// middleware enforces signatures for wallets that registered a key.
func (a *authenticator) middleware(next http.Handler, log interface {
	Warn(string, ...any)
}) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		addr := strings.TrimSpace(r.Header.Get(AccountHeader))
		if addr == "" || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		registered, err := a.keysFor(r.Context(), addr)
		if err != nil {
			log.Warn("auth keys unavailable", "wallet", addr, "err", err)
			writeJSON(w, http.StatusServiceUnavailable, errorDTO{Error: "internal", Message: "cannot check request signature"})
			return
		}
		if len(registered) == 0 {
			next.ServeHTTP(w, r)
			return
		}
		if err := a.verify(r, registered); err != nil {
			writeJSON(w, http.StatusUnauthorized, errorDTO{Error: "unauthenticated", Message: err.Error()})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// --- registration ---

type registerAuthKeyDTO struct {
	Address   string `json:"address"`
	PublicKey string `json:"public_key"`
	IssuedAt  string `json:"issued_at"`
	Signature string `json:"signature"`
}

// registerAuthKey binds a request-signing key to a wallet: the wallet's
// EIP-191 signature over RegistrationMessage must recover to the address.
func (h *handler) registerAuthKey(w http.ResponseWriter, r *http.Request) {
	var in registerAuthKeyDTO
	if err := decode(r, &in); err != nil {
		h.fail(w, err)
		return
	}
	address := strings.ToLower(strings.TrimSpace(in.Address))
	if !isAddress(address) {
		h.fail(w, fmt.Errorf("%w: address must be 0x followed by 40 hex characters", ErrInvalid))
		return
	}
	pub, err := hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(in.PublicKey), "0x"))
	if err != nil || len(pub) != ed25519.PublicKeySize {
		h.fail(w, fmt.Errorf("%w: public_key must be %d bytes of hex", ErrInvalid, ed25519.PublicKeySize))
		return
	}
	issued, err := time.Parse(time.RFC3339, strings.TrimSpace(in.IssuedAt))
	if err != nil {
		h.fail(w, fmt.Errorf("%w: issued_at must be RFC 3339", ErrInvalid))
		return
	}
	if d := h.auth.now().Sub(issued); d > registrationWindow || d < -registrationWindow {
		h.fail(w, fmt.Errorf("%w: registration is older than %s", ErrInvalid, registrationWindow))
		return
	}
	sig, err := hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(in.Signature), "0x"))
	if err != nil || len(sig) != 65 {
		h.fail(w, fmt.Errorf("%w: signature must be 65 bytes of hex", ErrInvalid))
		return
	}
	signer, err := chain.RecoverPersonal([]byte(RegistrationMessage(address, pub, issued)), sig)
	if err != nil || "0x"+hex.EncodeToString(signer[:]) != address {
		writeJSON(w, http.StatusUnauthorized, errorDTO{Error: "unauthenticated", Message: "the signature was not made by this wallet"})
		return
	}
	if err := h.auth.keys.PutAuthKey(r.Context(), address, pub, h.auth.now()); err != nil {
		h.fail(w, err)
		return
	}
	h.auth.forget(address)
	h.log.Info("request-signing key registered", "wallet", address)
	writeJSON(w, http.StatusOK, map[string]any{"address": address, "public_key": "0x" + hex.EncodeToString(pub)})
}
