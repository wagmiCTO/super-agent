package perpl

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// signer holds the enrolled API key and signs the two canonical strings Perpl
// defines: one for REST requests, one for the trading WebSocket sign-in frame.
//
// Both are newline-joined field lists. Every field is byte-exact — the
// request-target in particular must match what the server receives, query
// string included — so the canonical strings are built here and nowhere else.
type signer struct {
	apiKey  string
	key     ed25519.PrivateKey
	chainID int64
	// now and nonce are injectable so the canonical strings can be tested
	// against fixed values.
	now   func() time.Time
	nonce func() (string, error)
}

func newSigner(apiKey, secretHex string, chainID int64) (*signer, error) {
	raw, err := hex.DecodeString(strings.TrimPrefix(secretHex, "0x"))
	if err != nil {
		return nil, fmt.Errorf("perpl: api key secret is not hex: %w", err)
	}
	var key ed25519.PrivateKey
	switch len(raw) {
	case ed25519.SeedSize:
		key = ed25519.NewKeyFromSeed(raw)
	case ed25519.PrivateKeySize:
		key = ed25519.PrivateKey(raw)
	default:
		return nil, fmt.Errorf("perpl: api key secret is %d bytes, want %d (seed) or %d (full key)",
			len(raw), ed25519.SeedSize, ed25519.PrivateKeySize)
	}
	return &signer{apiKey: apiKey, key: key, chainID: chainID, now: time.Now, nonce: randomNonce}, nil
}

// restCanonical builds the six-field canonical string for a REST request.
//
//	<chain_id>\n<METHOD>\n<request-target>\n<timestamp_ms>\n<nonce>\n<sha256(body) hex>
//
// target is the path with its query string exactly as sent, e.g.
// "/v1/trading/fills?count=1". An empty body hashes to the SHA-256 of "".
func restCanonical(chainID int64, method, target, timestamp, nonce string, body []byte) string {
	sum := sha256.Sum256(body)
	return strings.Join([]string{
		strconv.FormatInt(chainID, 10),
		method,
		target,
		timestamp,
		nonce,
		hex.EncodeToString(sum[:]),
	}, "\n")
}

// wsCanonical builds the four-field canonical string for the trading WebSocket
// sign-in frame.
//
//	<chain_id>\ntrading-ws-signin\n<timestamp_ms>\n<nonce>
func wsCanonical(chainID int64, timestamp, nonce string) string {
	return strings.Join([]string{
		strconv.FormatInt(chainID, 10),
		wsSignInTag,
		timestamp,
		nonce,
	}, "\n")
}

const wsSignInTag = "trading-ws-signin"

// restHeaders returns the four X-API-* headers for a request. The timestamp
// must be within 30 seconds of server time and each nonce is single-use, so
// headers are built per attempt — a retry re-signs rather than replaying.
func (s *signer) restHeaders(method, target string, body []byte) (map[string]string, error) {
	ts, nonce, err := s.stamp()
	if err != nil {
		return nil, err
	}
	sig := ed25519.Sign(s.key, []byte(restCanonical(s.chainID, method, target, ts, nonce, body)))
	return map[string]string{
		"X-API-Key":       s.apiKey,
		"X-API-Timestamp": ts,
		"X-API-Nonce":     nonce,
		"X-API-Signature": base64.RawURLEncoding.EncodeToString(sig),
	}, nil
}

// signInFrame builds the mt:29 frame that must be the first message on the
// trading socket, within the server's idle timeout.
func (s *signer) signInFrame() (apiKeySignIn, error) {
	ts, nonce, err := s.stamp()
	if err != nil {
		return apiKeySignIn{}, err
	}
	sig := ed25519.Sign(s.key, []byte(wsCanonical(s.chainID, ts, nonce)))
	return apiKeySignIn{
		MsgType:   msgAPIKeySignIn,
		ChainID:   s.chainID,
		APIKey:    s.apiKey,
		Timestamp: ts,
		Nonce:     nonce,
		Signature: base64.RawURLEncoding.EncodeToString(sig),
	}, nil
}

func (s *signer) stamp() (timestamp, nonce string, err error) {
	nonce, err = s.nonce()
	if err != nil {
		return "", "", err
	}
	return strconv.FormatInt(s.now().UnixMilli(), 10), nonce, nil
}

// randomNonce returns 16 random bytes as unpadded base64url, as the reference
// clients do.
func randomNonce() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("perpl: nonce: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}
