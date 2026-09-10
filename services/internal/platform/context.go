package platform

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/insight"
)

// MarketContext is the card a player reads before an entry: what the
// crowd on-chain has been doing with the asset, from Nansen. One card per
// market, refreshed lazily — the first request after the cache expires
// fetches, everyone else reads the cache — because Nansen meters credits
// and a poll loop would spend the plan in a day.
type MarketContext struct {
	nansen *insight.Nansen
	tokens map[string]TokenRef // by market symbol
	ttl    time.Duration
	log    *slog.Logger
	now    func() time.Time

	mu    sync.Mutex
	cards map[string]*cardEntry
}

type cardEntry struct {
	card    Card
	fetched time.Time
	err     error
	// inflight dedupes concurrent refreshes of one market.
	inflight chan struct{}
}

// TokenRef is where a market's asset lives on-chain for Nansen: the chain
// slug and the token address (the wrapped native for a native asset).
type TokenRef struct {
	Chain   string
	Address string
	Symbol  string
}

// Card is the market context as served.
type Card struct {
	Symbol       string
	Chain        string
	TokenAddress string
	TokenSymbol  string
	PriceUSD     float64
	// Change24h is a fraction: -0.0071 is -0.71%.
	Change24h     float64
	Volume24hUSD  float64
	BuyVolumeUSD  float64
	SellVolumeUSD float64
	NetflowUSD    float64
	LiquidityUSD  float64
	MarketCapUSD  float64
	// Lean is who is winning the last day: "buyers", "sellers" or "balanced".
	Lean string
	// Headline is the card in one sentence, written from the numbers.
	Headline string
	// Hours are the last few hours of holder flows, newest first.
	Hours      []FlowHour
	TopBuyers  []Trader
	TopSellers []Trader
	Source     string
	UpdatedAt  time.Time
	// Stale is true when this is the last good card served after a
	// refresh failed.
	Stale bool
}

// FlowHour is one hour of holder flows, in USD at that hour's price.
type FlowHour struct {
	At         time.Time
	InflowUSD  float64
	OutflowUSD float64
	Complete   bool
}

// Trader is one address and what it did, from who-bought-sold.
type Trader struct {
	Address   string
	Label     string
	BoughtUSD float64
	SoldUSD   float64
}

// DefaultContextTTL keeps three Nansen calls per market per refresh
// within a free plan's daily credits when polled all day.
const DefaultContextTTL = 4 * time.Hour

// NewMarketContext wires the card for the given markets.
func NewMarketContext(n *insight.Nansen, tokens map[string]TokenRef, ttl time.Duration, log *slog.Logger) *MarketContext {
	if log == nil {
		log = slog.Default()
	}
	if ttl <= 0 {
		ttl = DefaultContextTTL
	}
	norm := make(map[string]TokenRef, len(tokens))
	for sym, t := range tokens {
		t.Address = strings.ToLower(t.Address)
		norm[strings.ToUpper(sym)] = t
	}
	return &MarketContext{nansen: n, tokens: norm, ttl: ttl, log: log, now: time.Now, cards: make(map[string]*cardEntry)}
}

// Card returns the market's card, refreshing it when older than the TTL.
// A refresh that fails returns the previous card marked stale, or the
// error when there is none yet.
func (m *MarketContext) Card(ctx context.Context, symbol string) (Card, error) {
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	ref, ok := m.tokens[symbol]
	if !ok {
		return Card{}, fmt.Errorf("%w: no on-chain reference for market %q", ErrInvalid, symbol)
	}
	for {
		m.mu.Lock()
		e := m.cards[symbol]
		if e != nil && e.inflight == nil && m.now().Sub(e.fetched) < m.ttl {
			c := e.card
			m.mu.Unlock()
			return c, nil
		}
		if e != nil && e.inflight != nil {
			wait := e.inflight
			m.mu.Unlock()
			select {
			case <-wait:
				continue
			case <-ctx.Done():
				return Card{}, ctx.Err()
			}
		}
		if e == nil {
			e = &cardEntry{}
			m.cards[symbol] = e
		}
		e.inflight = make(chan struct{})
		m.mu.Unlock()

		card, err := m.fetch(ctx, symbol, ref)

		m.mu.Lock()
		close(e.inflight)
		e.inflight = nil
		e.fetched = m.now()
		if err == nil {
			e.card, e.err = card, nil
		} else {
			e.err = err
			if e.card.Symbol != "" {
				e.card.Stale = true
			}
		}
		out, hasCard := e.card, e.card.Symbol != ""
		m.mu.Unlock()
		if err != nil {
			m.log.Warn("market context refresh failed", "symbol", symbol, "err", err)
			if hasCard {
				return out, nil
			}
			return Card{}, err
		}
		return out, nil
	}
}

func (m *MarketContext) fetch(ctx context.Context, symbol string, ref TokenRef) (Card, error) {
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	rows, err := m.nansen.Screener(ctx, ref.Chain, "24h", 100)
	if err != nil {
		return Card{}, err
	}
	var row *insight.ScreenerRow
	for i := range rows {
		if strings.EqualFold(rows[i].TokenAddress, ref.Address) {
			row = &rows[i]
			break
		}
	}
	if row == nil {
		return Card{}, fmt.Errorf("platform: %s (%s) is not in Nansen's %s screener", ref.Symbol, ref.Address, ref.Chain)
	}
	dates := insight.Days(m.now(), 1)
	card := Card{
		Symbol: symbol, Chain: ref.Chain, TokenAddress: ref.Address, TokenSymbol: row.TokenSymbol,
		PriceUSD: row.PriceUSD, Change24h: row.PriceChange, Volume24hUSD: row.Volume,
		BuyVolumeUSD: row.BuyVolume, SellVolumeUSD: row.SellVolume, NetflowUSD: row.Netflow,
		LiquidityUSD: row.Liquidity, MarketCapUSD: row.MarketCapUSD,
		Source: "nansen", UpdatedAt: m.now(),
	}
	// The two detail calls are worth a credit each but the card stands
	// without them; a failure there degrades, not fails.
	if traders, err := m.nansen.WhoBoughtSold(ctx, ref.Chain, ref.Address, dates, 20); err == nil {
		card.TopBuyers, card.TopSellers = rankTraders(traders, 3)
	} else {
		m.log.Warn("market context: traders unavailable", "symbol", symbol, "err", err)
	}
	if flows, err := m.nansen.Flows(ctx, ref.Chain, ref.Address, dates, 6); err == nil {
		card.Hours = flowHours(flows)
	} else {
		m.log.Warn("market context: flows unavailable", "symbol", symbol, "err", err)
	}
	card.Lean = lean(card.BuyVolumeUSD, card.SellVolumeUSD)
	card.Headline = headline(card)
	m.log.Info("market context refreshed", "symbol", symbol, "price", card.PriceUSD, "lean", card.Lean, "credits_left", m.nansen.Credits.Remaining)
	return card, nil
}

// rankTraders splits who-bought-sold into the biggest net buyers and net
// sellers, n of each.
func rankTraders(ts []insight.Trader, n int) (buyers, sellers []Trader) {
	sorted := append([]insight.Trader(nil), ts...)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].BoughtVolumeUSD-sorted[i].SoldVolumeUSD > sorted[j].BoughtVolumeUSD-sorted[j].SoldVolumeUSD
	})
	for _, t := range sorted {
		if len(buyers) == n {
			break
		}
		if t.BoughtVolumeUSD > t.SoldVolumeUSD {
			buyers = append(buyers, Trader{Address: t.Address, Label: t.Label, BoughtUSD: t.BoughtVolumeUSD, SoldUSD: t.SoldVolumeUSD})
		}
	}
	for i := len(sorted) - 1; i >= 0; i-- {
		if len(sellers) == n {
			break
		}
		t := sorted[i]
		if t.SoldVolumeUSD > t.BoughtVolumeUSD {
			sellers = append(sellers, Trader{Address: t.Address, Label: t.Label, BoughtUSD: t.BoughtVolumeUSD, SoldUSD: t.SoldVolumeUSD})
		}
	}
	return buyers, sellers
}

func flowHours(fs []insight.FlowBucket) []FlowHour {
	out := make([]FlowHour, 0, len(fs))
	for _, f := range fs {
		in := f.Inflows * f.PriceUSD
		outflow := f.Outflows * f.PriceUSD
		if outflow < 0 {
			outflow = -outflow
		}
		out = append(out, FlowHour{At: f.Date, InflowUSD: in, OutflowUSD: outflow, Complete: f.IsComplete})
	}
	return out
}

// lean says who dominated the day's volume; within a tenth it is a draw.
func lean(buy, sell float64) string {
	total := buy + sell
	if total <= 0 {
		return "balanced"
	}
	switch d := (buy - sell) / total; {
	case d > 0.1:
		return "buyers"
	case d < -0.1:
		return "sellers"
	}
	return "balanced"
}

// headline writes the card's one sentence from the numbers: the move, who
// drove it, and how big the day was.
func headline(c Card) string {
	move := "flat"
	switch pct := c.Change24h * 100; {
	case pct >= 5:
		move = fmt.Sprintf("up %.1f%% today", pct)
	case pct >= 1:
		move = fmt.Sprintf("up %.1f%%", pct)
	case pct <= -5:
		move = fmt.Sprintf("down %.1f%% today", -pct)
	case pct <= -1:
		move = fmt.Sprintf("down %.1f%%", -pct)
	case pct > 0:
		move = fmt.Sprintf("barely up (%.1f%%)", pct)
	case pct < 0:
		move = fmt.Sprintf("barely down (%.1f%%)", -pct)
	}
	who := "buyers and sellers about even"
	switch c.Lean {
	case "buyers":
		who = fmt.Sprintf("buyers ahead by %s on-chain", money(c.NetflowUSD))
	case "sellers":
		who = fmt.Sprintf("sellers ahead by %s on-chain", money(-c.NetflowUSD))
	}
	return fmt.Sprintf("%s is %s, %s, on %s of volume in 24h.", c.TokenSymbol, move, who, money(c.Volume24hUSD))
}

// money formats a USD amount the way a card reads it: $1.2M, $82k, $950.
func money(v float64) string {
	neg := v < 0
	if neg {
		v = -v
	}
	var s string
	switch {
	case v >= 1e9:
		s = fmt.Sprintf("$%.1fB", v/1e9)
	case v >= 1e6:
		s = fmt.Sprintf("$%.1fM", v/1e6)
	case v >= 1e3:
		s = fmt.Sprintf("$%.0fk", v/1e3)
	default:
		s = fmt.Sprintf("$%.0f", v)
	}
	if neg {
		return "-" + s
	}
	return s
}
