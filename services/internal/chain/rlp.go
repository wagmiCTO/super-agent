// Package chain is the platform's own path to the chain: JSON-RPC, EIP-1559
// transactions signed locally, and the ABI of the few contract functions it
// calls. It deliberately owns the wire protocol instead of pulling in a client
// framework — the same rule as the venue adapter — and it depends on one
// library, for the secp256k1 curve.
package chain

import "math/big"

// rlpEncode encodes an item: []byte is a string, []any is a list, *big.Int
// and uint64 are minimal big-endian strings (zero is the empty string).
func rlpEncode(v any) []byte {
	switch x := v.(type) {
	case []byte:
		return rlpString(x)
	case string:
		return rlpString([]byte(x))
	case uint64:
		return rlpString(uintBytes(x))
	case *big.Int:
		if x == nil || x.Sign() == 0 {
			return rlpString(nil)
		}
		return rlpString(x.Bytes())
	case []any:
		var body []byte
		for _, e := range x {
			body = append(body, rlpEncode(e)...)
		}
		return append(rlpLen(0xc0, len(body)), body...)
	}
	panic("rlp: unsupported type")
}

func rlpString(b []byte) []byte {
	if len(b) == 1 && b[0] < 0x80 {
		return b
	}
	return append(rlpLen(0x80, len(b)), b...)
}

func rlpLen(offset byte, n int) []byte {
	if n < 56 {
		return []byte{offset + byte(n)}
	}
	be := uintBytes(uint64(n))
	return append([]byte{offset + 55 + byte(len(be))}, be...)
}

func uintBytes(u uint64) []byte {
	if u == 0 {
		return nil
	}
	var b [8]byte
	for i := 7; i >= 0; i-- {
		b[i] = byte(u)
		u >>= 8
	}
	i := 0
	for i < 8 && b[i] == 0 {
		i++
	}
	return b[i:]
}
