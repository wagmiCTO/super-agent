package platform

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wagmiCTO/super-agent/services/internal/deposit"
)

// fakeAurora plays the deposits API: a small catalog, a quote that echoes
// its input and reserves an address unless dry, and a status.
type fakeAurora struct {
	lastQuote map[string]any
}

func (f *fakeAurora) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case strings.HasPrefix(r.URL.Path, "/api/tokens/key"):
		_, _ = w.Write([]byte(`{"tokens":[
			{"assetId":"usdc.base","decimals":6,"blockchain":"base","symbol":"USDC","price":0.9998,"contractAddress":"0x8335"},
			{"assetId":"eth.base","decimals":18,"blockchain":"base","symbol":"ETH","price":2500},
			{"assetId":"sol.sol","decimals":9,"blockchain":"sol","symbol":"SOL","price":150},
			{"assetId":"usdt0.plasma.old","decimals":6,"blockchain":"plasma","symbol":"USDT0(DEPRECATED)","price":1},
			{"assetId":"usdc.monad","decimals":6,"blockchain":"monad","symbol":"USDC","price":0.9998,"contractAddress":"0x7547"},
			{"assetId":"mon.monad","decimals":18,"blockchain":"monad","symbol":"MON","price":0.023}
		]}`))
	case strings.HasPrefix(r.URL.Path, "/api/quote/key"):
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.lastQuote = body
		if body["amount"] == "1" {
			w.WriteHeader(400)
			_, _ = w.Write([]byte(`{"message":"Temporary swap limits: minimum swap amount is $1,000"}`))
			return
		}
		addr := "0xdeposit"
		if body["dry"] == true {
			addr = ""
		}
		_, _ = w.Write([]byte(`{"correlationId":"c1","quote":{"timeEstimate":37,"deadline":"2026-09-11T12:00:00Z","depositAddress":"` + addr + `","amountIn":"1100000000","amountInFormatted":"1100.0","amountInUsd":"1099.75","amountOut":"1099673506","amountOutFormatted":"1099.673506","amountOutUsd":"1099.43","minAmountOut":"1088676770"}}`))
	case strings.HasPrefix(r.URL.Path, "/api/status/key"):
		if r.URL.Query().Get("depositAddress") != "0xdeposit" {
			w.WriteHeader(404)
			_, _ = w.Write([]byte(`{"message":"unknown deposit"}`))
			return
		}
		_, _ = w.Write([]byte(`{"status":"SUCCESS","updatedAt":"2026-09-11T10:00:00Z","swapDetails":{"amountIn":"1100000000","amountOut":"1099673506","originChainTxHashes":[{"hash":"0xin"}],"destinationChainTxHashes":[{"hash":"0xout"}]}}`))
	default:
		http.Error(w, "no such endpoint", 404)
	}
}

func newTestDeposits(t *testing.T) (*Deposits, *fakeAurora) {
	t.Helper()
	fake := &fakeAurora{}
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	a, err := deposit.NewAurora("key", srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	return NewDeposits(a, DepositConfig{DestinationAsset: "usdc.monad", FeeRecipient: "0x00000000000000000000000000000000000000fe", FeeBps: 10}, nil), fake
}

// Options are EVM-chain assets only (the wallet is the refund address),
// without the destination itself or deprecated listings, stables first.
func TestDepositOptions(t *testing.T) {
	d, _ := newTestDeposits(t)
	opts, dest, err := d.Options(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if dest.Symbol != "USDC" || dest.Chain != "monad" || dest.Decimals != 6 {
		t.Fatalf("destination = %+v", dest)
	}
	var ids []string
	for _, o := range opts {
		ids = append(ids, o.AssetID)
	}
	if got := strings.Join(ids, ","); got != "usdc.base,eth.base,mon.monad" {
		t.Fatalf("options = %s", got)
	}
	if opts[0].ChainName != "Base" || opts[0].Decimals != 6 {
		t.Fatalf("first option = %+v", opts[0])
	}
}

// A quote goes to the wallet and refunds to it, carries the platform fee,
// and reserves a deposit address unless dry. Aurora's refusals come back
// as their own words.
func TestDepositQuoteAndStatus(t *testing.T) {
	d, fake := newTestDeposits(t)
	const wallet = "0x9d40ff7a8781c67139a81b82e0547bce563b54b9"
	q, err := d.Quote(context.Background(), "usdc.base", "1100000000", wallet, false)
	if err != nil {
		t.Fatal(err)
	}
	if q.DepositAddress != "0xdeposit" || q.AmountOut != "1099.673506" || q.TimeEstimateSec != 37 || q.Dry {
		t.Fatalf("quote = %+v", q)
	}
	if fake.lastQuote["recipient"] != wallet || fake.lastQuote["refundTo"] != wallet || fake.lastQuote["destinationAsset"] != "usdc.monad" {
		t.Fatalf("aurora was asked %+v", fake.lastQuote)
	}
	fees, _ := fake.lastQuote["appFees"].([]any)
	if len(fees) != 1 {
		t.Fatalf("app fees = %v", fake.lastQuote["appFees"])
	}
	dry, err := d.Quote(context.Background(), "usdc.base", "1100000000", wallet, true)
	if err != nil || dry.DepositAddress != "" || !dry.Dry {
		t.Fatalf("dry quote: %v %+v", err, dry)
	}
	if _, err := d.Quote(context.Background(), "usdc.base", "1", wallet, true); err == nil || !isPartnerError(err) || !strings.Contains(partnerMessage(err), "minimum swap amount") {
		t.Fatalf("minimum: %v", err)
	}
	if _, err := d.Quote(context.Background(), "usdc.base", "1", "nope", true); err == nil {
		t.Fatal("bad wallet accepted")
	}
	s, err := d.Status(context.Background(), "0xdeposit")
	if err != nil || s.Status != "SUCCESS" || len(s.TxHashes) != 2 || s.AmountOut != "1099673506" {
		t.Fatalf("status: %v %+v", err, s)
	}
	if _, err := d.Status(context.Background(), "0xnope"); err == nil || !isPartnerError(err) {
		t.Fatalf("unknown deposit: %v", err)
	}
}
