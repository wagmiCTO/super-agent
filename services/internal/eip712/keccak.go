package eip712

import "golang.org/x/crypto/sha3"

// Keccak256 is the hash EIP-712 and Ethereum use: Keccak with the original
// padding, which differs from the standardised SHA3-256 in the Go standard
// library. It is the Hasher every function in this package expects.
func Keccak256(data []byte) [32]byte {
	h := sha3.NewLegacyKeccak256()
	h.Write(data)
	var out [32]byte
	h.Sum(out[:0])
	return out
}
