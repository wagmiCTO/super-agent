package platform

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/chain"
	"github.com/wagmiCTO/super-agent/services/internal/fixed"
)

// fakeChain is just enough JSON-RPC to settle one trade and read it back:
// it records the raw transactions it receives and answers reads from what
// the test primes.
type fakeChain struct {
	mu      sync.Mutex
	sent    []string
	calls   []string
	totals  map[string]string // calldata hex → return hex
	settler bool
}

func (f *fakeChain) handler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID     any             `json:"id"`
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	var result any
	switch req.Method {
	case "eth_chainId":
		result = "0x279f"
	case "eth_getTransactionCount":
		f.mu.Lock()
		result = "0x" + strings.TrimLeft(hex.EncodeToString([]byte{byte(len(f.sent))}), "0")
		f.mu.Unlock()
		if result == "0x" {
			result = "0x0"
		}
	case "eth_gasPrice":
		result = "0x174876e800"
	case "eth_maxPriorityFeePerGas":
		result = "0x3b9aca00"
	case "eth_estimateGas":
		result = "0x15f90"
	case "eth_getBalance":
		result = "0xde0b6b3a7640000"
	case "eth_call":
		var params []json.RawMessage
		_ = json.Unmarshal(req.Params, &params)
		var call struct{ Data string }
		_ = json.Unmarshal(params[0], &call)
		f.mu.Lock()
		f.calls = append(f.calls, call.Data)
		sel := call.Data[:10]
		switch {
		case sel == "0x"+hex.EncodeToString(sel4("settlers(address)")):
			if f.settler {
				result = "0x" + strings.Repeat("0", 63) + "1"
			} else {
				result = "0x" + strings.Repeat("0", 64)
			}
		default:
			if v, ok := f.totals[call.Data]; ok {
				result = v
			} else {
				result = "0x" + strings.Repeat("0", 128)
			}
		}
		f.mu.Unlock()
	case "eth_sendRawTransaction":
		var params []string
		_ = json.Unmarshal(req.Params, &params)
		f.mu.Lock()
		f.sent = append(f.sent, params[0])
		f.mu.Unlock()
		h := chain.TxHash(mustDecode(params[0]))
		result = "0x" + hex.EncodeToString(h[:])
	case "eth_getTransactionReceipt":
		result = map[string]string{"status": "0x1", "blockNumber": "0x10", "gasUsed": "0x15f90"}
	default:
		http.Error(w, "unknown method "+req.Method, 400)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
}

func sel4(sig string) []byte { s := chain.Selector(sig); return s[:] }

func bigInt(v int64) *big.Int { return big.NewInt(v) }

func mustDecode(h string) []byte {
	b, _ := hex.DecodeString(strings.TrimPrefix(h, "0x"))
	return b
}

const testSettlerKey = "0x0000000000000000000000000000000000000000000000000000000000000002"
const testContract = "0x8C7E11a4ed1a7bd7212DdE5fAafA5C4EAC14d21e"

// A closed trade becomes exactly one recordTrade transaction, with the
// strategy key, the wallet, the result in micros, the close time and the ref
// encoded as the contract expects.
func TestSettlerRecordsAClosedTrade(t *testing.T) {
	fc := &fakeChain{settler: true, totals: map[string]string{}}
	srv := httptest.NewServer(http.HandlerFunc(fc.handler))
	defer srv.Close()

	s, err := NewSettler(context.Background(), SettlerConfig{RPCURL: srv.URL, PrivateKey: testSettlerKey, Contract: testContract}, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.Run(ctx)

	closedAt := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	tr := Trade{Wallet: "0x000000000000000000000000000000000000000a", Strategy: "ma-cross", Symbol: "MON",
		PnL: fixed.MustParse("-0.016165"), ClosedAt: closedAt, Ref: TradeRef("open-1", "close-1")}
	s.Enqueue(tr)

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if st := s.Stats(); st.Sent == 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if st := s.Stats(); st.Sent != 1 || st.Pending != 0 || st.Failed != 0 {
		t.Fatalf("stats = %+v", st)
	}
	fc.mu.Lock()
	raw := fc.sent[0]
	fc.mu.Unlock()
	wallet, _ := chain.ParseAddress(tr.Wallet)
	want := chain.Encode("recordTrade(bytes32,address,int128,uint64,bytes32)",
		StrategyKey("ma-cross"), wallet, collateralMicros(tr.PnL), uint64(closedAt.Unix()), tr.Ref)
	if !strings.Contains(raw, hex.EncodeToString(want)) {
		t.Fatalf("raw tx does not carry the expected calldata\nraw %s\nwant %x", raw, want)
	}
	if got := collateralMicros(tr.PnL).String(); got != "-16165" {
		t.Errorf("micros = %s", got)
	}
}

// The platform's own account key is not a chain address: nothing to settle,
// and nothing to retry forever.
func TestSettlerSkipsNonAddressWallets(t *testing.T) {
	fc := &fakeChain{settler: true, totals: map[string]string{}}
	srv := httptest.NewServer(http.HandlerFunc(fc.handler))
	defer srv.Close()
	s, err := NewSettler(context.Background(), SettlerConfig{RPCURL: srv.URL, PrivateKey: testSettlerKey, Contract: testContract}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.settle(context.Background(), Trade{Wallet: "480", Strategy: "direction"}); err != nil {
		t.Fatal(err)
	}
	if len(fc.sent) != 0 {
		t.Fatal("a transaction was sent for a non-address wallet")
	}
}

func TestSettlerRefusesUnauthorisedKey(t *testing.T) {
	fc := &fakeChain{settler: false, totals: map[string]string{}}
	srv := httptest.NewServer(http.HandlerFunc(fc.handler))
	defer srv.Close()
	if _, err := NewSettler(context.Background(), SettlerConfig{RPCURL: srv.URL, PrivateKey: testSettlerKey, Contract: testContract}, nil); err == nil {
		t.Fatal("an unauthorised settler was accepted")
	}
}

// Board reads the total and each named wallet's score from the contract.
func TestSettlerReadsBoard(t *testing.T) {
	week := uint64(2958)
	key := StrategyKey("direction")
	wallet, _ := chain.ParseAddress("0x000000000000000000000000000000000000000a")
	word := func(v int64, n uint64) string {
		w1 := chain.Word(bigInt(v))
		w2 := chain.Word(n)
		return "0x" + hex.EncodeToString(w1[:]) + hex.EncodeToString(w2[:])
	}
	fc := &fakeChain{settler: true, totals: map[string]string{
		"0x" + hex.EncodeToString(chain.Encode("totalOf(uint64,bytes32)", week, key)):                 word(2_000000, 3),
		"0x" + hex.EncodeToString(chain.Encode("scoreOf(uint64,bytes32,address)", week, key, wallet)): word(-500000, 1),
	}}
	srv := httptest.NewServer(http.HandlerFunc(fc.handler))
	defer srv.Close()
	s, err := NewSettler(context.Background(), SettlerConfig{RPCURL: srv.URL, PrivateKey: testSettlerKey, Contract: testContract}, nil)
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.Board(context.Background(), week, "direction", []string{"0x000000000000000000000000000000000000000a", "0x000000000000000000000000000000000000000b", "480"})
	if err != nil {
		t.Fatal(err)
	}
	if b.PnL != fixed.FromInt(2) || b.Trades != 3 || b.Players != 1 || len(b.Top) != 1 || b.Top[0].PnL != fixed.MustParse("-0.5") {
		t.Fatalf("board = %+v", b)
	}
}
