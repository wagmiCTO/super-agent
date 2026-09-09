// Package keys holds the exchange API keys the platform trades with, one per
// user wallet, and the enrollments in progress that will become keys.
//
// A key here is an Ed25519 pair enrolled at the venue and bound to our builder
// code. Holding it lets the platform place orders for that wallet; it can
// never withdraw — the venue forbids that for any API key. The wallet's own
// signing key is never here: it lives on the user's device, derived from a
// passkey, and only ever signs the enrollment.
//
// The store is in memory. Persistence is a later step and must encrypt the
// private keys at rest; until then a restart forgets every user's key and
// they re-enroll, which costs one passkey prompt.
package keys

import (
	"crypto/ed25519"

	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/wagmiCTO/super-agent/services/internal/venue/perpl"
	"strings"
	"sync"
	"time"
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

// Store is safe for concurrent use.
type Store struct {
	now     func() time.Time
	mu      sync.Mutex
	keys    map[string]Key     // by lower-case address
	pending map[string]Pending // by handle
}

func New() *Store {
	return &Store{
		now:     time.Now,
		keys:    make(map[string]Key),
		pending: make(map[string]Pending),
	}
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
func (s *Store) Put(k Key) {
	s.mu.Lock()
	defer s.mu.Unlock()
	k.Address = normalize(k.Address)
	s.keys[k.Address] = k
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
func (s *Store) Delete(address string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.keys, normalize(address))
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
