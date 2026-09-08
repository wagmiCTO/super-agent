package perpl

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

// candleResolutions are the periods the venue serves, in seconds.
var candleResolutions = map[int]bool{
	60: true, 300: true, 900: true, 1800: true, 3600: true,
	7200: true, 14400: true, 28800: true, 43200: true, 86400: true,
}

func supportedResolution(sec int) bool { return candleResolutions[sec] }

// tickFor turns a venue decimal count into the smallest representable
// increment: 1 decimal is 0.1, 5 decimals is 0.00001.
func tickFor(decimals int) fixed.D {
	if decimals <= 0 {
		return fixed.FromInt(1)
	}
	step := fixed.Scale
	for range decimals {
		step /= 10
	}
	if step == 0 {
		return 1
	}
	return step
}

// builderRate converts a per-100k builder fee into a fraction of notional:
// 1 per_100k is 0.1 bps.
func builderRate(per100k int) fixed.D {
	if per100k <= 0 {
		return 0
	}
	return fixed.D(per100k) * fixed.Scale / 100_000
}

// parseAmount reads one of the venue's Amount strings. These are integers
// scaled by the collateral token's decimals, not decimal strings: "100000000"
// with 6 decimals is 100 AUSD.
func (a *Adapter) parseAmount(s string) (fixed.D, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, nil
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("perpl: amount %q: %w", s, err)
	}
	a.mu.Lock()
	decimals := a.collateral.Decimals
	a.mu.Unlock()
	if decimals == 0 {
		decimals = 6
	}
	return fixed.FromScaled(v, decimals)
}

func msTime(ms int64) time.Time {
	if ms == 0 {
		return time.Time{}
	}
	return time.UnixMilli(ms).UTC()
}

func (a *Adapter) toVenueCandle(m market, period time.Duration, c candle) (venue.Candle, error) {
	d := m.Config.PriceDecimals
	o, err := fixed.FromScaled(c.Open, d)
	if err != nil {
		return venue.Candle{}, err
	}
	h, err := fixed.FromScaled(c.High, d)
	if err != nil {
		return venue.Candle{}, err
	}
	l, err := fixed.FromScaled(c.Low, d)
	if err != nil {
		return venue.Candle{}, err
	}
	cl, err := fixed.FromScaled(c.Close, d)
	if err != nil {
		return venue.Candle{}, err
	}
	vol, err := a.parseAmount(c.Volume)
	if err != nil {
		return venue.Candle{}, err
	}
	return venue.Candle{
		Open:   msTime(c.Time),
		Period: period,
		O:      o,
		H:      h,
		L:      l,
		C:      cl,
		Volume: vol,
		Trades: c.Trades,
	}, nil
}

func (a *Adapter) toLevels(m market, in []bookLevel) []venue.BookLevel {
	out := make([]venue.BookLevel, 0, len(in))
	for _, l := range in {
		// A level with no orders is a removal, not a resting level.
		if l.Orders == 0 {
			continue
		}
		price, err := fixed.FromScaled(l.Price, m.Config.PriceDecimals)
		if err != nil {
			continue
		}
		size, err := fixed.FromScaled(l.Size, m.Config.SizeDecimals)
		if err != nil {
			continue
		}
		out = append(out, venue.BookLevel{Price: price, Size: size, Orders: l.Orders})
	}
	return out
}

func (a *Adapter) toVenueOrder(m market, o order) (venue.Order, error) {
	a.mu.Lock()
	client := a.clientByReq[o.RequestID]
	a.mu.Unlock()

	price, err := fixed.FromScaled(o.Price, m.Config.PriceDecimals)
	if err != nil {
		return venue.Order{}, err
	}
	size, err := fixed.FromScaled(o.OrigSize, m.Config.SizeDecimals)
	if err != nil {
		return venue.Order{}, err
	}
	filled, err := fixed.FromScaled(o.FillSize, m.Config.SizeDecimals)
	if err != nil {
		return venue.Order{}, err
	}
	avg, err := fixed.FromScaled(o.FillPrice, m.Config.PriceDecimals)
	if err != nil {
		return venue.Order{}, err
	}
	fee, err := a.parseAmount(o.Fee)
	if err != nil {
		return venue.Order{}, err
	}
	builderFee, err := a.parseAmount(o.BuilderFee)
	if err != nil {
		return venue.Order{}, err
	}

	out := venue.Order{
		ClientID:   client,
		VenueID:    strconv.FormatUint(o.OrderID, 10),
		Symbol:     m.ticker(),
		Side:       sideOfOrderType(o.Type),
		Status:     venueStatus(o.Status),
		Price:      price,
		Size:       size,
		FilledSize: filled,
		AvgPrice:   avg,
		Fee:        fee,
		BuilderFee: builderFee,
		UpdatedAt:  msTime(o.At.Time),
	}
	if out.Status == venue.StatusFailed {
		out.Rejection = &venue.Rejection{
			Code:   statusReasonName(o.Reason),
			Detail: failureReasonName(o.Failure),
		}
	}
	return out, nil
}

func (a *Adapter) toVenueFill(m market, f fill) (venue.Fill, error) {
	a.mu.Lock()
	client := ""
	for cid, oid := range a.orderIDByClient {
		if oid == f.OrderID {
			client = cid
			break
		}
	}
	a.mu.Unlock()

	price, err := fixed.FromScaled(f.Price, m.Config.PriceDecimals)
	if err != nil {
		return venue.Fill{}, err
	}
	size, err := fixed.FromScaled(f.Size, m.Config.SizeDecimals)
	if err != nil {
		return venue.Fill{}, err
	}
	fee, err := a.parseAmount(f.Fee)
	if err != nil {
		return venue.Fill{}, err
	}
	builderFee, err := a.parseAmount(f.BuilderFee)
	if err != nil {
		return venue.Fill{}, err
	}
	return venue.Fill{
		OrderClientID: client,
		OrderVenueID:  strconv.FormatUint(f.OrderID, 10),
		Symbol:        m.ticker(),
		Side:          sideOfOrderType(f.Type),
		Price:         price,
		Size:          size,
		Maker:         f.Liquidity == liquidityMaker,
		Fee:           fee,
		BuilderFee:    builderFee,
		At:            msTime(f.At.Time),
	}, nil
}

func (a *Adapter) toVenuePosition(p position) (venue.Position, error) {
	m, ok := a.marketByID(p.Market)
	if !ok {
		return venue.Position{}, fmt.Errorf("%w: market id %d", venue.ErrUnknownMarket, p.Market)
	}
	size, err := fixed.FromScaled(p.Size, m.Config.SizeDecimals)
	if err != nil {
		return venue.Position{}, err
	}
	entry, err := fixed.FromScaled(p.EntryPrice, m.Config.PriceDecimals)
	if err != nil {
		return venue.Position{}, err
	}
	collateral, err := a.parseAmount(p.Collateral)
	if err != nil {
		return venue.Position{}, err
	}
	fees, err := a.parseAmount(p.Fee)
	if err != nil {
		return venue.Position{}, err
	}
	funding, err := a.parseAmount(p.Funding)
	if err != nil {
		return venue.Position{}, err
	}

	side := venue.Long
	if p.Side == positionShort {
		side = venue.Short
	}
	pos := venue.Position{
		VenueID:         strconv.FormatUint(p.PositionID, 10),
		Symbol:          m.ticker(),
		Side:            side,
		Size:            size,
		EntryPrice:      entry,
		Collateral:      collateral,
		Leverage:        fixed.FromInt(int64(p.Leverage)).Div(fixed.FromInt(100)),
		FeesPaid:        fees,
		RealizedFunding: funding,
		OpenedAt:        msTime(p.OpenedAt.Time),
	}
	if mark, ok := a.markFor(m); ok {
		move := mark.Sub(entry)
		if side == venue.Short {
			move = move.Neg()
		}
		pos.UnrealizedPnL = move.Mul(size)
	}
	return pos, nil
}

// orderType maps a side plus reduce-only onto the venue's four order types.
func orderType(side venue.Side, reduce bool) int {
	switch {
	case side == venue.Long && !reduce:
		return orderOpenLong
	case side == venue.Short && !reduce:
		return orderOpenShort
	case side == venue.Long:
		return orderCloseLong
	default:
		return orderCloseShort
	}
}

func sideOfOrderType(t int) venue.Side {
	switch t {
	case orderOpenLong, orderCloseLong:
		return venue.Long
	case orderOpenShort, orderCloseShort:
		return venue.Short
	default:
		return venue.SideUnspecified
	}
}

// orderFlags maps time-in-force onto the venue's flags. A market order defaults
// to immediate-or-cancel: resting a market order has no meaning, and leaving it
// good-till-cancel would let it sit on the book at an unintended price.
func orderFlags(req venue.OrderRequest) int {
	switch req.TimeInForce {
	case venue.PostOnly:
		return flagPostOnly
	case venue.FillOrKill:
		return flagFillOrKill
	case venue.ImmediateOrCancel:
		return flagImmediateOrCancel
	default:
		if req.IsMarket() {
			return flagImmediateOrCancel
		}
		return flagGoodTillCancel
	}
}

// slippageBps converts a slippage fraction into the venue's basis points,
// clamped to the market's own ceiling. Zero means "take the venue default".
func slippageBps(slip fixed.D, m market) int {
	if !slip.IsPos() {
		return 0
	}
	bps := int(slip.InBps().Float64())
	if bps <= 0 {
		bps = 1
	}
	if m.MaxSlippageBps > 0 && bps > m.MaxSlippageBps {
		bps = m.MaxSlippageBps
	}
	return bps
}

func venueStatus(st int) venue.OrderStatus {
	switch st {
	case statusPending:
		return venue.StatusPending
	case statusOpen, statusUntriggered, statusTriggered:
		return venue.StatusOpen
	case statusPartiallyFilled:
		return venue.StatusPartiallyFilled
	case statusFilled, statusExecuted:
		return venue.StatusFilled
	case statusCanceled:
		return venue.StatusCanceled
	case statusExpired:
		return venue.StatusExpired
	case statusFailed:
		return venue.StatusFailed
	default:
		return venue.StatusUnknown
	}
}

// statusReasonName names the reasons worth recognising on sight; everything
// else is reported by number, which is enough to look up in the API docs.
func statusReasonName(r int) string {
	switch r {
	case reasonExceedsLastExecutionBlock:
		return "ExceedsLastExecutionBlock"
	case reasonOrderDescIDTooLow:
		return "OrderDescIdTooLow"
	case reasonOrderForwardingNotAllowed:
		return "OrderForwardingNotAllowed"
	default:
		return "reason=" + strconv.Itoa(r)
	}
}

func failureReasonName(f int) string {
	switch f {
	case 0:
		return ""
	case 1:
		return "InsufficientBalance"
	case 2:
		return "InsufficientCollateralIncrease"
	case 3:
		return "InsufficientCollateralInvert"
	case 4:
		return "NoPositionToClose"
	case 5:
		return "PerpetualSolvency"
	case 6:
		return "NegativePositionValue"
	case 7:
		return "ReferencePriceStale"
	case 8:
		return "ExceedsMaxNegPnlCollat"
	default:
		return "failure=" + strconv.Itoa(f)
	}
}

func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }

func errorsAs(err error, target any) bool { return errors.As(err, target) }

// closeOnDone closes a stream channel when its context ends, which is the
// signal the engine reads as "state was lost, re-read everything".
func closeOnDone[T any](ctx context.Context, ch chan T) {
	<-ctx.Done()
	close(ch)
}
