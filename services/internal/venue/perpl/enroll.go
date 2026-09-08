package perpl

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
)

// API-key enrollment: the two-step flow that lets our integration create a
// trading key for a user's wallet, and — the reason it matters to us — bind
// that key to our builder code. A builder_id cannot be attached to a key
// after the fact, so every key that should earn a builder fee is born here.
//
// Step 1 (payload) needs no signature and is where the server validates the
// builder code and the Origin. Step 2 (enroll) needs the user's wallet
// signature over the EIP-712 payload plus an Ed25519 proof-of-possession by
// the new key. The wallet signature is the user's; this package never holds
// a wallet key.

// Scope bits for an API key. Trade implies read.
const (
	ScopeRead  = 1
	ScopeTrade = 2
)

// EnrollmentRequest describes the key to create.
type EnrollmentRequest struct {
	// Address is the signing wallet — the owner (or operator) of the account.
	Address string
	// PublicKey is the new key's Ed25519 public key, raw 32 bytes.
	PublicKey ed25519.PublicKey
	ScopeMask int
	Label     string
	// ExpiresAt is unix milliseconds; zero means never.
	ExpiresAt int64
	// BuilderID and MaxBuilderFeePer100K bind the key to our code with the fee
	// ceiling the user is asked to sign for. Both zero: an ordinary key.
	BuilderID            int
	MaxBuilderFeePer100K int
}

// EnrollmentPayload is what the user's wallet must sign, verbatim.
type EnrollmentPayload struct {
	// TypedData is the EIP-712 document. Sign it exactly as returned.
	TypedData json.RawMessage `json:"typed_data"`
	// MAC is opaque; echo it back unchanged on enroll.
	MAC string `json:"mac"`
}

// Statement returns the human-readable statement inside the typed data, which
// is what the user actually reads in the wallet prompt: our builder name and
// the fee ceiling in prose. Empty when the payload carries none.
func (p EnrollmentPayload) Statement() string {
	var doc struct {
		Message struct {
			Statement string `json:"statement"`
		} `json:"message"`
	}
	_ = json.Unmarshal(p.TypedData, &doc)
	return doc.Message.Statement
}

// BuilderTerms returns the machine-enforced builder fields from the typed
// data, so a caller can confirm the server bound the code it asked for.
func (p EnrollmentPayload) BuilderTerms() (builderID, maxFeePer100K int, ok bool) {
	var doc struct {
		Message struct {
			BuilderID         json.Number `json:"builderId"`
			MaxBuilderFee100K json.Number `json:"maxBuilderFeePer100K"`
		} `json:"message"`
	}
	if err := json.Unmarshal(p.TypedData, &doc); err != nil {
		return 0, 0, false
	}
	id, err1 := doc.Message.BuilderID.Int64()
	fee, err2 := doc.Message.MaxBuilderFee100K.Int64()
	if err1 != nil || err2 != nil {
		return 0, 0, false
	}
	return int(id), int(fee), true
}

// APIKeyInfo is the enrolled key as the server describes it.
type APIKeyInfo struct {
	APIKey               string   `json:"api_key"`
	Address              string   `json:"address"`
	ScopeMask            int      `json:"scope_mask"`
	Label                string   `json:"label"`
	IPCIDRs              []string `json:"ip_cidrs"`
	Origin               string   `json:"origin"`
	ExpiresAt            int64    `json:"expires_at"`
	CreatedAt            int64    `json:"created_at"`
	BuilderID            int      `json:"builder_id,omitempty"`
	BuilderName          string   `json:"builder_name,omitempty"`
	MaxBuilderFeePer100K int      `json:"max_builder_fee_per_100k,omitempty"`
	MaxBuilderFeePct     string   `json:"max_builder_fee_pct,omitempty"`
}

// enrollHeaders sends the Origin only when one is configured. Measured on
// 2026-09-09: the server accepts a request with no Origin at all (the
// server-side path) and rejects an Origin that is not on its whitelist with a
// bare 400 before the request reaches the application. A browser cannot omit
// the header, so the app's origin still has to be whitelisted for the
// client-side path.
func (a *Adapter) enrollHeaders() map[string]string {
	if a.cfg.EnrollOrigin == "" {
		return nil
	}
	return map[string]string{"Origin": a.cfg.EnrollOrigin}
}

// EnrollmentPayload asks the server for the EIP-712 document the user's wallet
// must sign. This is also the cheapest way to verify a builder code: the
// server rejects an unregistered code, an out-of-range fee ceiling and an
// unlisted Origin here, before any signature exists.
func (a *Adapter) EnrollmentPayload(ctx context.Context, req EnrollmentRequest) (EnrollmentPayload, error) {
	if len(req.PublicKey) != ed25519.PublicKeySize {
		return EnrollmentPayload{}, fmt.Errorf("perpl: public key must be %d bytes", ed25519.PublicKeySize)
	}
	if req.Address == "" || req.Label == "" {
		return EnrollmentPayload{}, errors.New("perpl: enrollment needs a wallet address and a label")
	}

	body := map[string]any{
		"chain_id":   a.cfg.Network.ChainID,
		"address":    req.Address,
		"public_key": "0x" + hex.EncodeToString(req.PublicKey),
		"scope_mask": req.ScopeMask,
		"label":      req.Label,
	}
	if req.ExpiresAt > 0 {
		body["expires_at"] = req.ExpiresAt
	}
	if req.BuilderID > 0 {
		body["builder_id"] = req.BuilderID
		body["max_builder_fee_per_100k"] = req.MaxBuilderFeePer100K
	}

	var out EnrollmentPayload
	err := a.rest.post(ctx, "/v1/api-key/payload", body, a.enrollHeaders(), &out)
	if err != nil {
		return EnrollmentPayload{}, err
	}
	if len(out.TypedData) == 0 || out.MAC == "" {
		return EnrollmentPayload{}, errors.New("perpl: payload response is missing typed_data or mac")
	}
	return out, nil
}

// Enroll submits the signed payload and returns the key. walletSignature is
// the user's EIP-712 signature (0x-hex); popSignature is the Ed25519 signature
// by the new key over the EIP-712 digest (0x-hex).
func (a *Adapter) Enroll(ctx context.Context, address string, payload EnrollmentPayload, walletSignature, popSignature string) (APIKeyInfo, error) {
	body := map[string]any{
		"chain_id":      a.cfg.Network.ChainID,
		"address":       address,
		"typed_data":    payload.TypedData,
		"mac":           payload.MAC,
		"signature":     walletSignature,
		"pop_signature": popSignature,
	}
	var out struct {
		APIKey APIKeyInfo `json:"api_key"`
	}
	if err := a.rest.post(ctx, "/v1/api-key/enroll", body, a.enrollHeaders(), &out); err != nil {
		return APIKeyInfo{}, err
	}
	if out.APIKey.APIKey == "" {
		return APIKeyInfo{}, errors.New("perpl: enroll response carries no api_key")
	}
	return out.APIKey, nil
}

// NewAPIKeyPair generates the Ed25519 key pair for a new API key. The private
// key is the caller's to keep; the server only ever sees the public half.
func NewAPIKeyPair() (ed25519.PublicKey, ed25519.PrivateKey, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, fmt.Errorf("perpl: generate api key: %w", err)
	}
	return pub, priv, nil
}
