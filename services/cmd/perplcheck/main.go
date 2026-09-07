// Command perplcheck walks the Perpl integration end to end and prints what it
// finds: markets and their real fee schedules, candle history, live market
// data, and — only when asked — one round trip through the exchange.
//
// It is the integration gate: a trade goes through on Perpl testnet from a
// script. Run it without -trade first; it needs no credentials for anything but
// the last stage.
//
//	go run ./cmd/perplcheck
//	go run ./cmd/perplcheck -symbol ETH -candles
//	go run ./cmd/perplcheck -trade -notional 100
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
	"github.com/wagmiCTO/super-agent/services/internal/venue/perpl"
)

func main() {
	var (
		symbol   = flag.String("symbol", "BTC", "market to inspect")
		notional = flag.Float64("notional", 20, "position size in collateral units for -trade")
		leverage = flag.Int("leverage", 2, "leverage for -trade")
		doTrade  = flag.Bool("trade", false, "place a real order: open a position and close it again")
		doStream = flag.Bool("stream", false, "watch live candles and book for a few seconds")
		verbose  = flag.Bool("v", false, "debug logging")
	)
	flag.Parse()

	level := slog.LevelInfo
	if *verbose {
		level = slog.LevelDebug
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level}))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, log, *symbol, *notional, *leverage, *doTrade, *doStream); err != nil {
		fmt.Fprintf(os.Stderr, "\nFAILED: %v\n", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, log *slog.Logger, symbol string, notional float64, leverage int, doTrade, doStream bool) error {
	cfg, err := perpl.ConfigFromEnv()
	if err != nil {
		return err
	}
	section("network")
	fmt.Printf("  %s  chain %d\n  api %s\n  exchange %s\n",
		cfg.Network.Name, cfg.Network.ChainID, cfg.Network.APIURL, cfg.Network.ExchangeAddress)
	if !cfg.HasCredentials() {
		fmt.Println("  no API key in the environment — market data only")
		fmt.Println("  set PERPL_API_KEY and PERPL_API_KEY_SECRET to go further")
	}

	adapter, err := perpl.New(ctx, cfg, log)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer adapter.Close()

	markets, err := showMarkets(ctx, adapter)
	if err != nil {
		return err
	}
	market, ok := markets[strings.ToUpper(symbol)]
	if !ok {
		return fmt.Errorf("market %s is not listed on this network", symbol)
	}

	if err := showCandles(ctx, adapter, market); err != nil {
		return err
	}
	if doStream {
		if err := watchLive(ctx, adapter, market); err != nil {
			return err
		}
	}
	if !cfg.HasCredentials() {
		fmt.Println("\nGate not reached: no credentials, so no account and no trade.")
		return nil
	}

	account, err := showAccount(ctx, adapter)
	if err != nil {
		return err
	}
	if !doTrade {
		fmt.Println("\nRead-only stages passed. Re-run with -trade to place a real order.")
		return nil
	}
	if !account.CanTrade {
		return errors.New("account cannot trade: call allowOrderForwarding(true) on the Exchange contract from the account wallet")
	}
	return roundTrip(ctx, adapter, market, fixed.MustParse(fmt.Sprintf("%.2f", notional)), fixed.FromInt(int64(leverage)))
}

func showMarkets(ctx context.Context, a *perpl.Adapter) (map[string]venue.Market, error) {
	section("markets")
	list, err := a.Markets(ctx)
	if err != nil {
		return nil, fmt.Errorf("markets: %w", err)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Symbol < list[j].Symbol })

	fmt.Printf("  %-6s %-4s %-8s %-8s %-9s %-10s %-8s %s\n",
		"symbol", "id", "maxLev", "liqLev", "taker bps", "maker bps", "post fee", "order ttl")
	byName := make(map[string]venue.Market, len(list))
	for _, m := range list {
		byName[m.Symbol] = m
		fmt.Printf("  %-6s %-4s %-8s %-8s %-9s %-10s %-8s %s\n",
			m.Symbol, m.VenueID,
			m.MaxLeverage.String()+"x", m.LiquidationLeverage.String()+"x",
			m.Fees.TakerRate.InBps(), m.Fees.MakerRate.InBps(),
			m.Fees.PostingFee, m.OrderTTL)
	}

	// The number every strategy's parameters come from.
	if len(list) > 0 {
		f := list[0].Fees
		fmt.Printf("\n  round trip, taker in and out: %s of notional (%s bps)\n",
			f.RoundTripRate(false, false), f.RoundTripRate(false, false).InBps())
		fmt.Printf("  round trip, maker in taker out: %s (%s bps) — the exit is free either way\n",
			f.RoundTripRate(true, false), f.RoundTripRate(true, false).InBps())
	}
	return byName, nil
}

func showCandles(ctx context.Context, a *perpl.Adapter, m venue.Market) error {
	section("candles: " + m.Symbol + " 1m, last hour")
	to := time.Now()
	from := to.Add(-time.Hour)
	candles, err := a.Candles(ctx, m.Symbol, time.Minute, from, to)
	if err != nil {
		return fmt.Errorf("candles: %w", err)
	}
	if len(candles) == 0 {
		return errors.New("candles: the venue returned none for the last hour")
	}
	fmt.Printf("  %d bars\n", len(candles))
	for _, c := range candles[max(0, len(candles)-3):] {
		fmt.Printf("  %s  O %s  H %s  L %s  C %s  vol %s  trades %d\n",
			c.Open.Format("15:04"), c.O, c.H, c.L, c.C, c.Volume, c.Trades)
	}

	// How far the price actually moves in a minute, against what a round trip
	// costs. This is the whole product thesis, measured rather than assumed.
	first, last := candles[0], candles[len(candles)-1]
	if first.O.IsPos() {
		var sum fixed.D
		for _, c := range candles {
			if c.O.IsPos() {
				sum = sum.Add(c.H.Sub(c.L).Div(c.O))
			}
		}
		avgRange := sum.Div(fixed.FromInt(int64(len(candles))))
		breakEven := m.Fees.RoundTripRate(false, false)
		fmt.Printf("\n  average 1m high-low range: %s bps\n", avgRange.InBps())
		fmt.Printf("  round trip costs:           %s bps\n", breakEven.InBps())
		if avgRange.Cmp(breakEven) > 0 {
			fmt.Printf("  a one-minute round trip is inside the noise, by %sx\n",
				avgRange.Div(breakEven))
		} else {
			fmt.Println("  a one-minute round trip does not clear the fee — this market needs a longer horizon")
		}
		fmt.Printf("  hour move: %s -> %s\n", first.O, last.C)
	}
	return nil
}

func watchLive(ctx context.Context, a *perpl.Adapter, m venue.Market) error {
	section("live market data: " + m.Symbol)
	streamCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	candles, err := a.StreamCandles(streamCtx, m.Symbol, time.Minute)
	if err != nil {
		return fmt.Errorf("stream candles: %w", err)
	}
	books, err := a.StreamBook(streamCtx, m.Symbol)
	if err != nil {
		return fmt.Errorf("stream book: %w", err)
	}

	// The first frames are the venue's snapshot, oldest bar first; the
	// interesting one is the newest.
	var gotCandle, gotBook int
	var newest venue.Candle
	deadline := time.After(8 * time.Second)
	for {
		select {
		case <-streamCtx.Done():
			return fmt.Errorf("live data: got %d candles and %d books before the stream ended", gotCandle, gotBook)
		case <-deadline:
			if gotCandle == 0 || gotBook == 0 {
				return fmt.Errorf("live data: got %d candles and %d books in 8s", gotCandle, gotBook)
			}
			fmt.Printf("  newest candle %s C %s closed=%v\n",
				newest.Open.Format("15:04"), newest.C, newest.Closed(time.Now()))
			fmt.Printf("  received %d candle and %d book frames\n", gotCandle, gotBook)
			return nil
		case c := <-candles:
			gotCandle++
			if c.Open.After(newest.Open) {
				newest = c
			}
		case b := <-books:
			gotBook++
			if gotBook == 1 {
				fmt.Printf("  book mid %s spread %s (%d bids, %d asks)\n",
					b.Mid(), b.Spread(), len(b.Bids), len(b.Asks))
			}
		}
	}
}

func showAccount(ctx context.Context, a *perpl.Adapter) (venue.Account, error) {
	section("account")
	acct, err := a.Account(ctx)
	if err != nil {
		return venue.Account{}, fmt.Errorf("account: %w", err)
	}
	fmt.Printf("  id %s  balance %s  locked %s  fee tier %d\n",
		acct.VenueID, acct.Balance, acct.Locked, acct.FeeTier)
	fmt.Printf("  can trade: %v", acct.CanTrade)
	if !acct.CanTrade {
		fmt.Print("  <- order forwarding is off; call allowOrderForwarding(true)")
	}
	fmt.Println()

	positions, err := a.Positions(ctx)
	if err != nil {
		return acct, fmt.Errorf("positions: %w", err)
	}
	if len(positions) == 0 {
		fmt.Println("  no open positions")
	}
	for _, p := range positions {
		fmt.Printf("  %s %s size %s entry %s pnl %s fees %s\n",
			p.Symbol, p.Side, p.Size, p.EntryPrice, p.UnrealizedPnL, p.FeesPaid)
	}
	return acct, nil
}

// roundTrip is the gate itself: open a position, see the fill and the fee the
// venue actually charged, then close it and confirm the close was free.
func roundTrip(ctx context.Context, a *perpl.Adapter, m venue.Market, notional, leverage fixed.D) error {
	section("round trip: " + m.Symbol)
	if leverage.Cmp(m.MaxLeverage) > 0 {
		return fmt.Errorf("leverage %s exceeds the %s maximum of %s", leverage, m.Symbol, m.MaxLeverage)
	}

	fills, err := a.StreamFills(ctx)
	if err != nil {
		return fmt.Errorf("stream fills: %w", err)
	}

	openID := fmt.Sprintf("perplcheck-open-%d", time.Now().UnixNano())
	fmt.Printf("  opening long %s notional at %sx (client id %s)\n", notional, leverage, openID)
	opened, err := a.Place(ctx, venue.OrderRequest{
		ClientID: openID,
		Symbol:   m.Symbol,
		Side:     venue.Long,
		Notional: notional,
		Leverage: leverage,
	})
	if err != nil {
		return fmt.Errorf("open: %w", err)
	}
	fmt.Printf("  order %s status %s filled %s @ %s fee %s\n",
		opened.VenueID, opened.Status, opened.FilledSize, opened.AvgPrice, opened.Fee)
	if opened.Rejection != nil {
		return fmt.Errorf("open rejected: %s", opened.Rejection)
	}

	openFill, err := awaitFill(ctx, fills, 20*time.Second)
	if err != nil {
		return fmt.Errorf("open fill: %w", err)
	}
	reportFill("open", openFill, m)

	// Close what actually filled, not what was requested.
	size := opened.FilledSize
	if size.IsZero() {
		size = openFill.Size
	}
	closeID := fmt.Sprintf("perplcheck-close-%d", time.Now().UnixNano())
	fmt.Printf("\n  closing %s\n", size)
	closed, err := a.Place(ctx, venue.OrderRequest{
		ClientID: closeID,
		Symbol:   m.Symbol,
		Side:     venue.Long,
		Reduce:   true,
		Size:     size,
		Leverage: leverage,
	})
	if err != nil {
		return fmt.Errorf("close: %w", err)
	}
	fmt.Printf("  order %s status %s filled %s @ %s fee %s\n",
		closed.VenueID, closed.Status, closed.FilledSize, closed.AvgPrice, closed.Fee)

	closeFill, err := awaitFill(ctx, fills, 20*time.Second)
	if err != nil {
		return fmt.Errorf("close fill: %w", err)
	}
	reportFill("close", closeFill, m)

	total := openFill.Fee.Add(closeFill.Fee)
	fmt.Printf("\n  round trip cost %s on %s notional (%s bps)\n",
		total, openFill.Notional(), total.Div(openFill.Notional()).InBps())
	if closeFill.Fee.IsZero() {
		fmt.Println("  the closing fill was free, as the venue's fee model promises")
	} else {
		fmt.Printf("  NOTE: the close was charged %s — the fee model is not open-only after all\n", closeFill.Fee)
	}

	fmt.Println("\nGATE PASSED: a position was opened and closed on Perpl from this script.")
	return nil
}

func awaitFill(ctx context.Context, fills <-chan venue.Fill, wait time.Duration) (venue.Fill, error) {
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return venue.Fill{}, ctx.Err()
	case f := <-fills:
		return f, nil
	case <-timer.C:
		return venue.Fill{}, fmt.Errorf("no fill within %s", wait)
	}
}

func reportFill(label string, f venue.Fill, m venue.Market) {
	side := "taker"
	if f.Maker {
		side = "maker"
	}
	fmt.Printf("  %s fill: %s @ %s as %s, notional %s, fee %s",
		label, f.Size, f.Price, side, f.Notional(), f.Fee)
	if f.Notional().IsPos() {
		fmt.Printf(" (%s bps)", f.Fee.Div(f.Notional()).InBps())
	}
	if !f.BuilderFee.IsZero() {
		fmt.Printf(", of which builder %s", f.BuilderFee)
	}
	fmt.Println()

	expected := m.Fees.Rate(f.Maker)
	if f.Notional().IsPos() && !expected.IsZero() {
		charged := f.Fee.Div(f.Notional())
		fmt.Printf("       expected %s bps from the market config, charged %s bps\n",
			expected.InBps(), charged.InBps())
	}
}

func section(title string) {
	fmt.Printf("\n=== %s ===\n", strings.ToUpper(title))
}
