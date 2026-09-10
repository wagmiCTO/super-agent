package chain

import (
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"

	"github.com/wagmiCTO/super-agent/services/internal/eip712"
)

// Key is a secp256k1 private key with its address.
type Key struct {
	priv    *secp256k1.PrivateKey
	Address [20]byte
}

// ParseKey reads a 0x-hex 32-byte private key.
func ParseKey(hexKey string) (*Key, error) {
	b, err := hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(hexKey), "0x"))
	if err != nil || len(b) != 32 {
		return nil, errors.New("chain: private key must be 32 bytes of hex")
	}
	priv := secp256k1.PrivKeyFromBytes(b)
	if priv.Key.IsZero() {
		return nil, errors.New("chain: private key is zero")
	}
	pub := priv.PubKey().SerializeUncompressed() // 0x04 || X || Y
	h := eip712.Keccak256(pub[1:])
	var addr [20]byte
	copy(addr[:], h[12:])
	return &Key{priv: priv, Address: addr}, nil
}

// Tx is an EIP-1559 (type 2) transaction.
type Tx struct {
	ChainID    uint64
	Nonce      uint64
	TipCap     *big.Int // maxPriorityFeePerGas
	FeeCap     *big.Int // maxFeePerGas
	Gas        uint64
	To         *[20]byte // nil creates a contract
	Value      *big.Int
	Data       []byte
	AccessList []any // always empty here
}

func (t Tx) fields() []any {
	var to any = []byte{}
	if t.To != nil {
		to = t.To[:]
	}
	value := t.Value
	if value == nil {
		value = new(big.Int)
	}
	return []any{t.ChainID, t.Nonce, t.TipCap, t.FeeCap, t.Gas, to, value, t.Data, []any{}}
}

// SigningHash is keccak(0x02 || rlp(fields)).
func (t Tx) SigningHash() [32]byte {
	return eip712.Keccak256(append([]byte{0x02}, rlpEncode(t.fields())...))
}

// Sign returns the raw signed transaction, ready for eth_sendRawTransaction.
func (k *Key) Sign(t Tx) ([]byte, error) {
	h := t.SigningHash()
	// Compact signature: [recovery+27, R, S]; secp256k1 enforces low S.
	sig := ecdsa.SignCompact(k.priv, h[:], false)
	if len(sig) != 65 {
		return nil, fmt.Errorf("chain: unexpected signature length %d", len(sig))
	}
	v := uint64(sig[0] - 27)
	r := new(big.Int).SetBytes(sig[1:33])
	s := new(big.Int).SetBytes(sig[33:65])
	signed := append(t.fields(), v, r, s)
	return append([]byte{0x02}, rlpEncode(signed)...), nil
}

// TxHash is keccak of the raw signed transaction.
func TxHash(raw []byte) [32]byte { return eip712.Keccak256(raw) }
