package eip712

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

// The fixture is a real API-key enrollment payload from the venue, and the
// digest is what ethers' TypedDataEncoder — the venue's own reference — and
// viem agree on. Matching it byte for byte is the whole test: a wallet signs
// this digest, and our proof-of-possession must be over exactly the same
// bytes.
//
// A trap worth recording: viem infers the domain type from the JavaScript
// types of the domain values, and given chainId as the string "0x279f" it
// drops chainId from the domain entirely, producing a different digest. The
// client must hand viem a bigint chainId.
func TestDigestMatchesViem(t *testing.T) {
	raw, err := os.ReadFile("testdata/perpl-enroll.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		TypedData json.RawMessage `json:"typed_data"`
		Digest    string          `json:"digest"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	td, err := Parse(fixture.TypedData)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	got, err := Digest(td, Keccak256)
	if err != nil {
		t.Fatalf("Digest: %v", err)
	}
	if hex.EncodeToString(got[:]) != fixture.Digest[2:] {
		t.Errorf("digest = 0x%x, want %s", got, fixture.Digest)
	}
}

// Keccak-256 of the empty string, the canonical known answer that separates
// legacy Keccak from SHA3-256 (whose empty hash starts a7ffc6f8).
func TestKeccak256KnownAnswer(t *testing.T) {
	got := hex.EncodeToString(func() []byte { h := Keccak256(nil); return h[:] }())
	if want := "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"; got != want {
		t.Errorf("Keccak256(\"\") = %s, want %s", got, want)
	}
}

func TestEncodeType(t *testing.T) {
	td := TypedData{Types: map[string][]Field{
		"EIP712Domain": {{"name", "string"}},
		"Mail":         {{"from", "Person"}, {"to", "Person"}, {"contents", "string"}},
		"Person":       {{"name", "string"}, {"wallet", "address"}},
	}}
	got, err := EncodeType(td, "Mail")
	if err != nil {
		t.Fatal(err)
	}
	// The EIP-712 spec example: referenced types follow, alphabetically.
	if want := "Mail(Person from,Person to,string contents)Person(string name,address wallet)"; got != want {
		t.Errorf("EncodeType = %q, want %q", got, want)
	}
}

// The reference vector from the EIP-712 specification's example.
func TestSpecExample(t *testing.T) {
	doc := `{
	  "types": {
	    "EIP712Domain": [{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}],
	    "Person": [{"name":"name","type":"string"},{"name":"wallet","type":"address"}],
	    "Mail": [{"name":"from","type":"Person"},{"name":"to","type":"Person"},{"name":"contents","type":"string"}]
	  },
	  "primaryType": "Mail",
	  "domain": {"name":"Ether Mail","version":"1","chainId":1,"verifyingContract":"0xCcCCccccCCCCcCCCCCCcCCCCCCCCcCCCCCCCcccC"},
	  "message": {"from":{"name":"Cow","wallet":"0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826"},"to":{"name":"Bob","wallet":"0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB"},"contents":"Hello, Bob!"}
	}`
	td, err := Parse([]byte(doc))
	if err != nil {
		t.Fatal(err)
	}
	got, err := Digest(td, Keccak256)
	if err != nil {
		t.Fatal(err)
	}
	if want := "be609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2"; hex.EncodeToString(got[:]) != want {
		t.Errorf("spec digest = %x, want %s", got, want)
	}
}

func TestRejectsArraysAndMissingFields(t *testing.T) {
	td := TypedData{
		Types: map[string][]Field{
			"EIP712Domain": {{"name", "string"}},
			"T":            {{"xs", "uint256[]"}},
		},
		PrimaryType: "T",
		Domain:      map[string]any{"name": "x"},
		Message:     map[string]any{"xs": []any{}},
	}
	if _, err := Digest(td, Keccak256); err == nil {
		t.Error("array field was accepted")
	}
	td.Types["T"] = []Field{{"n", "uint256"}}
	td.Message = map[string]any{}
	if _, err := Digest(td, Keccak256); err == nil {
		t.Error("missing field was accepted")
	}
}
