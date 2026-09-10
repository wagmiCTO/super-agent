package platform

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/deposit"
)

// Deposits is "fund the wallet from any chain" over Aurora Intents: the
// app picks an origin asset and an amount, the platform quotes and returns
// a one-time deposit address, the user sends from wherever they hold the
// asset, and Aurora delivers the destination asset to the wallet on Monad.
//
// Refunds go back to the sender's address on the origin chain. The app
// sends the wallet's own address as the refund address, which is only
// right on EVM chains, so the origin list is EVM chains only.
type Deposits struct {
	aurora      *deposit.Aurora
	destination string // asset id delivered to the wallet
	feeTo       string
	feeBps      int
	log         *slog.Logger
	now         func() time.Time

	mu       sync.Mutex
	tokens   []deposit.Token
	fetched  time.Time
	tokenTTL time.Duration
}

// DepositConfig wires deposits.
type DepositConfig struct {
	// DestinationAsset is Aurora's asset id for what lands in the wallet
	// (USDC on Monad by default).
	DestinationAsset string
	// FeeRecipient and FeeBps add the platform's fee to every deposit;
	// empty adds none.
	FeeRecipient string
	FeeBps       int
}

// DefaultDestinationAsset is USDC on Monad in Aurora's catalog.
const DefaultDestinationAsset = "nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx"

// evmChains are the origin chains where the wallet's address is also a
// valid refund address.
var evmChains = map[string]string{
	"eth": "Ethereum", "base": "Base", "arb": "Arbitrum", "op": "Optimism", "pol": "Polygon", "bsc": "BNB Chain",
	"avax": "Avalanche", "gnosis": "Gnosis", "scroll": "Scroll", "bera": "Berachain", "monad": "Monad", "xlayer": "X Layer",
	"plasma": "Plasma", "abs": "Abstract", "hypercore": "Hyperliquid",
}

func NewDeposits(a *deposit.Aurora, cfg DepositConfig, log *slog.Logger) *Deposits {
	if log == nil {
		log = slog.Default()
	}
	if cfg.DestinationAsset == "" {
		cfg.DestinationAsset = DefaultDestinationAsset
	}
	return &Deposits{aurora: a, destination: cfg.DestinationAsset, feeTo: cfg.FeeRecipient, feeBps: cfg.FeeBps, log: log, now: time.Now, tokenTTL: time.Hour}
}

// DepositOption is one thing a user can send.
type DepositOption struct {
	AssetID   string
	Chain     string
	ChainName string
	Symbol    string
	Decimals  int
	PriceUSD  float64
}

// Destination is what arrives.
type Destination struct {
	AssetID  string
	Chain    string
	Symbol   string
	Decimals int
}

func (d *Deposits) catalog(ctx context.Context) ([]deposit.Token, error) {
	d.mu.Lock()
	if d.tokens != nil && d.now().Sub(d.fetched) < d.tokenTTL {
		t := d.tokens
		d.mu.Unlock()
		return t, nil
	}
	d.mu.Unlock()
	tokens, err := d.aurora.Tokens(ctx)
	if err != nil {
		return nil, err
	}
	d.mu.Lock()
	d.tokens, d.fetched = tokens, d.now()
	d.mu.Unlock()
	return tokens, nil
}

// Options lists what can be deposited and what arrives.
func (d *Deposits) Options(ctx context.Context) ([]DepositOption, Destination, error) {
	tokens, err := d.catalog(ctx)
	if err != nil {
		return nil, Destination{}, err
	}
	var dest Destination
	var out []DepositOption
	for _, t := range tokens {
		if t.AssetID == d.destination {
			dest = Destination{AssetID: t.AssetID, Chain: t.Blockchain, Symbol: t.Symbol, Decimals: t.Decimals}
		}
		name, ok := evmChains[t.Blockchain]
		if !ok || t.AssetID == d.destination || strings.Contains(t.Symbol, "DEPRECATED") {
			continue
		}
		out = append(out, DepositOption{AssetID: t.AssetID, Chain: t.Blockchain, ChainName: name, Symbol: t.Symbol, Decimals: t.Decimals, PriceUSD: t.Price})
	}
	if dest.AssetID == "" {
		return nil, Destination{}, fmt.Errorf("platform: destination asset %s is not in Aurora's catalog", d.destination)
	}
	// Stablecoins and majors first, then by chain name.
	rank := func(o DepositOption) int {
		switch strings.ToUpper(o.Symbol) {
		case "USDC":
			return 0
		case "USDT", "USDT0":
			return 1
		case "ETH", "WETH":
			return 2
		}
		return 3
	}
	sort.SliceStable(out, func(i, j int) bool {
		if rank(out[i]) != rank(out[j]) {
			return rank(out[i]) < rank(out[j])
		}
		return out[i].ChainName < out[j].ChainName
	})
	return out, dest, nil
}

// DepositQuote is what the app shows: send this much here, this arrives.
type DepositQuote struct {
	DepositAddress  string
	OriginAsset     string
	AmountIn        string
	AmountInUSD     string
	AmountOut       string
	AmountOutUSD    string
	MinAmountOut    string
	TimeEstimateSec int
	Deadline        time.Time
	Dry             bool
}

// Quote asks Aurora for a deposit of amount (smallest units of the origin
// asset) into wallet. Dry quotes reserve nothing and are for previews.
func (d *Deposits) Quote(ctx context.Context, originAsset, amount, wallet string, dry bool) (DepositQuote, error) {
	if !isAddress(strings.TrimSpace(wallet)) {
		return DepositQuote{}, fmt.Errorf("%w: wallet must be 0x followed by 40 hex characters", ErrInvalid)
	}
	if strings.TrimSpace(originAsset) == "" || strings.TrimSpace(amount) == "" {
		return DepositQuote{}, fmt.Errorf("%w: origin_asset and amount are required", ErrInvalid)
	}
	q, err := d.aurora.Quote(ctx, deposit.QuoteRequest{
		Dry: dry, OriginAsset: originAsset, DestinationAsset: d.destination, Amount: amount,
		Recipient: wallet, RefundTo: wallet, SlippageBps: 100, Deadline: d.now().Add(2 * time.Hour),
		AppFeeRecipient: d.feeTo, AppFeeBps: d.feeBps,
	})
	if err != nil {
		return DepositQuote{}, err
	}
	if !dry {
		d.log.Info("deposit quoted", "wallet", strings.ToLower(wallet), "origin", originAsset, "amount_in_usd", q.AmountInUSD, "amount_out", q.AmountOutFormatted, "deposit_address", q.DepositAddress)
	}
	return DepositQuote{
		DepositAddress: q.DepositAddress, OriginAsset: originAsset, AmountIn: q.AmountInFormatted, AmountInUSD: q.AmountInUSD,
		AmountOut: q.AmountOutFormatted, AmountOutUSD: q.AmountOutUSD, MinAmountOut: q.MinAmountOut,
		TimeEstimateSec: q.TimeEstimateSec, Deadline: q.Deadline, Dry: dry,
	}, nil
}

// DepositStatus is where a deposit stands.
type DepositStatus struct {
	Status    string
	UpdatedAt time.Time
	AmountIn  string
	AmountOut string
	TxHashes  []string
}

// Status reports a deposit by its address.
func (d *Deposits) Status(ctx context.Context, depositAddress string) (DepositStatus, error) {
	if strings.TrimSpace(depositAddress) == "" {
		return DepositStatus{}, fmt.Errorf("%w: deposit_address is required", ErrInvalid)
	}
	s, err := d.aurora.Status(ctx, depositAddress)
	if err != nil {
		return DepositStatus{}, err
	}
	out := DepositStatus{Status: s.Status, UpdatedAt: s.UpdatedAt, AmountIn: s.Details.AmountIn, AmountOut: s.Details.AmountOut}
	for _, tx := range append(s.Details.OriginTxHashes, s.Details.DestinationTxRef...) {
		out.TxHashes = append(out.TxHashes, tx.Hash)
	}
	return out, nil
}
