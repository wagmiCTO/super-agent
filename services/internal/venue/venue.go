// Package venue is the seam between the strategy engine and an exchange.
//
// Everything above this package — signal sources, position rules, leaderboard
// metrics — is written against these types and never names a venue. See
// docs/adr/0001-venue-adapter-interface.md for why the seam sits here and what
// it deliberately does not expose.
package venue

import (
	"context"
	"errors"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
)

// Errors an adapter returns for conditions the engine must distinguish.
var (
	// ErrNoCredentials is returned by trading methods on an adapter built
	// without an API key. Market data still works on such an adapter.
	ErrNoCredentials = errors.New("venue: adapter has no credentials")
	// ErrUnknownMarket is returned for a symbol the venue does not list.
	ErrUnknownMarket = errors.New("venue: unknown market")
	// ErrRejected is returned when the venue refused an order. It wraps a
	// Rejection carrying the venue's own reason.
	ErrRejected = errors.New("venue: order rejected")
	// ErrNotSupported is returned for a capability this venue lacks.
	ErrNotSupported = errors.New("venue: not supported")
)

// Side is the direction of a position or an order.
type Side uint8

const (
	SideUnspecified Side = iota
	Long
	Short
)

func (s Side) String() string {
	switch s {
	case Long:
		return "long"
	case Short:
		return "short"
	default:
		return "unspecified"
	}
}

// Opposite is the side that closes this one.
func (s Side) Opposite() Side {
	switch s {
	case Long:
		return Short
	case Short:
		return Long
	default:
		return SideUnspecified
	}
}

// TimeInForce says what happens to the part of an order that cannot fill now.
type TimeInForce uint8

const (
	// GoodTillCancel rests on the book until filled or cancelled.
	GoodTillCancel TimeInForce = iota
	// ImmediateOrCancel fills what it can and drops the rest.
	ImmediateOrCancel
	// FillOrKill fills entirely or not at all.
	FillOrKill
	// PostOnly rests or is rejected; it never takes.
	PostOnly
)

// Market is one tradable instrument and the constraints an order must satisfy.
type Market struct {
	// Symbol is the venue-independent name the engine uses: "BTC", "ETH".
	Symbol string
	// VenueID is the venue's own identifier, opaque above this package.
	VenueID string
	// MaxLeverage is the highest leverage the venue accepts here: 15 means 15x.
	MaxLeverage fixed.D
	// LiquidationLeverage is the effective leverage at which the venue
	// liquidates. Zero when the venue does not publish it.
	LiquidationLeverage fixed.D
	PriceTick           fixed.D
	SizeStep            fixed.D
	MinNotional         fixed.D
	Fees                FeeSchedule
	// OrderTTL is how long an order may remain valid. Zero means unlimited.
	// Perpl caps it at order_ttl_blocks; Hyperliquid has no equivalent.
	OrderTTL time.Duration
	// MaxSlippage is the venue's own ceiling on market-order slippage.
	MaxSlippage fixed.D
	// FundingInterval is how often funding is charged. Zero when unknown.
	FundingInterval time.Duration
}

// Candle is one OHLCV bar. Volume is in collateral units.
type Candle struct {
	Open       time.Time
	Period     time.Duration
	O, H, L, C fixed.D
	Volume     fixed.D
	Trades     int
}

// Closed reports whether the bar's period has elapsed as of now. A strategy must
// never act on the forming bar as if it were final.
func (c Candle) Closed(now time.Time) bool {
	return !now.Before(c.Open.Add(c.Period))
}

// BookLevel is one price level of the L2 book.
type BookLevel struct {
	Price  fixed.D
	Size   fixed.D
	Orders int
}

// Book is a level-2 snapshot, best price first on each side.
type Book struct {
	At   time.Time
	Bids []BookLevel
	Asks []BookLevel
}

// Mid is the midpoint, or zero if either side is empty.
func (b Book) Mid() fixed.D {
	if len(b.Bids) == 0 || len(b.Asks) == 0 {
		return 0
	}
	return b.Bids[0].Price.Add(b.Asks[0].Price).Div(fixed.FromInt(2))
}

// Spread is the absolute distance between best bid and best ask.
func (b Book) Spread() fixed.D {
	if len(b.Bids) == 0 || len(b.Asks) == 0 {
		return 0
	}
	return b.Asks[0].Price.Sub(b.Bids[0].Price)
}

// Ticker is the venue's current view of a market's price.
type Ticker struct {
	At     time.Time
	Symbol string
	Mark   fixed.D
	Oracle fixed.D
	Last   fixed.D
	Bid    fixed.D
	Ask    fixed.D
}

// OrderRequest is an instruction to open or close exposure.
//
// ClientID is the engine's idempotency key: retrying Place with the same
// ClientID must not open a second position. The adapter maps it onto whatever
// the venue uses.
type OrderRequest struct {
	ClientID string
	Symbol   string
	Side     Side
	// Reduce marks an order that may only close existing exposure.
	Reduce bool
	// Size is in base units of the market. Exactly one of Size and Notional
	// is set; the adapter derives the other from the current price.
	Size fixed.D
	// Notional is the position value in collateral units.
	Notional fixed.D
	// Price is the limit price. Zero means a market order.
	Price fixed.D
	// Leverage: 10 means 10x. Must not exceed Market.MaxLeverage.
	Leverage    fixed.D
	TimeInForce TimeInForce
	// MaxSlippage caps a market order's slippage as a fraction of price.
	// Zero takes the venue default.
	MaxSlippage fixed.D
	// BuilderFee is the fee our integration charges on this order, as a
	// fraction of notional. Zero charges nothing.
	BuilderFee fixed.D
}

// IsMarket reports whether the request is a market order.
func (r OrderRequest) IsMarket() bool { return r.Price.IsZero() }

// OrderStatus is the lifecycle state of an order, collapsed to what the engine
// acts on. Venue-specific reasons live in Rejection.
type OrderStatus uint8

const (
	StatusUnknown OrderStatus = iota
	StatusPending
	StatusOpen
	StatusPartiallyFilled
	StatusFilled
	StatusCanceled
	StatusExpired
	StatusFailed
)

// Terminal reports whether no further updates are expected for the order.
func (s OrderStatus) Terminal() bool {
	switch s {
	case StatusFilled, StatusCanceled, StatusExpired, StatusFailed:
		return true
	default:
		return false
	}
}

func (s OrderStatus) String() string {
	switch s {
	case StatusPending:
		return "pending"
	case StatusOpen:
		return "open"
	case StatusPartiallyFilled:
		return "partially-filled"
	case StatusFilled:
		return "filled"
	case StatusCanceled:
		return "canceled"
	case StatusExpired:
		return "expired"
	case StatusFailed:
		return "failed"
	default:
		return "unknown"
	}
}

// Rejection carries the venue's own reason for refusing an order, for logs and
// for the operator. The engine branches on OrderStatus, not on these codes.
type Rejection struct {
	Code   string
	Detail string
}

func (r Rejection) Error() string {
	if r.Detail == "" {
		return r.Code
	}
	return r.Code + ": " + r.Detail
}

// Order is the state of an order as the venue reports it.
type Order struct {
	ClientID   string
	VenueID    string
	Symbol     string
	Side       Side
	Status     OrderStatus
	Price      fixed.D
	Size       fixed.D
	FilledSize fixed.D
	AvgPrice   fixed.D
	// Fee is gross: protocol fee plus our builder fee.
	Fee        fixed.D
	BuilderFee fixed.D
	Rejection  *Rejection
	UpdatedAt  time.Time
}

// Fill is one execution.
type Fill struct {
	OrderClientID string
	OrderVenueID  string
	Symbol        string
	Side          Side
	Price         fixed.D
	Size          fixed.D
	// Maker is true when this side provided liquidity.
	Maker bool
	// Fee is gross: protocol fee plus our builder fee. Negative is a rebate.
	Fee        fixed.D
	BuilderFee fixed.D
	At         time.Time
}

// Notional is price times size.
func (f Fill) Notional() fixed.D { return f.Price.Mul(f.Size) }

// Position is open exposure.
type Position struct {
	VenueID    string
	Symbol     string
	Side       Side
	Size       fixed.D
	EntryPrice fixed.D
	Collateral fixed.D
	Leverage   fixed.D
	// FeesPaid is what this position has cost in fees so far.
	FeesPaid fixed.D
	// UnrealizedPnL is valued against the venue's mark price.
	UnrealizedPnL fixed.D
	// RealizedFunding is funding paid or received while held.
	RealizedFunding fixed.D
	OpenedAt        time.Time
}

// Account is the trading account's balance and permissions.
type Account struct {
	VenueID string
	// Balance is free collateral; Locked is committed to positions and orders.
	Balance fixed.D
	Locked  fixed.D
	// CanTrade is false when the venue will refuse orders — on Perpl, when
	// order forwarding has not been authorized on-chain.
	CanTrade bool
	// Frozen is set when the venue has suspended the account.
	Frozen bool
	// FeeTier is the venue's own tier label, for logs.
	FeeTier int
}

// Adapter is one exchange, seen from the engine.
//
// Market-data methods work without credentials. Trading methods return
// ErrNoCredentials on an adapter built without an API key.
//
// Every streaming method returns a channel closed when ctx is done or when the
// adapter loses state it cannot silently repair. A closed channel means "re-read
// everything", never "the market went quiet".
type Adapter interface {
	// Name identifies the venue in logs and leaderboards: "perpl".
	Name() string

	// Markets returns every tradable market with its current constraints and
	// the fee schedule that applies to this account.
	Markets(ctx context.Context) ([]Market, error)

	// Market returns one market by symbol, or ErrUnknownMarket.
	Market(ctx context.Context, symbol string) (Market, error)

	// Candles returns closed bars in [from, to), oldest first.
	Candles(ctx context.Context, symbol string, period time.Duration, from, to time.Time) ([]Candle, error)

	// StreamCandles emits bars as they update, including the forming one.
	// Callers use Candle.Closed to tell them apart.
	StreamCandles(ctx context.Context, symbol string, period time.Duration) (<-chan Candle, error)

	// StreamBook emits L2 snapshots; the adapter applies venue deltas itself.
	StreamBook(ctx context.Context, symbol string) (<-chan Book, error)

	// StreamTickers emits mark/oracle/last price updates for all markets.
	StreamTickers(ctx context.Context) (<-chan Ticker, error)

	// Account returns the current balance and permissions.
	Account(ctx context.Context) (Account, error)

	// Place submits an order. It returns when the venue has accepted or
	// refused the request, not when the order fills; fills arrive on
	// StreamFills. A refusal is ErrRejected wrapping a Rejection.
	Place(ctx context.Context, req OrderRequest) (Order, error)

	// Cancel withdraws a resting order by the ClientID it was placed with.
	Cancel(ctx context.Context, clientID string) error

	// Positions returns open exposure, which is the source of truth on
	// startup: the engine reconciles against this rather than its own state.
	Positions(ctx context.Context) ([]Position, error)

	// StreamOrders emits order state transitions.
	StreamOrders(ctx context.Context) (<-chan Order, error)

	// StreamFills emits executions.
	StreamFills(ctx context.Context) (<-chan Fill, error)

	// Close releases connections.
	Close() error
}
