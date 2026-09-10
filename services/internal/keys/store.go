// Package keys holds the exchange API keys the platform trades with — one
// per (wallet, strategy) — and the enrollments in progress that will become
// keys.
//
// A key here is an Ed25519 pair enrolled at the venue and bound to our builder
// code. Holding it lets the platform place orders for that wallet; it can
// never withdraw — the venue forbids that for any API key. The wallet's own
// signing key is never here: it lives on the user's device, derived from a
// passkey, and only ever signs the enrollment.
//
// Strategy keys are derived on the device from the same passkey (ADR 0005)
// and handed over at enrollment; keys with an empty strategy were generated
// here before that and serve every strategy for their wallet.
//
// The store is in memory, mirrored to a Backend (Postgres, which seals the
// private keys) or to a JSON file for a development box.
package keys

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/venue/perpl"
)

var (
	ErrNotFound = errors.New("keys: no key for this address")
	ErrExpired  = errors.New("keys: enrollment expired; request a new payload")
)

// Key is an enrolled API key and the terms it was enrolled under.
type Key struct {
	Address string
	// Strategy is the strategy this key trades for; "" serves every strategy.
	Strategy   string
	APIKey     string             // the opaque X-API-Key token
	PrivateKey ed25519.PrivateKey // never serialised to the API
	Label      string
	BuilderID  int
	// MaxBuilderFeePer100K is the ceiling the user signed for.
	MaxBuilderFeePer100K int
	MaxBuilderFeePct     string
	// Derived is true for a key the device derived from the passkey, false
	// for one the platform generated.
	Derived    bool
	EnrolledAt time.Time
}

// ID is the store's key for a Key: address and strategy.
func (k Key) ID() string { return id(k.Address, k.Strategy) }

func id(address, strategy string) string {
	return normalize(address) + "/" + strings.TrimSpace(strategy)
}

// Pending is an enrollment between the payload step and the enroll step.
// For a platform-generated key the private key is here; for a derived key
// only the public key is, and the private key arrives with the enroll step.
type Pending struct {
	Handle     string
	Address    string
	Strategy   string
	Label      string
	PrivateKey ed25519.PrivateKey // nil while a derived key is with the device
	PublicKey  ed25519.PublicKey
	Derived    bool
	TypedData  []byte
	MAC        string
	// Auth is the venue's sign-in payload for the wallet, signed alongside.
	Auth      perpl.AuthPayload
	BuilderID int
	MaxFee    int
	ExpiresAt time.Time
}

// PendingRequest is what PreparePending needs.
type PendingRequest struct {
	Address   string
	Strategy  string
	Label     string
	BuilderID int
	MaxFee    int
	// PublicKey, when set, is the device-derived key to enroll; when nil
	// the store generates a pair.
	PublicKey ed25519.PublicKey
}

// PendingTTL bounds how long a payload may sit unsigned. The venue's payload
// carries its own timestamp; ten minutes is comfortably inside it.
const PendingTTL = 10 * time.Minute

// Backend is durable storage for keys: Postgres in production, a file for
// a development box. The Store keeps every key in memory and writes through.
type Backend interface {
	LoadKeys(ctx context.Context) ([]Key, error)
	PutKey(ctx context.Context, k Key) error
	DeleteKey(ctx context.Context, address, strategy string) error
}

// Store is safe for concurrent use.
type Store struct {
	now     func() time.Time
	mu      sync.Mutex
	keys    map[string]Key     // by ID()
	pending map[string]Pending // by handle
	file    string             // "" keeps the store in memory only
	backend Backend
}

// WithBackend returns a store mirrored to a Backend, loaded now.
func WithBackend(ctx context.Context, b Backend) (*Store, error) {
	s := New()
	s.backend = b
	ks, err := b.LoadKeys(ctx)
	if err != nil {
		return nil, fmt.Errorf("keys: load: %w", err)
	}
	for _, k := range ks {
		k.Address = normalize(k.Address)
		s.keys[k.ID()] = k
	}
	return s, nil
}

func New() *Store {
	return &Store{
		now:     time.Now,
		keys:    make(map[string]Key),
		pending: make(map[string]Pending),
	}
}

// WithFile returns a store mirrored to path: existing keys are loaded now,
// and every Put and Delete rewrites the file. Pending enrollments stay in
// memory — they are short-lived by design.
func WithFile(path string) (*Store, error) {
	s := New()
	s.file = path
	b, err := os.ReadFile(path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		return s, nil
	case err != nil:
		return nil, fmt.Errorf("keys: read %s: %w", path, err)
	}
	var recs []keyRecord
	if err := json.Unmarshal(b, &recs); err != nil {
		return nil, fmt.Errorf("keys: parse %s: %w", path, err)
	}
	for _, r := range recs {
		k, err := r.key()
		if err != nil {
			return nil, fmt.Errorf("keys: %s: %w", path, err)
		}
		s.keys[k.ID()] = k
	}
	return s, nil
}

// Len reports how many keys are held.
func (s *Store) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.keys)
}

// keyRecord is the on-disk form of a Key.
type keyRecord struct {
	Address              string    `json:"address"`
	Strategy             string    `json:"strategy,omitempty"`
	APIKey               string    `json:"api_key"`
	PrivateKeyHex        string    `json:"private_key"`
	Label                string    `json:"label"`
	BuilderID            int       `json:"builder_id"`
	MaxBuilderFeePer100K int       `json:"max_builder_fee_per_100k"`
	MaxBuilderFeePct     string    `json:"max_builder_fee_pct"`
	Derived              bool      `json:"derived,omitempty"`
	EnrolledAt           time.Time `json:"enrolled_at"`
}

func (r keyRecord) key() (Key, error) {
	priv, err := hex.DecodeString(r.PrivateKeyHex)
	if err != nil || len(priv) != ed25519.PrivateKeySize {
		return Key{}, fmt.Errorf("key for %s: bad private key", r.Address)
	}
	return Key{
		Address: normalize(r.Address), Strategy: r.Strategy, APIKey: r.APIKey, PrivateKey: ed25519.PrivateKey(priv), Label: r.Label,
		BuilderID: r.BuilderID, MaxBuilderFeePer100K: r.MaxBuilderFeePer100K, MaxBuilderFeePct: r.MaxBuilderFeePct,
		Derived: r.Derived, EnrolledAt: r.EnrolledAt,
	}, nil
}

// saveLocked rewrites the file atomically; callers hold s.mu.
func (s *Store) saveLocked() error {
	if s.file == "" {
		return nil
	}
	recs := make([]keyRecord, 0, len(s.keys))
	for _, k := range s.keys {
		recs = append(recs, keyRecord{
			Address: k.Address, Strategy: k.Strategy, APIKey: k.APIKey, PrivateKeyHex: hex.EncodeToString(k.PrivateKey), Label: k.Label,
			BuilderID: k.BuilderID, MaxBuilderFeePer100K: k.MaxBuilderFeePer100K, MaxBuilderFeePct: k.MaxBuilderFeePct,
			Derived: k.Derived, EnrolledAt: k.EnrolledAt,
		})
	}
	sort.Slice(recs, func(i, j int) bool { return recs[i].Address+recs[i].Strategy < recs[j].Address+recs[j].Strategy })
	b, err := json.MarshalIndent(recs, "", "  ")
	if err != nil {
		return err
	}
	tmp := filepath.Join(filepath.Dir(s.file), "."+filepath.Base(s.file)+".tmp")
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return fmt.Errorf("keys: write %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, s.file); err != nil {
		return fmt.Errorf("keys: replace %s: %w", s.file, err)
	}
	return nil
}

// PreparePending sets up an enrollment before the venue is asked for a
// payload, since the payload must carry the public key: the device's when
// it derived the key, a fresh pair otherwise. Register stores the completed
// pending once the payload is in hand.
func (s *Store) PreparePending(req PendingRequest) (Pending, error) {
	p := Pending{
		Address:   normalize(req.Address),
		Strategy:  strings.TrimSpace(req.Strategy),
		Label:     req.Label,
		BuilderID: req.BuilderID,
		MaxFee:    req.MaxFee,
		ExpiresAt: s.now().Add(PendingTTL),
	}
	if len(req.PublicKey) > 0 {
		if len(req.PublicKey) != ed25519.PublicKeySize {
			return Pending{}, fmt.Errorf("keys: public key must be %d bytes", ed25519.PublicKeySize)
		}
		p.PublicKey = append(ed25519.PublicKey(nil), req.PublicKey...)
		p.Derived = true
	} else {
		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return Pending{}, fmt.Errorf("keys: generate: %w", err)
		}
		p.PublicKey, p.PrivateKey = pub, priv
	}
	var h [16]byte
	if _, err := rand.Read(h[:]); err != nil {
		return Pending{}, fmt.Errorf("keys: handle: %w", err)
	}
	p.Handle = hex.EncodeToString(h[:])
	return p, nil
}

// Register records a prepared pending enrollment once its payload exists.
func (s *Store) Register(p Pending) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.gcLocked()
	s.pending[p.Handle] = p
}

// TakePending removes and returns the pending enrollment for a handle. It is
// single-use: a second enroll with the same handle fails.
func (s *Store) TakePending(handle string) (Pending, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.pending[handle]
	if !ok {
		return Pending{}, ErrNotFound
	}
	delete(s.pending, handle)
	if s.now().After(p.ExpiresAt) {
		return Pending{}, ErrExpired
	}
	return p, nil
}

// Put stores an enrolled key, replacing any earlier key for the same
// wallet and strategy.
func (s *Store) Put(k Key) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	k.Address = normalize(k.Address)
	k.Strategy = strings.TrimSpace(k.Strategy)
	s.keys[k.ID()] = k
	if s.backend != nil {
		return s.backend.PutKey(context.Background(), k)
	}
	return s.saveLocked()
}

// Get returns the key for a wallet and strategy, exactly: a wallet-wide key
// (strategy "") is not returned for a named strategy. See Resolve.
func (s *Store) Get(address, strategy string) (Key, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	k, ok := s.keys[id(address, strategy)]
	if !ok {
		return Key{}, ErrNotFound
	}
	return k, nil
}

// Resolve returns the key that trades strategy for a wallet: the strategy's
// own key when enrolled, else the wallet-wide key from before per-strategy
// keys existed.
func (s *Store) Resolve(address, strategy string) (Key, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if k, ok := s.keys[id(address, strategy)]; ok {
		return k, nil
	}
	if k, ok := s.keys[id(address, "")]; ok {
		return k, nil
	}
	return Key{}, ErrNotFound
}

// ForWallet lists a wallet's keys, wallet-wide first, then by strategy.
func (s *Store) ForWallet(address string) []Key {
	s.mu.Lock()
	defer s.mu.Unlock()
	addr := normalize(address)
	var out []Key
	for _, k := range s.keys {
		if k.Address == addr {
			out = append(out, k)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Strategy < out[j].Strategy })
	return out
}

// Delete forgets a key. It does not revoke it at the venue; that is done from
// the venue's own key page, by the user.
func (s *Store) Delete(address, strategy string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.keys, id(address, strategy))
	if s.backend != nil {
		return s.backend.DeleteKey(context.Background(), normalize(address), strings.TrimSpace(strategy))
	}
	return s.saveLocked()
}

func (s *Store) gcLocked() {
	now := s.now()
	for h, p := range s.pending {
		if now.After(p.ExpiresAt) {
			delete(s.pending, h)
		}
	}
}

func normalize(address string) string { return strings.ToLower(strings.TrimSpace(address)) }
