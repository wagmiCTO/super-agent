package chain

import (
	"errors"
	"math/big"

	"github.com/wagmiCTO/super-agent/services/internal/eip712"
)

// The ABI here is hand-written for the handful of functions the platform
// calls, all of them with static arguments: a selector followed by 32-byte
// words. Anything dynamic would warrant a real encoder.

// Selector is the first four bytes of keccak(signature).
func Selector(signature string) [4]byte {
	h := eip712.Keccak256([]byte(signature))
	var s [4]byte
	copy(s[:], h[:4])
	return s
}

// Word encodes a value as one 32-byte ABI word: [20]byte address, [32]byte,
// uint64, and *big.Int (two's complement for negatives, as int128/int256).
func Word(v any) [32]byte {
	var w [32]byte
	switch x := v.(type) {
	case [20]byte:
		copy(w[12:], x[:])
	case [32]byte:
		w = x
	case uint64:
		copy(w[24:], uintBytes8(x))
	case *big.Int:
		if x.Sign() < 0 {
			// two's complement in 256 bits
			mod := new(big.Int).Lsh(big.NewInt(1), 256)
			x = new(big.Int).Add(mod, x)
		}
		b := x.Bytes()
		copy(w[32-len(b):], b)
	case bool:
		if x {
			w[31] = 1
		}
	default:
		panic("abi: unsupported word type")
	}
	return w
}

func uintBytes8(u uint64) []byte {
	var b [8]byte
	for i := 7; i >= 0; i-- {
		b[i] = byte(u)
		u >>= 8
	}
	return b[:]
}

// Encode builds calldata: selector then static words.
func Encode(signature string, args ...any) []byte {
	sel := Selector(signature)
	out := append([]byte{}, sel[:]...)
	for _, a := range args {
		w := Word(a)
		out = append(out, w[:]...)
	}
	return out
}

// Words splits a return payload into 32-byte words.
func Words(data []byte) ([][32]byte, error) {
	if len(data)%32 != 0 {
		return nil, errors.New("abi: return data is not whole words")
	}
	out := make([][32]byte, len(data)/32)
	for i := range out {
		copy(out[i][:], data[i*32:(i+1)*32])
	}
	return out, nil
}

// Int128 decodes a signed 128-bit word.
func Int128(w [32]byte) *big.Int {
	v := new(big.Int).SetBytes(w[:])
	if w[0]&0x80 != 0 { // negative in 256-bit two's complement
		v.Sub(v, new(big.Int).Lsh(big.NewInt(1), 256))
	}
	return v
}

// Uint64 decodes an unsigned word that fits in 64 bits.
func Uint64(w [32]byte) uint64 {
	return new(big.Int).SetBytes(w[:]).Uint64()
}

// EncodeArrays builds calldata for a function whose parameters are all
// dynamic arrays of static types (recordTrades). The head holds one offset
// per array, relative to the start of the arguments; each array follows as
// a length word and its elements.
func EncodeArrays(signature string, arrays ...[][32]byte) []byte {
	sel := Selector(signature)
	out := append([]byte{}, sel[:]...)
	head := make([]byte, 0, 32*len(arrays))
	var tail []byte
	offset := 32 * len(arrays)
	for _, arr := range arrays {
		w := Word(uint64(offset))
		head = append(head, w[:]...)
		n := Word(uint64(len(arr)))
		tail = append(tail, n[:]...)
		for _, e := range arr {
			tail = append(tail, e[:]...)
		}
		offset += 32 * (1 + len(arr))
	}
	out = append(out, head...)
	return append(out, tail...)
}
