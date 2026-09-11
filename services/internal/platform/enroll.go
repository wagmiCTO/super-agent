package platform

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/eip712"
	"github.com/wagmiCTO/super-agent/services/internal/keys"
	"github.com/wagmiCTO/super-agent/services/internal/strategy"
	"github.com/wagmiCTO/super-agent/services/internal/venue/perpl"
)

// Enroller is the part of the venue adapter that enrollment needs, narrowed
// so tests can substitute a fake without a network.
type Enroller interface {
	WalletAuthPayload(ctx context.Context, address string) (perpl.AuthPayload, error)
	WalletAuthConnect(ctx context.Context, address string, payload perpl.AuthPayload, signature, refCode string) (perpl.AuthSession, error)
	EnrollmentPayload(ctx context.Context, req perpl.EnrollmentRequest) (perpl.EnrollmentPayload, error)
	Enroll(ctx context.Context, address string, payload perpl.EnrollmentPayload, walletSignature, popSignature string) (perpl.APIKeyInfo, error)
	Activation(ctx context.Context) (perpl.Activation, error)
}

// Enrollment creates exchange API keys for user wallets, bound to our builder
// code, and keeps them so the platform can trade for those wallets.
//
// Two round trips with the app, three with the venue:
//
//  1. Payload: generate an Ed25519 pair; ask the venue for the wallet's
//     sign-in message and for the EIP-712 document that binds the new public
//     key to the wallet and to our builder terms. Hand both to the app.
//  2. Enroll: the wallet has signed both. Sign the wallet in first — a
//     first sign-in is what creates its profile at the venue, and enrollment
//     is refused without one — then compute the EIP-712 digest, sign it with
//     the Ed25519 key as proof of possession, submit, store the key.
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

// Activation tells the app where and how a wallet opens its exchange account
// on-chain. The platform only relays the venue's configuration; the
// transactions are the wallet's own.
func (e *Enrollment) Activation(ctx context.Context) (perpl.Activation, error) {
	return e.venue.Activation(ctx)
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

// PayloadRequest is step one's input. Strategy names the strategy the key
// will trade for ("" is a wallet-wide key from before per-strategy keys);
// PublicKey is the key the device derived for it, or nil to have the
// platform generate one.
type PayloadRequest struct {
	Address   string
	Strategy  string
	Label     string
	PublicKey ed25519.PublicKey
}

// PayloadResult is what the app needs to ask the wallet for its signatures.
type PayloadResult struct {
	Handle   string
	Strategy string
	// PublicKey is the key being enrolled, 0x-hex.
	PublicKey string
	// SignInMessage is signed as a personal message (EIP-191).
	SignInMessage string
	// TypedData is signed as EIP-712.
	TypedData []byte
	Statement string
	BuilderID int
	MaxFee    int
	ExpiresAt time.Time
}

// Payload runs step one for a wallet address.
func (e *Enrollment) Payload(ctx context.Context, req PayloadRequest) (PayloadResult, error) {
	address := strings.TrimSpace(req.Address)
	if !isAddress(address) {
		return PayloadResult{}, fmt.Errorf("%w: address must be 0x followed by 40 hex characters", ErrInvalid)
	}
	label := strings.TrimSpace(req.Label)
	strategyID := strings.TrimSpace(req.Strategy)
	if strategyID != "" {
		info, ok := strategy.Lookup(strategyID)
		if !ok {
			return PayloadResult{}, fmt.Errorf("%w: unknown strategy %q", ErrInvalid, strategyID)
		}
		// The label is what the user sees on the venue's key page: name
		// the strategy so revoking one is an informed act.
		label = "TradeAgent · " + info.Name
	} else if label == "" {
		label = "TradeAgent"
	}
	if len(req.PublicKey) > 0 && len(req.PublicKey) != ed25519.PublicKeySize {
		return PayloadResult{}, fmt.Errorf("%w: public key must be %d bytes", ErrInvalid, ed25519.PublicKeySize)
	}
	pending, err := e.store.PreparePending(keys.PendingRequest{Address: address, Strategy: strategyID, Label: label, BuilderID: e.builderID, MaxFee: e.maxFee, PublicKey: req.PublicKey})
	if err != nil {
		return PayloadResult{}, err
	}
	auth, err := e.venue.WalletAuthPayload(ctx, address)
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
	pending.Salt = documentSalt(payload.TypedData)
	pending.Auth = auth
	e.store.Register(pending)
	// The venue refuses a document whose salt was reused or superseded by a
	// newer one for the same address (their diagnosis, 11 Sep 2026); every
	// salt handed out is logged so a refusal can be traced.
	e.log.Info("enroll payload issued", "address", pending.Address, "strategy", pending.Strategy, "salt", pending.Salt, "handle", pending.Handle)
	return PayloadResult{
		Handle:        pending.Handle,
		Strategy:      pending.Strategy,
		PublicKey:     "0x" + hex.EncodeToString(pending.PublicKey),
		SignInMessage: auth.Message,
		TypedData:     payload.TypedData,
		Statement:     payload.Statement(),
		BuilderID:     e.builderID,
		MaxFee:        e.maxFee,
		ExpiresAt:     pending.ExpiresAt,
	}, nil
}

// Enroll runs step two. signInSignature is the wallet's EIP-191 signature over
// the sign-in message; walletSignature is its EIP-712 signature over the
// typed data. Both 0x-hex, 65 bytes. privateKey is the device-derived key's
// 32-byte seed, 0x-hex, required for a derived enrollment and refused for a
// platform-generated one.
func (e *Enrollment) Enroll(ctx context.Context, handle, signInSignature, walletSignature, privateKey string) (keys.Key, error) {
	signInSignature = strings.TrimSpace(signInSignature)
	walletSignature = strings.TrimSpace(walletSignature)
	for _, sig := range []string{signInSignature, walletSignature} {
		if !strings.HasPrefix(sig, "0x") || len(sig) != 132 {
			return keys.Key{}, fmt.Errorf("%w: signatures must be 0x-hex, 65 bytes", ErrInvalid)
		}
	}
	pending, err := e.store.TakePending(handle)
	if err != nil {
		return keys.Key{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	privateKey = strings.TrimSpace(privateKey)
	switch {
	case pending.Derived && privateKey == "":
		return keys.Key{}, fmt.Errorf("%w: a derived key needs its private key to complete enrollment", ErrInvalid)
	case !pending.Derived && privateKey != "":
		return keys.Key{}, fmt.Errorf("%w: this enrollment's key was generated by the platform", ErrInvalid)
	case pending.Derived:
		seed, err := hex.DecodeString(strings.TrimPrefix(privateKey, "0x"))
		if err != nil || len(seed) != ed25519.SeedSize {
			return keys.Key{}, fmt.Errorf("%w: private key must be %d bytes of hex", ErrInvalid, ed25519.SeedSize)
		}
		priv := ed25519.NewKeyFromSeed(seed)
		if !priv.Public().(ed25519.PublicKey).Equal(pending.PublicKey) {
			return keys.Key{}, fmt.Errorf("%w: private key does not match the enrolled public key", ErrInvalid)
		}
		pending.PrivateKey = priv
	}

	// Sign the wallet in. The first time, this creates its profile at the
	// venue; without one, enrollment below is refused with 404.
	if _, err := e.venue.WalletAuthConnect(ctx, pending.Address, pending.Auth, signInSignature, ""); err != nil {
		return keys.Key{}, err
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

	// A profile created by the sign-in a moment ago is not always visible to
	// enrollment immediately: the venue has been seen to answer 400 within
	// the first second and 200 on a retry. Give it a few short attempts.
	var info perpl.APIKeyInfo
	for attempt := 1; ; attempt++ {
		info, err = e.venue.Enroll(ctx, pending.Address,
			perpl.EnrollmentPayload{TypedData: pending.TypedData, MAC: pending.MAC},
			walletSignature, popHex)
		if err == nil {
			break
		}
		if attempt >= enrollAttempts || !isVenueRefusal(err) {
			e.log.Warn("enroll refused", "address", pending.Address, "salt", pending.Salt, "attempt", attempt, "err", err)
			return keys.Key{}, err
		}
		e.log.Info("enroll refused, retrying", "address", pending.Address, "attempt", attempt, "err", err)
		select {
		case <-ctx.Done():
			return keys.Key{}, ctx.Err()
		case <-time.After(enrollRetryDelay << uint(attempt-1)):
		}
	}
	if info.BuilderID != e.builderID {
		// The venue re-derives the terms; a mismatch here means the key is
		// live but not ours. Keep it usable, but say so loudly.
		e.log.Error("enrolled key carries unexpected builder terms", "address", pending.Address, "builder", info.BuilderID)
	}
	k := keys.Key{
		Address:              pending.Address,
		Strategy:             pending.Strategy,
		Derived:              pending.Derived,
		APIKey:               info.APIKey,
		PrivateKey:           pending.PrivateKey,
		Label:                info.Label,
		BuilderID:            info.BuilderID,
		MaxBuilderFeePer100K: info.MaxBuilderFeePer100K,
		MaxBuilderFeePct:     info.MaxBuilderFeePct,
		EnrolledAt:           time.Now(),
	}
	if err := e.store.Put(k); err != nil {
		// The key is live at the venue and usable in memory; losing the
		// mirror is worth a loud log, not a failed enrollment.
		e.log.Error("enrolled key not persisted", "address", k.Address, "err", err)
	}
	e.log.Info("api key enrolled", "address", k.Address, "strategy", k.Strategy, "salt", pending.Salt, "derived", k.Derived, "label", k.Label, "builder", k.BuilderID, "max_fee_per_100k", k.MaxBuilderFeePer100K)
	return k, nil
}

// Key returns the key enrolled for a wallet and strategy, or keys.ErrNotFound.
func (e *Enrollment) Key(address, strategyID string) (keys.Key, error) {
	return e.store.Get(address, strategyID)
}

// Keys lists a wallet's enrolled keys.
func (e *Enrollment) Keys(address string) []keys.Key { return e.store.ForWallet(address) }

// documentSalt reads the salt from an EIP-712 document — the venue puts it
// in the domain; the message is checked too — or "" if absent.
func documentSalt(typedData []byte) string {
	var doc struct {
		Domain struct {
			Salt string `json:"salt"`
		} `json:"domain"`
		Message struct {
			Salt string `json:"salt"`
		} `json:"message"`
	}
	if err := json.Unmarshal(typedData, &doc); err != nil {
		return ""
	}
	if doc.Domain.Salt != "" {
		return doc.Domain.Salt
	}
	return doc.Message.Salt
}

func isAddress(s string) bool {
	if len(s) != 42 || !strings.HasPrefix(s, "0x") {
		return false
	}
	_, err := hex.DecodeString(s[2:])
	return err == nil
}

const (
	// The venue's refusal of a document is deterministic (measured 10 Sep
	// 2026: the same body is refused every time, a fresh payload is an
	// independent draw), so the server does not retry; the app asks for a
	// new payload instead.
	enrollAttempts   = 1
	enrollRetryDelay = time.Second
)

// isVenueRefusal reports a 4xx from the venue's REST API, the only failure a
// retry can help with here.
func isVenueRefusal(err error) bool {
	return err != nil && strings.Contains(err.Error(), ": HTTP 4")
}

var errNoBuilder = errors.New("platform: enrollment is not configured: set PERPL_BUILDER_ID")
