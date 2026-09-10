// Package keys holds the exchange API keys the platform trades with, one per
// user wallet, and the enrollments in progress that will become keys.
//
// A key here is an Ed25519 pair enrolled at the venue and bound to our builder
// code. Holding it lets the platform place orders for that wallet; it can
// never withdraw — the venue forbids that for any API key. The wallet's own
// signing key is never here: it lives on the user's device, derived from a
// passkey, and only ever signs the enrollment.
//
// The store is in memory, optionally mirrored to a JSON file (see WithFile)
// so a restart does not forget every user's key. The file holds the private
// keys in the clear, guarded only by 0600 permissions — acceptable for a
// testnet development box, not for anything that trades real money: at-rest
// encryption is the next step before that.
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
	Address    string
	APIKey     string             // the opaque X-API-Key token
	PrivateKey ed25519.PrivateKey // never serialised to the API
	Label      string
	BuilderID  int
	// MaxBuilderFeePer100K is the ceiling the user signed for.
	MaxBuilderFeePer100K int
	MaxBuilderFeePct     string
	EnrolledAt           time.Time
}

// Pending is an enrollment between the payload step and the enroll step. The
// private key is generated here and waits for the wallet's signature.
type Pending struct {
	Handle     string
	Address    string
	Label      string
	PrivateKey ed25519.PrivateKey
	PublicKey  ed25519.PublicKey
	TypedData  []byte
	MAC        string
	// Auth is the venue's sign-in payload for the wallet, signed alongside.
	Auth      perpl.AuthPayload
	BuilderID int
	MaxFee    int
	ExpiresAt time.Time
}

// PendingTTL bounds how long a payload may sit unsigned. The venue's payload
// carries its own timestamp; ten minutes is comfortably inside it.
const PendingTTL = 10 * time.Minute

// Backend is durable storage for keys: Postgres in production, a file for
// a development box. The Store keeps every key in memory and writes through.
type Backend interface {
	LoadKeys(ctx context.Context) ([]Key, error)
	PutKey(ctx context.Context, k Key) error
	DeleteKey(ctx context.Context, address string) error
}

// Store is safe for concurrent use.
type Store struct {
	now     func() time.Time
	mu      sync.Mutex
	keys    map[string]Key     // by lower-case address
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
		s.keys[k.Address] = k
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
		s.keys[k.Address] = k
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
	APIKey               string    `json:"api_key"`
	PrivateKeyHex        string    `json:"private_key"`
	Label                string    `json:"label"`
	BuilderID            int       `json:"builder_id"`
	MaxBuilderFeePer100K int       `json:"max_builder_fee_per_100k"`
	MaxBuilderFeePct     string    `json:"max_builder_fee_pct"`
	EnrolledAt           time.Time `json:"enrolled_at"`
}

func (r keyRecord) key() (Key, error) {
	priv, err := hex.DecodeString(r.PrivateKeyHex)
	if err != nil || len(priv) != ed25519.PrivateKeySize {
		return Key{}, fmt.Errorf("key for %s: bad private key", r.Address)
	}
	return Key{
		Address: normalize(r.Address), APIKey: r.APIKey, PrivateKey: ed25519.PrivateKey(priv), Label: r.Label,
		BuilderID: r.BuilderID, MaxBuilderFeePer100K: r.MaxBuilderFeePer100K, MaxBuilderFeePct: r.MaxBuilderFeePct,
		EnrolledAt: r.EnrolledAt,
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
			Address: k.Address, APIKey: k.APIKey, PrivateKeyHex: hex.EncodeToString(k.PrivateKey), Label: k.Label,
			BuilderID: k.BuilderID, MaxBuilderFeePer100K: k.MaxBuilderFeePer100K, MaxBuilderFeePct: k.MaxBuilderFeePct,
			EnrolledAt: k.EnrolledAt,
		})
	}
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

// PreparePending generates the key pair before the venue is asked for a
// payload, since the payload must carry the public key. Register stores the
// completed pending once the payload is in hand.
func (s *Store) PreparePending(address, label string, builderID, maxFee int) (Pending, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return Pending{}, fmt.Errorf("keys: generate: %w", err)
	}
	var h [16]byte
	if _, err := rand.Read(h[:]); err != nil {
		return Pending{}, fmt.Errorf("keys: handle: %w", err)
	}
	return Pending{
		Handle:     hex.EncodeToString(h[:]),
		Address:    normalize(address),
		Label:      label,
		PrivateKey: priv,
		PublicKey:  pub,
		BuilderID:  builderID,
		MaxFee:     maxFee,
		ExpiresAt:  s.now().Add(PendingTTL),
	}, nil
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

// Put stores an enrolled key, replacing any earlier key for the address.
func (s *Store) Put(k Key) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	k.Address = normalize(k.Address)
	s.keys[k.Address] = k
	if s.backend != nil {
		return s.backend.PutKey(context.Background(), k)
	}
	return s.saveLocked()
}

// Get returns the key for an address.
func (s *Store) Get(address string) (Key, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	k, ok := s.keys[normalize(address)]
	if !ok {
		return Key{}, ErrNotFound
	}
	return k, nil
}

// Delete forgets a key. It does not revoke it at the venue; that is done from
// the venue's own key page, by the user.
func (s *Store) Delete(address string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.keys, normalize(address))
	if s.backend != nil {
		return s.backend.DeleteKey(context.Background(), normalize(address))
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
