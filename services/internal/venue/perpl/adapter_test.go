package perpl

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

// loadContext reads a real /v1/pub/context response captured from testnet on
// 2026-09-08. Translating it is where a venue's conventions either stay behind
// the adapter or leak into the engine.
func loadContext(t *testing.T) *contextResponse {
	t.Helper()
	b, err := os.ReadFile("testdata/context-testnet.json")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var out contextResponse
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	return &out
}

func adapterWith(t *testing.T, res *contextResponse) *Adapter {
	t.Helper()
	a := &Adapter{
		cfg:             Config{Network: Testnet},
		markets:         make(map[string]market),
		byID:            make(map[int]market),
		orderIDByClient: make(map[string]uint64),
		clientByReq:     make(map[uint64]string),
	}
	for _, m := range res.Markets {
		a.markets[m.ticker()] = m
		a.byID[m.ID] = m
	}
	for _, tk := range res.Tokens {
		if tk.ID == res.Instances[0].CollateralTokenID {
			a.collateral = tk
		}
	}
	return a
}

func TestMarketTranslation(t *testing.T) {
	res := loadContext(t)
	a := adapterWith(t, res)

	tests := []struct {
		symbol      string
		venueID     string
		maxLeverage string
		liqLeverage string
		priceTick   string
		sizeStep    string
		takerBps    string
		makerBps    string
	}{
		{"BTC", "16", "15", "25", "0.1", "0.00001", "6.9", "0.9"},
		{"ETH", "32", "12", "20", "0.01", "0.001", "6.9", "0.9"},
		{"SOL", "48", "10", "20", "0.01", "0.001", "6.9", "0.9"},
		{"MON", "64", "3", "5", "0.00001", "1", "6.9", "0.9"},
		{"ZEC", "256", "3", "10", "0.001", "0.001", "6.9", "0.9"},
	}
	for _, tc := range tests {
		t.Run(tc.symbol, func(t *testing.T) {
			m, ok := a.markets[tc.symbol]
			if !ok {
				t.Fatalf("fixture has no %s market", tc.symbol)
			}
			got, err := a.toVenueMarket(m)
			if err != nil {
				t.Fatalf("toVenueMarket: %v", err)
			}
			if got.VenueID != tc.venueID {
				t.Errorf("VenueID = %s, want %s", got.VenueID, tc.venueID)
			}
			if want := fixed.MustParse(tc.maxLeverage); got.MaxLeverage != want {
				t.Errorf("MaxLeverage = %s, want %s", got.MaxLeverage, want)
			}
			if want := fixed.MustParse(tc.liqLeverage); got.LiquidationLeverage != want {
				t.Errorf("LiquidationLeverage = %s, want %s", got.LiquidationLeverage, want)
			}
			if want := fixed.MustParse(tc.priceTick); got.PriceTick != want {
				t.Errorf("PriceTick = %s, want %s", got.PriceTick, want)
			}
			if want := fixed.MustParse(tc.sizeStep); got.SizeStep != want {
				t.Errorf("SizeStep = %s, want %s", got.SizeStep, want)
			}
			if want := fixed.MustParse(tc.takerBps); got.Fees.TakerRate.InBps() != want {
				t.Errorf("TakerRate = %s bps, want %s", got.Fees.TakerRate.InBps(), want)
			}
			if want := fixed.MustParse(tc.makerBps); got.Fees.MakerRate.InBps() != want {
				t.Errorf("MakerRate = %s bps, want %s", got.Fees.MakerRate.InBps(), want)
			}
			if got.Fees.ChargedOn != venue.FeeOnOpen {
				t.Errorf("ChargedOn = %s, want open-only", got.Fees.ChargedOn)
			}
			// 20 blocks at ~302 ms is about six seconds — short enough
			// that the engine has to know about it.
			if got.OrderTTL < 5*time.Second || got.OrderTTL > 7*time.Second {
				t.Errorf("OrderTTL = %s, want about 6s", got.OrderTTL)
			}
		})
	}
}

// The testnet fixture carries a non-zero recycle_fee, which is a real cost on
// every posted maker order and therefore part of the fee schedule.
func TestPostingFeeFromRecycleFee(t *testing.T) {
	a := adapterWith(t, loadContext(t))
	m := a.markets["BTC"]
	got, err := a.toVenueMarket(m)
	if err != nil {
		t.Fatalf("toVenueMarket: %v", err)
	}
	if want := fixed.MustParse("0.1"); got.Fees.PostingFee != want {
		t.Errorf("PostingFee = %s AUSD, want %s", got.Fees.PostingFee, want)
	}
}

// Amount strings are integers scaled by the collateral token's decimals, not
// decimal strings. Reading them as decimals would be wrong by a millionfold.
func TestParseAmount(t *testing.T) {
	a := adapterWith(t, loadContext(t))
	tests := []struct {
		in   string
		want string
	}{
		{"100000000", "100"}, // min_account_open_amount: 100 AUSD
		{"10000000", "10"},   // min_deposit_amount
		{"100000", "0.1"},    // recycle_fee
		{"", "0"},
	}
	for _, tc := range tests {
		got, err := a.parseAmount(tc.in)
		if err != nil {
			t.Fatalf("parseAmount(%q): %v", tc.in, err)
		}
		if want := fixed.MustParse(tc.want); got != want {
			t.Errorf("parseAmount(%q) = %s, want %s", tc.in, got, want)
		}
	}
}

func TestFeeTierSelection(t *testing.T) {
	a := adapterWith(t, loadContext(t))
	cfg := a.markets["BTC"].Config

	tests := []struct {
		name  string
		tier  int
		maker bool
		want  int64
	}{
		{"base taker", 0, false, 690},
		{"tier 3 taker", 3, false, 420},
		{"top taker tier", 7, false, 0},
		{"base maker", 0, true, 90},
		{"tier 2 maker", 2, true, 30},
		{"tier beyond the array falls back to base", 99, false, 690},
		{"negative tier falls back to base", -1, true, 90},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := cfg.feeMicros(tc.tier, tc.maker); got != tc.want {
				t.Errorf("feeMicros(%d, maker=%v) = %d, want %d", tc.tier, tc.maker, got, tc.want)
			}
		})
	}
}

func TestOrderTypeMapping(t *testing.T) {
	tests := []struct {
		name   string
		side   venue.Side
		reduce bool
		want   int
	}{
		{"open long", venue.Long, false, orderOpenLong},
		{"open short", venue.Short, false, orderOpenShort},
		{"close long", venue.Long, true, orderCloseLong},
		{"close short", venue.Short, true, orderCloseShort},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := orderType(tc.side, tc.reduce); got != tc.want {
				t.Errorf("orderType = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestOrderFlags(t *testing.T) {
	tests := []struct {
		name string
		req  venue.OrderRequest
		want int
	}{
		{"market order defaults to IOC", venue.OrderRequest{}, flagImmediateOrCancel},
		{"limit order defaults to GTC", venue.OrderRequest{Price: fixed.FromInt(100)}, flagGoodTillCancel},
		{"post only", venue.OrderRequest{Price: fixed.FromInt(100), TimeInForce: venue.PostOnly}, flagPostOnly},
		{"fill or kill", venue.OrderRequest{TimeInForce: venue.FillOrKill}, flagFillOrKill},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := orderFlags(tc.req); got != tc.want {
				t.Errorf("orderFlags = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestSlippageClampedToMarketCeiling(t *testing.T) {
	a := adapterWith(t, loadContext(t))
	mon := a.markets["MON"] // order_max_market_slippage_bps = 100
	btc := a.markets["BTC"] // 1000

	tests := []struct {
		name string
		slip string
		m    market
		want int
	}{
		{"within ceiling", "0.005", btc, 50},
		{"above the market ceiling is clamped", "0.05", mon, 100},
		{"zero means venue default", "0", btc, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := slippageBps(fixed.MustParse(tc.slip), tc.m); got != tc.want {
				t.Errorf("slippageBps = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestBuilderRate(t *testing.T) {
	tests := []struct {
		per100k int
		want    string
	}{
		{0, "0"},
		{1, "0.00001"}, // 0.1 bps
		{10, "0.0001"}, // 1 bp
		{100, "0.001"}, // 10 bps, the protocol ceiling
	}
	for _, tc := range tests {
		if got, want := builderRate(tc.per100k), fixed.MustParse(tc.want); got != want {
			t.Errorf("builderRate(%d) = %s, want %s", tc.per100k, got, want)
		}
	}
}

// A market order on MON must round to whole units: size_decimals is zero there,
// and a fractional size would be rejected or silently truncated by the venue.
func TestSizeStepRounding(t *testing.T) {
	a := adapterWith(t, loadContext(t))
	tests := []struct {
		symbol string
		size   string
		want   string
	}{
		{"MON", "1234.9", "1234"},
		{"BTC", "0.00001234", "0.00001"},
		{"ETH", "1.23456", "1.234"},
	}
	for _, tc := range tests {
		t.Run(tc.symbol, func(t *testing.T) {
			m := a.markets[tc.symbol]
			got := fixed.MustParse(tc.size).RoundDownTo(tickFor(m.Config.SizeDecimals))
			if want := fixed.MustParse(tc.want); got != want {
				t.Errorf("rounded size = %s, want %s", got, want)
			}
		})
	}
}
