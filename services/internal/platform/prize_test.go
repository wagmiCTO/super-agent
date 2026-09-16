package platform

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"math/rand/v2"
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

func newTestPrize(t *testing.T, rpc *fakeRPC, st *store.Store, share int) *Prize {
	t.Helper()
	srv := httptest.NewServer(rpc)
	t.Cleanup(srv.Close)
	p, err := NewPrize(context.Background(), PrizeConfig{RPCURL: srv.URL, PrivateKey: testSettlerKey, Contract: testPool, Token: testToken, FeeShare: share}, st, nil)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

// A receipt funds each pool with what it accrued, or its share of what was
// received when less arrived: the contract never holds more than the
// platform was paid.
func TestAllocateNeverExceedsWhatArrived(t *testing.T) {
	accrued := map[string]*big.Int{"direction": big.NewInt(600_000), "rsi": big.NewInt(400_000)}
	full := allocate(accrued, big.NewInt(2_000_000))
	if full["direction"].Int64() != 600_000 || full["rsi"].Int64() != 400_000 {
		t.Fatalf("with more than enough received, pools should get what they accrued: %v", full)
	}
	short := allocate(accrued, big.NewInt(500_000))
	if short["direction"].Int64() != 300_000 || short["rsi"].Int64() != 200_000 {
		t.Fatalf("with half received, pools should get half of what they accrued: %v", short)
	}
	if n := len(allocate(map[string]*big.Int{}, big.NewInt(500_000))); n != 0 {
		t.Fatalf("nothing accrued funds nothing, got %d pools", n)
	}
}

// A week still running has no receipt: its fees are not in yet.
func TestReceiveRefusesARunningWeek(t *testing.T) {
	rpc := newFakeRPC()
	p := newTestPrize(t, rpc, nil, 50)
	if _, err := p.Receive(context.Background(), WeekOf(p.now()), big.NewInt(1)); !errors.Is(err, ErrWeekNotOver) {
		t.Fatalf("receipt for the current week: err = %v, want ErrWeekNotOver", err)
	}
	if _, err := p.Receive(context.Background(), WeekOf(p.now())-1, big.NewInt(-1)); err == nil {
		t.Fatal("a negative receipt was accepted")
	}
	if len(rpc.sent) != 0 {
		t.Fatal("a refused receipt sent a transaction")
	}
}

// A finished week's receipt funds each strategy's pool with half of the
// builder fees its round trips paid, and settles the week from the board;
// a second receipt for the same week is refused before anything is sent.
func TestReceiveFundsWhatTheWeekEarnedAndSettles(t *testing.T) {
	st := testStoreForPrize(t)
	rpc := newFakeRPC()
	p := newTestPrize(t, rpc, st, 50)
	now := time.Date(2035, 3, 10, 12, 0, 0, 0, time.UTC).Add(time.Duration(rand.IntN(20000)) * 7 * 24 * time.Hour)
	p.now = func() time.Time { return now }
	last := WeekOf(now) - 1
	closedAt := WeekStart(last).Add(time.Hour)

	w := []string{testWallet(t, 1), testWallet(t, 2)}
	// 0.1 builder fee on each leg: 0.2 per round trip, 0.1 to the pool.
	journalPaidRoundTrip(t, st, w[0], "direction", fixed.MustParse("2"), fixed.MustParse("0.1"), closedAt)
	journalPaidRoundTrip(t, st, w[1], "direction", fixed.MustParse("1"), fixed.MustParse("0.1"), closedAt.Add(time.Minute))
	journalPaidRoundTrip(t, st, w[1], "rsi", fixed.MustParse("1"), fixed.MustParse("0.05"), closedAt)
	// The platform's own account pays no builder fee and accrues nothing.
	journalPaidRoundTrip(t, st, w[0], "ma-cross", fixed.MustParse("1"), 0, closedAt)

	accrued, err := p.Accrued(context.Background(), last)
	if err != nil {
		t.Fatal(err)
	}
	if accrued["direction"].Int64() != 200_000 || accrued["rsi"].Int64() != 50_000 || accrued["ma-cross"] != nil {
		t.Fatalf("accrued = %v", accrued)
	}

	// The pools show the funding once it lands, so the settlement can split it.
	rpc.pools[poolKey(last, "direction")] = big.NewInt(200_000)
	rpc.pools[poolKey(last, "rsi")] = big.NewInt(50_000)
	rec, err := p.Receive(context.Background(), last, big.NewInt(250_000))
	if err != nil {
		t.Fatal(err)
	}
	if n := rpc.sentWith(chain.Encode("fund(uint64,bytes32,uint256)", last, StrategyKey("direction"), big.NewInt(200_000))); n != 1 {
		t.Fatalf("direction funding transactions = %d, want 1", n)
	}
	if n := rpc.sentWith(chain.Encode("fund(uint64,bytes32,uint256)", last, StrategyKey("rsi"), big.NewInt(50_000))); n != 1 {
		t.Fatalf("rsi funding transactions = %d, want 1", n)
	}
	if len(rec.Settled) != 2 || len(rpc.sent) != 4 {
		t.Fatalf("settled %v, transactions %d; want both strategies settled after two fundings", rec.Settled, len(rpc.sent))
	}
	recs, err := st.PrizesFor(context.Background(), w[0])
	if err != nil {
		t.Fatal(err)
	}
	// The journal persists between runs; only this week's record is ours.
	var mine []store.PrizeRecord
	for _, r := range recs {
		if r.Week == last {
			mine = append(mine, r)
		}
	}
	if len(mine) != 1 || mine[0].Amount != "100000" {
		t.Fatalf("first place on direction should hold half the pool: %+v", mine)
	}

	if _, err := p.Receive(context.Background(), last, big.NewInt(250_000)); !errors.Is(err, ErrReceiptExists) {
		t.Fatalf("second receipt: err = %v, want ErrReceiptExists", err)
	}
	if len(rpc.sent) != 4 {
		t.Fatal("a second receipt sent transactions")
	}
	if got, ok, _ := st.Receipt(context.Background(), last); !ok || got.Amount != fixed.MustParse("0.25") {
		t.Fatalf("receipt on record = %+v (%v)", got, ok)
	}
}

// journalPaidRoundTrip is journalRoundTrip with a builder fee on each leg.
func journalPaidRoundTrip(t *testing.T, st *store.Store, wallet, strategy string, pnl, builderFee fixed.D, at time.Time) {
	t.Helper()
	ctx := context.Background()
	id := fmt.Sprintf("%s-%d", wallet, at.UnixNano())
	fill := store.Fill{Side: "long", Size: fixed.FromInt(10), Price: fixed.MustParse("0.02"), BuilderFee: builderFee}
	if err := st.TradeOpened(ctx, wallet, strategy, "MON", id+"-o", fill, store.Terms{}, at.Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, err := st.TradeClosed(ctx, wallet, "MON", strategy, id+"-c", fill, pnl, "manual", store.Excursion{}, at); err != nil {
		t.Fatal(err)
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
	if err := st.TradeOpened(ctx, wallet, strategy, "MON", id+"-o", fill, store.Terms{}, at.Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, err := st.TradeClosed(ctx, wallet, "MON", strategy, id+"-c", fill, pnl, "manual", store.Excursion{}, at); err != nil {
		t.Fatal(err)
	}
}

// Once a week is over, its board decides the split: 50/30/20 of the pool to
// the top three with a positive result, published in one settle call and
// journaled so the app can show each wallet its prize.
func TestPrizeSettlesLastWeekFromTheJournal(t *testing.T) {
	st := testStoreForPrize(t)
	rpc := newFakeRPC()
	p := newTestPrize(t, rpc, st, 50)
	// A week nobody else's test writes into, and no earlier run of this one:
	// the journal persists between runs.
	now := time.Date(2035, 3, 10, 12, 0, 0, 0, time.UTC).Add(time.Duration(rand.IntN(20000)) * 7 * 24 * time.Hour)
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
		rows, _ := st.Boards(context.Background(), WeekStart(last), WeekStart(last+1), 10)
		t.Fatalf("settle calldata not found in the sent transaction:\nwant %x\nsent %x\nboard %+v", want, rpc.sent, rows["direction"])
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
	p := newTestPrize(t, rpc, st, 50)
	now := time.Date(2036, 1, 20, 12, 0, 0, 0, time.UTC).Add(time.Duration(rand.IntN(20000)) * 7 * 24 * time.Hour)
	p.now = func() time.Time { return now }
	journalRoundTrip(t, st, testWallet(t, 1), "rsi", fixed.MustParse("2"), WeekStart(WeekOf(now)-1).Add(time.Hour))
	p.settleDue(context.Background())
	if len(rpc.sent) != 0 {
		t.Fatalf("settled an unfunded week: %d transactions", len(rpc.sent))
	}
}
