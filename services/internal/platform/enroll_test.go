package platform

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/wagmiCTO/super-agent/services/internal/eip712"
	"github.com/wagmiCTO/super-agent/services/internal/keys"
	"github.com/wagmiCTO/super-agent/services/internal/venue/perpl"
)

// fakeEnroller plays the venue: it hands back a real payload (the fixture the
// EIP-712 tests use) and, on enroll, verifies the proof-of-possession the way
// the venue would — Ed25519 over the EIP-712 digest, by the enrolled key.
type fakeEnroller struct {
	t         *testing.T
	typedData []byte
	builderID int
	maxFee    int
	// captured
	connected  []string
	payloadReq perpl.EnrollmentRequest
	enrolled   *perpl.APIKeyInfo
	popOK      bool
	failEnroll error
}

func (f *fakeEnroller) WalletAuthPayload(_ context.Context, address string) (perpl.AuthPayload, error) {
	return perpl.AuthPayload{Message: "perpl wants you to sign in: " + address, Nonce: "n", IssuedAt: 1, MAC: "m"}, nil
}

func (f *fakeEnroller) WalletAuthConnect(_ context.Context, address string, p perpl.AuthPayload, sig, ref string) (perpl.AuthSession, error) {
	f.connected = append(f.connected, address)
	return perpl.AuthSession{Profiles: []string{address}}, nil
}

func (f *fakeEnroller) EnrollmentPayload(_ context.Context, req perpl.EnrollmentRequest) (perpl.EnrollmentPayload, error) {
	f.payloadReq = req
	// Rewrite the fixture's builder terms to whatever this fake advertises.
	var doc map[string]any
	if err := json.Unmarshal(f.typedData, &doc); err != nil {
		f.t.Fatal(err)
	}
	msg := doc["message"].(map[string]any)
	// The venue types these as strings, not numbers.
	msg["builderId"] = itoa(f.builderID)
	msg["maxBuilderFeePer100K"] = itoa(f.maxFee)
	raw, _ := json.Marshal(doc)
	return perpl.EnrollmentPayload{TypedData: raw, MAC: "mac-1"}, nil
}

func (f *fakeEnroller) Activation(context.Context) (perpl.Activation, error) {
	return perpl.Activation{
		Network: "testnet", ChainID: 10143, RPCURL: "https://testnet-rpc.monad.xyz", Explorer: "https://testnet.monadscan.com/",
		ExchangeAddress: "0x1964c32f0be608e7d29302aff5e61268e72080cc", CollateralToken: "0xa9012a055bd4e0edff8ce09f960291c09d5322dc",
		CollateralSymbol: "AUSD", CollateralDecimals: 6, MinAccountOpenAmount: "100000000",
	}, nil
}

func (f *fakeEnroller) Enroll(_ context.Context, address string, payload perpl.EnrollmentPayload, walletSig, popSig string) (perpl.APIKeyInfo, error) {
	if f.failEnroll != nil {
		return perpl.APIKeyInfo{}, f.failEnroll
	}
	td, err := eip712.Parse(payload.TypedData)
	if err != nil {
		f.t.Fatal(err)
	}
	digest, err := eip712.Digest(td, eip712.Keccak256)
	if err != nil {
		f.t.Fatal(err)
	}
	sig, err := hex.DecodeString(strings.TrimPrefix(popSig, "0x"))
	if err != nil {
		f.t.Fatalf("pop is not hex: %v", err)
	}
	f.popOK = ed25519.Verify(f.payloadReq.PublicKey, digest[:], sig)
	info := perpl.APIKeyInfo{
		APIKey:               "pk_enrolled",
		Address:              address,
		ScopeMask:            3,
		Label:                f.payloadReq.Label,
		BuilderID:            f.builderID,
		MaxBuilderFeePer100K: f.maxFee,
		MaxBuilderFeePct:     "0.050%",
	}
	f.enrolled = &info
	return info, nil
}

func itoa(n int) string { return strconv.Itoa(n) }

func fixtureTypedData(t *testing.T) []byte {
	t.Helper()
	raw, err := os.ReadFile("../eip712/testdata/perpl-enroll.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		TypedData json.RawMessage `json:"typed_data"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	return f.TypedData
}

const walletSig = "0x" + "11" + "2222222222222222222222222222222222222222222222222222222222222222" + "3333333333333333333333333333333333333333333333333333333333333333" // 65 bytes, shape only

func TestEnrollmentRoundTrip(t *testing.T) {
	fake := &fakeEnroller{t: t, typedData: fixtureTypedData(t), builderID: 18, maxFee: 50}
	store := keys.New()
	e, err := NewEnrollment(fake, store, 18, 50, nil)
	if err != nil {
		t.Fatal(err)
	}
	addr := "0x000000000000000000000000000000000000dEaD"

	res, err := e.Payload(context.Background(), PayloadRequest{Address: addr, Label: "phone"})
	if err != nil {
		t.Fatalf("Payload: %v", err)
	}
	if res.Handle == "" || len(res.TypedData) == 0 {
		t.Fatalf("payload result incomplete: %+v", res)
	}
	if fake.payloadReq.BuilderID != 18 || fake.payloadReq.MaxBuilderFeePer100K != 50 || fake.payloadReq.ScopeMask != 3 {
		t.Errorf("venue asked with %+v", fake.payloadReq)
	}
	if !strings.Contains(res.Statement, "builder code 18") {
		t.Errorf("statement = %q", res.Statement)
	}

	if res.SignInMessage == "" {
		t.Error("payload carries no sign-in message")
	}
	k, err := e.Enroll(context.Background(), res.Handle, walletSig, walletSig, "")
	if err != nil {
		t.Fatalf("Enroll: %v", err)
	}
	// The wallet was signed in — profile created — before enrollment.
	if len(fake.connected) != 1 || !strings.EqualFold(fake.connected[0], addr) {
		t.Errorf("wallet sign-in not performed before enroll: %v", fake.connected)
	}
	if !fake.popOK {
		t.Error("proof-of-possession did not verify over the EIP-712 digest")
	}
	if k.APIKey != "pk_enrolled" || k.BuilderID != 18 || k.MaxBuilderFeePer100K != 50 {
		t.Errorf("stored key = %+v", k)
	}
	got, err := store.Get(addr, "")
	if err != nil || got.APIKey != "pk_enrolled" {
		t.Errorf("store.Get = %+v, %v", got, err)
	}
	// A handle is single-use.
	if _, err := e.Enroll(context.Background(), res.Handle, walletSig, walletSig, ""); !errors.Is(err, ErrInvalid) {
		t.Errorf("second enroll with the same handle: %v", err)
	}
}

// If the venue hands back a document with different builder terms than we
// asked for, the wallet must not be asked to sign it.
func TestPayloadRefusesForeignBuilderTerms(t *testing.T) {
	fake := &fakeEnroller{t: t, typedData: fixtureTypedData(t), builderID: 7, maxFee: 50}
	e, _ := NewEnrollment(fake, keys.New(), 18, 50, nil)
	if _, err := e.Payload(context.Background(), PayloadRequest{Address: "0x000000000000000000000000000000000000dEaD"}); err == nil {
		t.Error("payload with builder 7 was accepted for builder 18")
	}
}

func TestEnrollValidation(t *testing.T) {
	fake := &fakeEnroller{t: t, typedData: fixtureTypedData(t), builderID: 18, maxFee: 50}
	e, _ := NewEnrollment(fake, keys.New(), 18, 50, nil)

	if _, err := e.Payload(context.Background(), PayloadRequest{Address: "not-an-address"}); !errors.Is(err, ErrInvalid) {
		t.Errorf("bad address: %v", err)
	}
	if _, err := e.Enroll(context.Background(), "nope", walletSig, walletSig, ""); !errors.Is(err, ErrInvalid) {
		t.Errorf("unknown handle: %v", err)
	}
	res, _ := e.Payload(context.Background(), PayloadRequest{Address: "0x000000000000000000000000000000000000dEaD"})
	if _, err := e.Enroll(context.Background(), res.Handle, walletSig, "0xdeadbeef", ""); !errors.Is(err, ErrInvalid) {
		t.Errorf("malformed signature: %v", err)
	}
	if _, err := NewEnrollment(fake, keys.New(), 0, 50, nil); err == nil {
		t.Error("builder id 0 accepted")
	}
	if _, err := NewEnrollment(fake, keys.New(), 18, 101, nil); err == nil {
		t.Error("fee above the protocol ceiling accepted")
	}
}

// A device-derived key: the app sends the public key with the payload
// request and the private key with the enrollment; the platform proves
// possession with it, stores it under the strategy, and refuses a private
// key that does not match.
func TestEnrollmentOfDerivedStrategyKey(t *testing.T) {
	fake := &fakeEnroller{t: t, typedData: fixtureTypedData(t), builderID: 18, maxFee: 50}
	store := keys.New()
	e, err := NewEnrollment(fake, store, 18, 50, nil)
	if err != nil {
		t.Fatal(err)
	}
	const addr = "0x00000000000000000000000000000000000000Ab"
	pub, priv, _ := ed25519.GenerateKey(nil)
	res, err := e.Payload(context.Background(), PayloadRequest{Address: addr, Strategy: "rsi", PublicKey: pub})
	if err != nil {
		t.Fatal(err)
	}
	if res.Strategy != "rsi" || res.PublicKey != "0x"+hex.EncodeToString(pub) || !fake.payloadReq.PublicKey.Equal(pub) || fake.payloadReq.Label != "TradeAgent · RSI Bounce" {
		t.Fatalf("payload = %+v, venue asked for %+v", res, fake.payloadReq)
	}
	// Without the private key, or with the wrong one, nothing is enrolled.
	if _, err := e.Enroll(context.Background(), res.Handle, walletSig, walletSig, ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("missing private key: %v", err)
	}
	res, _ = e.Payload(context.Background(), PayloadRequest{Address: addr, Strategy: "rsi", PublicKey: pub})
	_, other, _ := ed25519.GenerateKey(nil)
	if _, err := e.Enroll(context.Background(), res.Handle, walletSig, walletSig, "0x"+hex.EncodeToString(other.Seed())); !errors.Is(err, ErrInvalid) {
		t.Fatalf("mismatched private key: %v", err)
	}
	if fake.enrolled != nil {
		t.Fatal("the venue was asked to enroll before the key was verified")
	}
	res, _ = e.Payload(context.Background(), PayloadRequest{Address: addr, Strategy: "rsi", PublicKey: pub})
	k, err := e.Enroll(context.Background(), res.Handle, walletSig, walletSig, hex.EncodeToString(priv.Seed()))
	if err != nil {
		t.Fatal(err)
	}
	if !fake.popOK {
		t.Fatal("proof of possession did not verify against the derived key")
	}
	if k.Strategy != "rsi" || !k.Derived || !k.PrivateKey.Equal(priv) {
		t.Fatalf("stored key = %+v", k)
	}
	if _, err := store.Get(addr, "rsi"); err != nil {
		t.Fatal("key not stored under the strategy")
	}
	if _, err := store.Get(addr, ""); err == nil {
		t.Fatal("a strategy key was stored as wallet-wide")
	}
	if list := e.Keys(addr); len(list) != 1 || list[0].Strategy != "rsi" {
		t.Fatalf("Keys = %+v", list)
	}
	// A platform-generated enrollment refuses a private key.
	res, _ = e.Payload(context.Background(), PayloadRequest{Address: addr})
	if _, err := e.Enroll(context.Background(), res.Handle, walletSig, walletSig, hex.EncodeToString(priv.Seed())); !errors.Is(err, ErrInvalid) {
		t.Fatalf("generated key with a private key: %v", err)
	}
	if _, err := e.Payload(context.Background(), PayloadRequest{Address: addr, Strategy: "nope", PublicKey: pub}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unknown strategy: %v", err)
	}
}
