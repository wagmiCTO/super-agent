// Package eip712 hashes typed data as EIP-712 defines it, so the server can
// compute the digest a wallet signed — and sign a proof-of-possession over the
// same digest — without a full Ethereum client library.
//
// Scope is deliberately narrow: the field types the venue's payloads use
// (string, bytes32, address, uintN, intN, bool, bytes, and nested structs).
// Arrays are rejected rather than half-supported; a payload that needs them
// gets an explicit error, not a wrong hash.
//
// Keccak-256 is injected. The digest is verified byte for byte against viem's
// hashTypedData on a real payload in the tests.
package eip712

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"sort"
	"strings"
)

// Hasher is Keccak-256 (the legacy Ethereum padding, not SHA3-256).
type Hasher func([]byte) [32]byte

// Field is one member of a struct type.
type Field struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// TypedData is the document as JSON-RPC eth_signTypedData_v4 carries it.
type TypedData struct {
	Types       map[string][]Field `json:"types"`
	PrimaryType string             `json:"primaryType"`
	Domain      map[string]any     `json:"domain"`
	Message     map[string]any     `json:"message"`
}

// Parse decodes a typed-data document. Numbers are kept as json.Number so a
// uint256 is not rounded through float64.
func Parse(raw []byte) (TypedData, error) {
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.UseNumber()
	var td TypedData
	if err := dec.Decode(&td); err != nil {
		return TypedData{}, fmt.Errorf("eip712: parse typed data: %w", err)
	}
	if td.PrimaryType == "" {
		return TypedData{}, errors.New("eip712: primaryType is required")
	}
	if _, ok := td.Types[td.PrimaryType]; !ok {
		return TypedData{}, fmt.Errorf("eip712: primaryType %q is not in types", td.PrimaryType)
	}
	if _, ok := td.Types["EIP712Domain"]; !ok {
		return TypedData{}, errors.New("eip712: types must include EIP712Domain")
	}
	return td, nil
}

// Digest returns keccak256("\x19\x01" ‖ domainSeparator ‖ hashStruct(message)),
// the 32 bytes a wallet signs and a proof-of-possession is computed over.
func Digest(td TypedData, keccak Hasher) ([32]byte, error) {
	domain, err := HashStruct(td, "EIP712Domain", td.Domain, keccak)
	if err != nil {
		return [32]byte{}, fmt.Errorf("eip712: domain: %w", err)
	}
	msg, err := HashStruct(td, td.PrimaryType, td.Message, keccak)
	if err != nil {
		return [32]byte{}, fmt.Errorf("eip712: message: %w", err)
	}
	buf := make([]byte, 0, 2+32+32)
	buf = append(buf, 0x19, 0x01)
	buf = append(buf, domain[:]...)
	buf = append(buf, msg[:]...)
	return keccak(buf), nil
}

// HashStruct is keccak256(typeHash ‖ encodeData(value)) for one struct type.
func HashStruct(td TypedData, typeName string, value map[string]any, keccak Hasher) ([32]byte, error) {
	th, err := TypeHash(td, typeName, keccak)
	if err != nil {
		return [32]byte{}, err
	}
	data, err := encodeData(td, typeName, value, keccak)
	if err != nil {
		return [32]byte{}, err
	}
	return keccak(append(th[:], data...)), nil
}

// TypeHash is keccak256 of the type's encoding, which lists the primary type
// followed by every referenced struct type in alphabetical order.
func TypeHash(td TypedData, typeName string, keccak Hasher) ([32]byte, error) {
	enc, err := EncodeType(td, typeName)
	if err != nil {
		return [32]byte{}, err
	}
	return keccak([]byte(enc)), nil
}

// EncodeType renders "Name(type field,type field,...)" for the type and, after
// it, the same for each struct it references, sorted by name.
func EncodeType(td TypedData, typeName string) (string, error) {
	if _, ok := td.Types[typeName]; !ok {
		return "", fmt.Errorf("eip712: unknown type %q", typeName)
	}
	deps := map[string]bool{}
	if err := collectDeps(td, typeName, deps); err != nil {
		return "", err
	}
	delete(deps, typeName)
	names := make([]string, 0, len(deps))
	for n := range deps {
		names = append(names, n)
	}
	sort.Strings(names)

	var b strings.Builder
	for _, n := range append([]string{typeName}, names...) {
		b.WriteString(n)
		b.WriteByte('(')
		for i, f := range td.Types[n] {
			if i > 0 {
				b.WriteByte(',')
			}
			b.WriteString(f.Type)
			b.WriteByte(' ')
			b.WriteString(f.Name)
		}
		b.WriteByte(')')
	}
	return b.String(), nil
}

func collectDeps(td TypedData, typeName string, seen map[string]bool) error {
	if seen[typeName] {
		return nil
	}
	fields, ok := td.Types[typeName]
	if !ok {
		return nil // a primitive
	}
	seen[typeName] = true
	for _, f := range fields {
		base := strings.TrimSuffix(f.Type, "[]")
		if _, isStruct := td.Types[base]; isStruct {
			if err := collectDeps(td, base, seen); err != nil {
				return err
			}
		}
	}
	return nil
}

func encodeData(td TypedData, typeName string, value map[string]any, keccak Hasher) ([]byte, error) {
	fields := td.Types[typeName]
	out := make([]byte, 0, 32*len(fields))
	for _, f := range fields {
		v, present := value[f.Name]
		if !present {
			return nil, fmt.Errorf("eip712: %s.%s is missing", typeName, f.Name)
		}
		word, err := encodeField(td, f.Type, v, keccak)
		if err != nil {
			return nil, fmt.Errorf("eip712: %s.%s: %w", typeName, f.Name, err)
		}
		out = append(out, word[:]...)
	}
	return out, nil
}

var (
	uintRe  = regexp.MustCompile(`^uint(\d+)$`)
	intRe   = regexp.MustCompile(`^int(\d+)$`)
	bytesRe = regexp.MustCompile(`^bytes(\d+)$`)
)

// encodeField produces the 32-byte word for one value of the given type.
func encodeField(td TypedData, typ string, v any, keccak Hasher) ([32]byte, error) {
	var word [32]byte

	if strings.HasSuffix(typ, "]") {
		return word, fmt.Errorf("array type %q is not supported", typ)
	}
	if _, isStruct := td.Types[typ]; isStruct {
		m, ok := v.(map[string]any)
		if !ok {
			return word, fmt.Errorf("expected object for %s", typ)
		}
		return HashStruct(td, typ, m, keccak)
	}

	switch {
	case typ == "string":
		s, ok := v.(string)
		if !ok {
			return word, fmt.Errorf("expected string")
		}
		return keccak([]byte(s)), nil

	case typ == "bytes":
		b, err := hexBytes(v)
		if err != nil {
			return word, err
		}
		return keccak(b), nil

	case typ == "bool":
		b, ok := v.(bool)
		if !ok {
			return word, fmt.Errorf("expected bool")
		}
		if b {
			word[31] = 1
		}
		return word, nil

	case typ == "address":
		b, err := hexBytes(v)
		if err != nil {
			return word, err
		}
		if len(b) != 20 {
			return word, fmt.Errorf("address must be 20 bytes, got %d", len(b))
		}
		copy(word[12:], b)
		return word, nil

	case bytesRe.MatchString(typ):
		n := atoi(bytesRe.FindStringSubmatch(typ)[1])
		if n < 1 || n > 32 {
			return word, fmt.Errorf("invalid type %s", typ)
		}
		b, err := hexBytes(v)
		if err != nil {
			return word, err
		}
		if len(b) != n {
			return word, fmt.Errorf("%s must be %d bytes, got %d", typ, n, len(b))
		}
		copy(word[:], b) // left-aligned, right-padded
		return word, nil

	case uintRe.MatchString(typ):
		bits := atoi(uintRe.FindStringSubmatch(typ)[1])
		n, err := bigInt(v)
		if err != nil {
			return word, err
		}
		if n.Sign() < 0 || n.BitLen() > bits {
			return word, fmt.Errorf("value out of range for %s", typ)
		}
		n.FillBytes(word[:])
		return word, nil

	case intRe.MatchString(typ):
		bits := atoi(intRe.FindStringSubmatch(typ)[1])
		n, err := bigInt(v)
		if err != nil {
			return word, err
		}
		limit := new(big.Int).Lsh(big.NewInt(1), uint(bits-1))
		if n.Cmp(new(big.Int).Neg(limit)) < 0 || n.Cmp(limit) >= 0 {
			return word, fmt.Errorf("value out of range for %s", typ)
		}
		// Two's complement in 256 bits.
		if n.Sign() < 0 {
			n = new(big.Int).Add(n, new(big.Int).Lsh(big.NewInt(1), 256))
		}
		n.FillBytes(word[:])
		return word, nil
	}
	return word, fmt.Errorf("unsupported type %q", typ)
}

// bigInt accepts a JSON number, a decimal string, or a 0x-hex string — all of
// which appear in typed-data documents in the wild.
func bigInt(v any) (*big.Int, error) {
	switch x := v.(type) {
	case json.Number:
		n, ok := new(big.Int).SetString(x.String(), 10)
		if !ok {
			return nil, fmt.Errorf("bad number %q", x)
		}
		return n, nil
	case float64:
		if x != float64(int64(x)) {
			return nil, fmt.Errorf("non-integer number %v", x)
		}
		return big.NewInt(int64(x)), nil
	case string:
		s := strings.TrimSpace(x)
		if strings.HasPrefix(s, "0x") || strings.HasPrefix(s, "0X") {
			n, ok := new(big.Int).SetString(s[2:], 16)
			if !ok {
				return nil, fmt.Errorf("bad hex number %q", x)
			}
			return n, nil
		}
		n, ok := new(big.Int).SetString(s, 10)
		if !ok {
			return nil, fmt.Errorf("bad number %q", x)
		}
		return n, nil
	}
	return nil, fmt.Errorf("expected number, got %T", v)
}

func hexBytes(v any) ([]byte, error) {
	s, ok := v.(string)
	if !ok {
		return nil, fmt.Errorf("expected hex string, got %T", v)
	}
	s = strings.TrimPrefix(strings.TrimPrefix(s, "0x"), "0X")
	if len(s)%2 == 1 {
		s = "0" + s
	}
	b, err := hex.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("bad hex: %w", err)
	}
	return b, nil
}

func atoi(s string) int {
	n := 0
	for _, c := range s {
		n = n*10 + int(c-'0')
	}
	return n
}
