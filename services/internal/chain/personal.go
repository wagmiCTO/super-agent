package chain

import (
	"errors"
	"fmt"
	"strconv"

	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"

	"github.com/wagmiCTO/super-agent/services/internal/eip712"
)

// PersonalHash is the EIP-191 hash of a message, as wallets compute it for
// personal_sign: keccak("\x19Ethereum Signed Message:\n" ‖ len ‖ message).
func PersonalHash(message []byte) [32]byte {
	prefix := []byte("\x19Ethereum Signed Message:\n" + strconv.Itoa(len(message)))
	return eip712.Keccak256(append(prefix, message...))
}

// SignPersonal signs a message the way a wallet's personal_sign does and
// returns the 65-byte r ‖ s ‖ v signature with v in {27, 28}.
func (k *Key) SignPersonal(message []byte) []byte {
	h := PersonalHash(message)
	compact := ecdsa.SignCompact(k.priv, h[:], false) // [v+27, r, s]
	out := make([]byte, 65)
	copy(out, compact[1:65])
	out[64] = compact[0]
	return out
}

// RecoverPersonal returns the address that signed message with a 65-byte
// r ‖ s ‖ v signature, v in {0, 1, 27, 28}.
func RecoverPersonal(message, sig []byte) ([20]byte, error) {
	if len(sig) != 65 {
		return [20]byte{}, fmt.Errorf("chain: signature must be 65 bytes, got %d", len(sig))
	}
	v := sig[64]
	if v < 27 {
		v += 27
	}
	if v != 27 && v != 28 {
		return [20]byte{}, errors.New("chain: bad recovery byte")
	}
	compact := make([]byte, 65)
	compact[0] = v
	copy(compact[1:], sig[:64])
	h := PersonalHash(message)
	pub, _, err := ecdsa.RecoverCompact(compact, h[:])
	if err != nil {
		return [20]byte{}, fmt.Errorf("chain: recover: %w", err)
	}
	raw := pub.SerializeUncompressed()
	sum := eip712.Keccak256(raw[1:])
	var addr [20]byte
	copy(addr[:], sum[12:])
	return addr, nil
}
