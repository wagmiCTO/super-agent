// Package seal encrypts small secrets at rest: AES-256-GCM under one key
// from the environment. It is deliberately tiny — the exchange API keys
// the platform holds are the only thing it seals — and its format is
// versioned so a future key rotation or algorithm change can tell old
// records from new.
package seal

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

// magic prefixes every sealed record; anything else is taken as plaintext
// written before sealing existed.
var magic = []byte("TAK1")

// Sealer encrypts and decrypts with one key.
type Sealer struct {
	aead cipher.AEAD
}

// New takes the key as 64 hex characters (32 bytes).
func New(hexKey string) (*Sealer, error) {
	key, err := hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(hexKey), "0x"))
	if err != nil || len(key) != 32 {
		return nil, errors.New("seal: key must be 32 bytes of hex")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Sealer{aead: aead}, nil
}

// Seal encrypts plaintext, binding it to label so a record cannot be moved
// under another owner. The output is magic ‖ nonce ‖ ciphertext.
func (s *Sealer) Seal(plaintext []byte, label string) ([]byte, error) {
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("seal: nonce: %w", err)
	}
	out := make([]byte, 0, len(magic)+len(nonce)+len(plaintext)+s.aead.Overhead())
	out = append(out, magic...)
	out = append(out, nonce...)
	return s.aead.Seal(out, nonce, plaintext, []byte(label)), nil
}

// Sealed reports whether data carries the sealed format.
func Sealed(data []byte) bool {
	return len(data) > len(magic) && string(data[:len(magic)]) == string(magic)
}

// Open decrypts a record produced by Seal under the same label.
func (s *Sealer) Open(data []byte, label string) ([]byte, error) {
	if !Sealed(data) {
		return nil, errors.New("seal: not a sealed record")
	}
	data = data[len(magic):]
	n := s.aead.NonceSize()
	if len(data) < n+s.aead.Overhead() {
		return nil, errors.New("seal: record too short")
	}
	out, err := s.aead.Open(nil, data[:n], data[n:], []byte(label))
	if err != nil {
		return nil, errors.New("seal: cannot open record: wrong key or tampered")
	}
	return out, nil
}
