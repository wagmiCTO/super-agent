package platform

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/eip712"
	"github.com/wagmiCTO/super-agent/services/internal/keys"
	"github.com/wagmiCTO/super-agent/services/internal/venue/perpl"
)

// Enroller is the part of the venue adapter that enrollment needs, narrowed
// so tests can substitute a fake without a network.
type Enroller interface {
	EnrollmentPayload(ctx context.Context, req perpl.EnrollmentRequest) (perpl.EnrollmentPayload, error)
	Enroll(ctx context.Context, address string, payload perpl.EnrollmentPayload, walletSignature, popSignature string) (perpl.APIKeyInfo, error)
}

// Enrollment creates exchange API keys for user wallets, bound to our builder
// code, and keeps them so the platform can trade for those wallets.
//
// Two steps, mirroring the venue's flow:
//
//  1. Payload: generate an Ed25519 pair, ask the venue for the EIP-712 document
//     that binds that public key to the wallet and to our builder terms, and
//     hold the pair until the wallet signs.
//  2. Enroll: compute the digest the wallet signed, sign the same digest with
//     the Ed25519 key as proof of possession, submit both, store the key.
//
// The wallet signature is the user's consent to the builder fee, in prose they
// read in the passkey prompt. The platform never holds a wallet key.
type Enrollment struct {
	venue     Enroller
	store     *keys.Store
	builderID int
	maxFee    int
	log       *slog.Logger
}

// NewEnrollment wires enrollment for one builder code. maxFeePer100K is the
// ceiling every key is enrolled with: 1 = 0.1 bps, at most 100.
func NewEnrollment(v Enroller, store *keys.Store, builderID, maxFeePer100K int, log *slog.Logger) (*Enrollment, error) {
	if builderID < 1 || builderID > 255 {
		return nil, fmt.Errorf("platform: builder id %d out of range 1..255", builderID)
	}
	if maxFeePer100K < 0 || maxFeePer100K > 100 {
		return nil, fmt.Errorf("platform: max builder fee %d out of range 0..100", maxFeePer100K)
	}
	if log == nil {
		log = slog.Default()
	}
	return &Enrollment{venue: v, store: store, builderID: builderID, maxFee: maxFeePer100K, log: log}, nil
}

// PayloadResult is what the app needs to ask the wallet for a signature.
type PayloadResult struct {
	Handle    string
	TypedData []byte
	Statement string
	BuilderID int
	MaxFee    int
	ExpiresAt time.Time
}

// Payload runs step one for a wallet address.
func (e *Enrollment) Payload(ctx context.Context, address, label string) (PayloadResult, error) {
	address = strings.TrimSpace(address)
	if !isAddress(address) {
		return PayloadResult{}, fmt.Errorf("%w: address must be 0x followed by 40 hex characters", ErrInvalid)
	}
	if label = strings.TrimSpace(label); label == "" {
		label = "TradeAgent"
	}
	pending, err := e.store.PreparePending(address, label, e.builderID, e.maxFee)
	if err != nil {
		return PayloadResult{}, err
	}
	payload, err := e.venue.EnrollmentPayload(ctx, perpl.EnrollmentRequest{
		Address:              address,
		PublicKey:            pending.PublicKey,
		ScopeMask:            perpl.ScopeRead | perpl.ScopeTrade,
		Label:                label,
		BuilderID:            e.builderID,
		MaxBuilderFeePer100K: e.maxFee,
	})
	if err != nil {
		return PayloadResult{}, err
	}
	// Refuse to hand the wallet a document that does not carry our terms:
	// signing it would enroll a key that earns nothing and cannot be fixed.
	if id, fee, ok := payload.BuilderTerms(); !ok || id != e.builderID || fee != e.maxFee {
		return PayloadResult{}, fmt.Errorf("platform: venue returned builder terms %d/%d, expected %d/%d", id, fee, e.builderID, e.maxFee)
	}
	pending.TypedData = payload.TypedData
	pending.MAC = payload.MAC
	e.store.Register(pending)
	return PayloadResult{
		Handle:    pending.Handle,
		TypedData: payload.TypedData,
		Statement: payload.Statement(),
		BuilderID: e.builderID,
		MaxFee:    e.maxFee,
		ExpiresAt: pending.ExpiresAt,
	}, nil
}

// Enroll runs step two: walletSignature is the EIP-712 signature (0x-hex)
// over the payload from Payload, made by the wallet the payload names.
func (e *Enrollment) Enroll(ctx context.Context, handle, walletSignature string) (keys.Key, error) {
	walletSignature = strings.TrimSpace(walletSignature)
	if !strings.HasPrefix(walletSignature, "0x") || len(walletSignature) != 132 {
		return keys.Key{}, fmt.Errorf("%w: signature must be 0x-hex, 65 bytes", ErrInvalid)
	}
	pending, err := e.store.TakePending(handle)
	if err != nil {
		return keys.Key{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}

	td, err := eip712.Parse(pending.TypedData)
	if err != nil {
		return keys.Key{}, err
	}
	digest, err := eip712.Digest(td, eip712.Keccak256)
	if err != nil {
		return keys.Key{}, err
	}
	pop := ed25519.Sign(pending.PrivateKey, digest[:])
	popHex := "0x" + hex.EncodeToString(pop)

	info, err := e.venue.Enroll(ctx, pending.Address,
		perpl.EnrollmentPayload{TypedData: pending.TypedData, MAC: pending.MAC},
		walletSignature, popHex)
	if err != nil {
		return keys.Key{}, err
	}
	if info.BuilderID != e.builderID {
		// The venue re-derives the terms; a mismatch here means the key is
		// live but not ours. Keep it usable, but say so loudly.
		e.log.Error("enrolled key carries unexpected builder terms", "address", pending.Address, "builder", info.BuilderID)
	}
	k := keys.Key{
		Address:              pending.Address,
		APIKey:               info.APIKey,
		PrivateKey:           pending.PrivateKey,
		Label:                info.Label,
		BuilderID:            info.BuilderID,
		MaxBuilderFeePer100K: info.MaxBuilderFeePer100K,
		MaxBuilderFeePct:     info.MaxBuilderFeePct,
		EnrolledAt:           time.Now(),
	}
	e.store.Put(k)
	e.log.Info("api key enrolled", "address", k.Address, "label", k.Label, "builder", k.BuilderID, "max_fee_per_100k", k.MaxBuilderFeePer100K)
	return k, nil
}

// Key returns the enrolled key for an address, or keys.ErrNotFound.
func (e *Enrollment) Key(address string) (keys.Key, error) { return e.store.Get(address) }

func isAddress(s string) bool {
	if len(s) != 42 || !strings.HasPrefix(s, "0x") {
		return false
	}
	_, err := hex.DecodeString(s[2:])
	return err == nil
}

var errNoBuilder = errors.New("platform: enrollment is not configured: set PERPL_BUILDER_ID")
