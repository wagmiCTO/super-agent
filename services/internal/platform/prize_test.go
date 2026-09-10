package platform

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/chain"
	"github.com/wagmiCTO/super-agent/services/internal/eip712"
	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/store"
)

// fakeRPC is a JSON-RPC node with just enough state for the prize pool:
// the settler is authorised, the allowance is unlimited, pools and
// settlement flags are whatever the test puts in, every transaction mines
// at once. It keeps the raw transactions it was asked to send so a test can
// look for the calldata inside them.
type fakeRPC struct {
	mu       sync.Mutex
	pools    map[string]*big.Int // by hex(week||strategyKey)
	settled  map[string]bool
	sent     [][]byte
	failNext int
}

func newFakeRPC() *fakeRPC {
	return &fakeRPC{pools: map[string]*big.Int{}, settled: map[string]bool{}}
}

func poolKey(week uint64, strategy string) string {
	return hex.EncodeToString(chain.Encode("pool(uint64,bytes32)", week, StrategyKey(strategy))[4:])
}

func (f *fakeRPC) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID     any               `json:"id"`
		Method string            `json:"method"`
		Params []json.RawMessage `json:"params"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	reply := func(result any) {
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
	}
	fail := func(msg string) {
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "error": map[string]any{"code": -32000, "message": msg}})
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	switch req.Method {
	case "eth_chainId":
		reply("0x279f")
	case "eth_getTransactionCount":
		reply(fmt.Sprintf("0x%x", len(f.sent)))
	case "eth_gasPrice":
		reply("0x3b9aca00")
	case "eth_maxPriorityFeePerGas":
		reply("0x3b9aca00")
	case "eth_estimateGas":
		reply("0x186a0")
	case "eth_call":
		var call struct {
			Data string `json:"data"`
		}
		_ = json.Unmarshal(req.Params[0], &call)
		data, _ := hex.DecodeString(strings.TrimPrefix(call.Data, "0x"))
		var sel [4]byte
		copy(sel[:], data)
		word := func(v any) string { w := chain.Word(v); return "0x" + hex.EncodeToString(w[:]) }
		switch sel {
		case chain.Selector("settlers(address)"):
			reply(word(true))
		case chain.Selector("allowance(address,address)"):
			reply(word(new(big.Int).Lsh(big.NewInt(1), 200)))
		case chain.Selector("settled(uint64,bytes32)"):
			reply(word(f.settled[hex.EncodeToString(data[4:])]))
		case chain.Selector("pool(uint64,bytes32)"):
			v := f.pools[hex.EncodeToString(data[4:])]
			if v == nil {
				v = new(big.Int)
			}
			reply(word(v))
		default:
			fail("unexpected call " + hex.EncodeToString(sel[:]))
		}
	case "eth_sendRawTransaction":
		if f.failNext > 0 {
			f.failNext--
			fail("nonce too low")
			return
		}
		var s string
		_ = json.Unmarshal(req.Params[0], &s)
		raw, _ := hex.DecodeString(strings.TrimPrefix(s, "0x"))
		f.sent = append(f.sent, raw)
		h := eip712.Keccak256(raw)
		reply("0x" + hex.EncodeToString(h[:]))
	case "eth_getTransactionReceipt":
		reply(map[string]string{"status": "0x1", "blockNumber": "0x10", "gasUsed": "0x5208"})
	default:
		fail("unexpected method " + req.Method)
	}
}

func (f *fakeRPC) sentWith(calldata []byte) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, raw := range f.sent {
		if bytes.Contains(raw, calldata) {
			n++
		}
	}
	return n
}

const (
	testSettlerKey = "0x1111111111111111111111111111111111111111111111111111111111111111"
	testPool       = "0x19952068Ce2D25C672d71cD48775A9f43438f4E6"
	testToken      = "0xa9012a055bd4e0edff8ce09f960291c09d5322dc"
)

func newTestPrize(t *testing.T, rpc *fakeRPC, st *store.Store, perTrade int64) *Prize {
	t.Helper()
	srv := httptest.NewServer(rpc)
	t.Cleanup(srv.Close)
	p, err := NewPrize(context.Background(), PrizeConfig{RPCURL: srv.URL, PrivateKey: testSettlerKey, Contract: testPool, Token: testToken, PerTrade: big.NewInt(perTrade)}, st, nil)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

// Closed trades are owed to their week's pool per strategy; one flush sends
// one transaction per (week, strategy) carrying the sum.
func TestPrizeFundsPerStrategyInBatches(t *testing.T) {
	rpc := newFakeRPC()
	p := newTestPrize(t, rpc, nil, 100_000)
	at := time.Date(2035, 3, 10, 12, 0, 0, 0, time.UTC)
	p.OnClosed(Trade{Strategy: "direction", ClosedAt: at})
	p.OnClosed(Trade{Strategy: "direction", ClosedAt: at.Add(time.Minute)})
	p.OnClosed(Trade{Strategy: "rsi", ClosedAt: at})
	p.flush(context.Background())

	week := WeekOf(at)
	if n := rpc.sentWith(chain.Encode("fund(uint64,bytes32,uint256)", week, StrategyKey("direction"), big.NewInt(200_000))); n != 1 {
		t.Fatalf("direction funding transactions = %d, want 1 with the sum of both trades", n)
	}
	if n := rpc.sentWith(chain.Encode("fund(uint64,bytes32,uint256)", week, StrategyKey("rsi"), big.NewInt(100_000))); n != 1 {
		t.Fatalf("rsi funding transactions = %d, want 1", n)
	}
	if len(rpc.sent) != 2 {
		t.Fatalf("transactions sent = %d, want 2", len(rpc.sent))
	}
	if st := p.Stats(); st.Sent != 2 || st.Failed != 0 || st.Due != 0 {
		t.Fatalf("stats = %+v", st)
	}
	// Nothing owed any more: a second flush sends nothing.
	p.flush(context.Background())
	if len(rpc.sent) != 2 {
		t.Fatalf("second flush sent %d more transactions", len(rpc.sent)-2)
	}
}

// A failed funding transaction is owed again and goes out with the next flush.
func TestPrizeFundingRetriesAfterFailure(t *testing.T) {
	rpc := newFakeRPC()
	p := newTestPrize(t, rpc, nil, 100_000)
	at := time.Date(2035, 3, 10, 12, 0, 0, 0, time.UTC)
	p.OnClosed(Trade{Strategy: "ma-cross", ClosedAt: at})
	rpc.failNext = 1
	p.flush(context.Background())
	if len(rpc.sent) != 0 {
		t.Fatalf("a rejected transaction was counted as sent")
	}
	if st := p.Stats(); st.Failed != 1 || st.Due != 1 || st.LastError == "" {
		t.Fatalf("stats after failure = %+v", st)
	}
	p.OnClosed(Trade{Strategy: "ma-cross", ClosedAt: at})
	p.flush(context.Background())
	if n := rpc.sentWith(chain.Encode("fund(uint64,bytes32,uint256)", WeekOf(at), StrategyKey("ma-cross"), big.NewInt(200_000))); n != 1 {
		t.Fatalf("retry did not carry the owed amount plus the new trade")
	}
	if st := p.Stats(); st.Due != 0 || st.Sent != 1 {
		t.Fatalf("stats after retry = %+v", st)
	}
}

// With no funding per trade the pool is never touched.
func TestPrizeZeroPerTradeSendsNothing(t *testing.T) {
	rpc := newFakeRPC()
	p := newTestPrize(t, rpc, nil, 0)
	p.OnClosed(Trade{Strategy: "direction", ClosedAt: time.Now()})
	p.flush(context.Background())
	if len(rpc.sent) != 0 {
		t.Fatal("funded with per-trade 0")
	}
}

func testStoreForPrize(t *testing.T) *store.Store {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		url = os.Getenv("DATABASE_URL")
	}
	if url == "" {
		t.Skip("no TEST_DATABASE_URL")
	}
	s, err := store.Open(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
}

func testWallet(t *testing.T, n int) string {
	t.Helper()
	h := eip712.Keccak256([]byte(fmt.Sprintf("%s-%d-%d", t.Name(), n, time.Now().UnixNano())))
	return "0x" + hex.EncodeToString(h[:20])
}

func journalRoundTrip(t *testing.T, st *store.Store, wallet, strategy string, pnl fixed.D, at time.Time) {
	t.Helper()
	ctx := context.Background()
	id := fmt.Sprintf("%s-%d", wallet, at.UnixNano())
	fill := store.Fill{Side: "long", Size: fixed.FromInt(10), Price: fixed.MustParse("0.02")}
	if err := st.TradeOpened(ctx, wallet, strategy, "MON", id+"-o", fill, at.Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, err := st.TradeClosed(ctx, wallet, "MON", strategy, id+"-c", fill, pnl, "manual", at); err != nil {
		t.Fatal(err)
	}
}

// Once a week is over, its board decides the split: 50/30/20 of the pool to
// the top three with a positive result, published in one settle call and
// journaled so the app can show each wallet its prize.
func TestPrizeSettlesLastWeekFromTheJournal(t *testing.T) {
	st := testStoreForPrize(t)
	rpc := newFakeRPC()
	p := newTestPrize(t, rpc, st, 100_000)
	// A week nobody else's test writes into.
	now := time.Date(2035, 3, 10, 12, 0, 0, 0, time.UTC)
	p.now = func() time.Time { return now }
	last := WeekOf(now) - 1
	closedAt := WeekStart(last).Add(time.Hour)

	w := []string{testWallet(t, 1), testWallet(t, 2), testWallet(t, 3), testWallet(t, 4)}
	journalRoundTrip(t, st, w[0], "direction", fixed.MustParse("3"), closedAt)
	journalRoundTrip(t, st, w[1], "direction", fixed.MustParse("1"), closedAt)
	journalRoundTrip(t, st, w[1], "direction", fixed.MustParse("1"), closedAt.Add(time.Minute))
	journalRoundTrip(t, st, w[2], "direction", fixed.MustParse("0.5"), closedAt)
	journalRoundTrip(t, st, w[3], "direction", fixed.MustParse("-1"), closedAt) // no prize for a loss
	// This week's trades do not count for last week.
	journalRoundTrip(t, st, w[3], "direction", fixed.MustParse("9"), now)

	rpc.pools[poolKey(last, "direction")] = big.NewInt(1_000_000)
	rpc.settled[poolKey(last, "rsi")] = true // already done: skipped
	p.settleDue(context.Background())

	if len(rpc.sent) != 1 {
		t.Fatalf("transactions sent = %d, want exactly the direction settlement", len(rpc.sent))
	}
	a1, _ := chain.ParseAddress(w[0])
	a2, _ := chain.ParseAddress(w[1])
	a3, _ := chain.ParseAddress(w[2])
	want := chain.EncodeCall("settle(uint64,bytes32,address[],uint256[],int128[])",
		[][32]byte{chain.Word(last), StrategyKey("direction")},
		[][][32]byte{
			{chain.Word(a1), chain.Word(a2), chain.Word(a3)},
			{chain.Word(big.NewInt(500_000)), chain.Word(big.NewInt(300_000)), chain.Word(big.NewInt(200_000))},
			{chain.Word(big.NewInt(3_000_000)), chain.Word(big.NewInt(2_000_000)), chain.Word(big.NewInt(500_000))},
		})
	if rpc.sentWith(want) != 1 {
		t.Fatalf("settle calldata not found in the sent transaction:\nwant %x", want)
	}
	recs, err := st.PrizesFor(context.Background(), w[1])
	if err != nil {
		t.Fatal(err)
	}
	if len(recs) != 1 || recs[0].Amount != "300000" || recs[0].Week != last || recs[0].Strategy != "direction" {
		t.Fatalf("journaled prize for second place = %+v", recs)
	}
	if recs, _ := st.PrizesFor(context.Background(), w[3]); len(recs) != 0 {
		t.Fatalf("a losing wallet was journaled a prize: %+v", recs)
	}

	// Settled now: the next pass sends nothing.
	rpc.settled[poolKey(last, "direction")] = true
	p.settleDue(context.Background())
	if len(rpc.sent) != 1 {
		t.Fatal("settled a week twice")
	}
}

// An empty pool has nothing to split; the week stays unsettled on-chain.
func TestPrizeSkipsEmptyPools(t *testing.T) {
	st := testStoreForPrize(t)
	rpc := newFakeRPC()
	p := newTestPrize(t, rpc, st, 100_000)
	now := time.Date(2036, 1, 20, 12, 0, 0, 0, time.UTC)
	p.now = func() time.Time { return now }
	journalRoundTrip(t, st, testWallet(t, 1), "rsi", fixed.MustParse("2"), WeekStart(WeekOf(now)-1).Add(time.Hour))
	p.settleDue(context.Background())
	if len(rpc.sent) != 0 {
		t.Fatalf("settled an unfunded week: %d transactions", len(rpc.sent))
	}
}
