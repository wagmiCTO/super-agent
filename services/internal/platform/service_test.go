package platform

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/wagmiCTO/super-agent/services/internal/fixed"
	"github.com/wagmiCTO/super-agent/services/internal/policy"
	"github.com/wagmiCTO/super-agent/services/internal/venue"
)

// fakeVenue records what the service asks of it and answers from a script.
// It exists so the one path an order takes — policy, then venue, then policy
// again — can be checked without a network.
type fakeVenue struct {
	placed    []venue.OrderRequest
	positions []venue.Position
	placeErr  error
	placeResp func(venue.OrderRequest) venue.Order
}

func (f *fakeVenue) Name() string { return "fake" }
func (f *fakeVenue) Markets(context.Context) ([]venue.Market, error) {
	return []venue.Market{{Symbol: "MON", MaxLeverage: fixed.FromInt(3)}}, nil
}
func (f *fakeVenue) Market(_ context.Context, s string) (venue.Market, error) {
	return venue.Market{Symbol: s}, nil
}
func (f *fakeVenue) Candles(context.Context, string, time.Duration, time.Time, time.Time) ([]venue.Candle, error) {
	return nil, nil
}
func (f *fakeVenue) StreamCandles(context.Context, string, time.Duration) (<-chan venue.Candle, error) {
	return nil, venue.ErrNotSupported
}
func (f *fakeVenue) StreamBook(context.Context, string) (<-chan venue.Book, error) {
	return nil, venue.ErrNotSupported
}
func (f *fakeVenue) StreamTickers(context.Context) (<-chan venue.Ticker, error) {
	return nil, venue.ErrNotSupported
}
func (f *fakeVenue) Account(context.Context) (venue.Account, error) {
	return venue.Account{VenueID: "480", Balance: fixed.FromInt(1000), CanTrade: true}, nil
}
func (f *fakeVenue) Place(_ context.Context, req venue.OrderRequest) (venue.Order, error) {
	f.placed = append(f.placed, req)
	if f.placeErr != nil {
		return venue.Order{}, f.placeErr
	}
	if f.placeResp != nil {
		return f.placeResp(req), nil
	}
	return venue.Order{ClientID: req.ClientID, VenueID: "1", Symbol: req.Symbol, Side: req.Side,
		Status: venue.StatusFilled, FilledSize: req.Size, AvgPrice: fixed.MustParse("0.025")}, nil
}
func (f *fakeVenue) Cancel(context.Context, string) error { return nil }
func (f *fakeVenue) Positions(context.Context) ([]venue.Position, error) {
	return f.positions, nil
}
func (f *fakeVenue) StreamOrders(context.Context) (<-chan venue.Order, error) {
	return nil, venue.ErrNotSupported
}
func (f *fakeVenue) StreamFills(context.Context) (<-chan venue.Fill, error) {
	return nil, venue.ErrNotSupported
}
func (f *fakeVenue) Close() error { return nil }

func testLimits() policy.Limits {
	return policy.Limits{
		AllowedSymbols:   []string{"MON"},
		MinNotional:      fixed.FromInt(5),
		MaxNotional:      fixed.FromInt(50),
		MaxLeverage:      fixed.FromInt(3),
		MaxTotalExposure: fixed.FromInt(100),
		MaxOpenPositions: 2,
		DailyLoss:        fixed.FromInt(25),
		Cooldown:         0,
	}
}

func newService(t *testing.T, fv *fakeVenue) (*Service, *policy.Engine) {
	t.Helper()
	eng := policy.New()
	svc, err := New(context.Background(), fv, eng, "480", testLimits(), nil)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return svc, eng
}

func TestOpenGoesThroughPolicyThenVenue(t *testing.T) {
	fv := &fakeVenue{}
	svc, eng := newService(t, fv)

	order, err := svc.Open(context.Background(), OpenRequest{
		Symbol: "mon", Side: venue.Long, Notional: fixed.FromInt(20), Leverage: fixed.FromInt(2),
	})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if order.Status != venue.StatusFilled {
		t.Errorf("status = %s, want filled", order.Status)
	}
	if len(fv.placed) != 1 {
		t.Fatalf("venue saw %d orders, want 1", len(fv.placed))
	}
	placed := fv.placed[0]
	if placed.Symbol != "MON" || placed.Side != venue.Long || placed.Reduce {
		t.Errorf("venue got %+v", placed)
	}
	if placed.ClientID == "" {
		t.Error("order was placed without a ClientID")
	}
	if snap := eng.Snapshot("480"); snap.OpenPositions != 1 || snap.Exposure != fixed.FromInt(20) {
		t.Errorf("policy not told about the open: %+v", snap)
	}
}

// A denied order must never reach the venue, and must not consume a slot.
func TestOpenDeniedNeverReachesVenue(t *testing.T) {
	fv := &fakeVenue{}
	svc, eng := newService(t, fv)

	_, err := svc.Open(context.Background(), OpenRequest{
		Symbol: "MON", Side: venue.Long, Notional: fixed.FromInt(500), Leverage: fixed.FromInt(1),
	})
	var denial *policy.Denial
	if !errors.As(err, &denial) || denial.Reason != policy.ReasonNotionalTooLarge {
		t.Fatalf("expected a notional_too_large denial, got %v", err)
	}
	if len(fv.placed) != 0 {
		t.Errorf("a denied order reached the venue: %+v", fv.placed)
	}
	if snap := eng.Snapshot("480"); snap.OpenPositions != 0 {
		t.Errorf("a denied order consumed a position slot: %+v", snap)
	}
}

// When the venue refuses, the policy engine must not think a position opened.
func TestOpenVenueFailureDoesNotRecordOpen(t *testing.T) {
	fv := &fakeVenue{placeResp: func(r venue.OrderRequest) venue.Order {
		return venue.Order{ClientID: r.ClientID, Status: venue.StatusFailed,
			Rejection: &venue.Rejection{Code: "OrderForwardingNotAllowed"}}
	}}
	svc, eng := newService(t, fv)

	order, err := svc.Open(context.Background(), OpenRequest{
		Symbol: "MON", Side: venue.Long, Notional: fixed.FromInt(20), Leverage: fixed.FromInt(1),
	})
	if err != nil {
		t.Fatalf("Open returned an error for a venue-side failure: %v", err)
	}
	if order.Status != venue.StatusFailed || order.Rejection == nil {
		t.Errorf("expected the failed order to be returned as-is, got %+v", order)
	}
	if snap := eng.Snapshot("480"); snap.OpenPositions != 0 {
		t.Errorf("a failed order was recorded as open: %+v", snap)
	}
}

// Close sizes itself from the venue's position, never from the caller.
func TestCloseUsesVenuePosition(t *testing.T) {
	fv := &fakeVenue{positions: []venue.Position{{
		VenueID: "p1", Symbol: "MON", Side: venue.Short, Size: fixed.FromInt(800),
		EntryPrice: fixed.MustParse("0.025"), Leverage: fixed.FromInt(2),
	}}}
	fv.placeResp = func(r venue.OrderRequest) venue.Order {
		return venue.Order{ClientID: r.ClientID, Status: venue.StatusFilled, FilledSize: r.Size,
			AvgPrice: fixed.MustParse("0.026"), Fee: fixed.MustParse("0.01")}
	}
	svc, eng := newService(t, fv)

	if snap := eng.Snapshot("480"); snap.OpenPositions != 1 {
		t.Fatalf("reconcile did not pick up the venue position: %+v", snap)
	}

	if _, err := svc.Close(context.Background(), CloseRequest{Symbol: "mon"}); err != nil {
		t.Fatalf("Close: %v", err)
	}
	placed := fv.placed[len(fv.placed)-1]
	if !placed.Reduce || placed.Side != venue.Short || placed.Size != fixed.FromInt(800) {
		t.Errorf("close order = %+v, want reduce-only short of 800", placed)
	}
	// Short from 0.025 to 0.026 on 800 units loses 0.8, plus 0.01 fee.
	snap := eng.Snapshot("480")
	if want := fixed.MustParse("0.81"); snap.DailyLoss != want {
		t.Errorf("DailyLoss = %s, want %s", snap.DailyLoss, want)
	}
	if snap.OpenPositions != 0 {
		t.Errorf("OpenPositions = %d after close, want 0", snap.OpenPositions)
	}
}

func TestCloseWithoutPosition(t *testing.T) {
	fv := &fakeVenue{}
	svc, _ := newService(t, fv)
	_, err := svc.Close(context.Background(), CloseRequest{Symbol: "MON"})
	if !errors.Is(err, ErrNoPosition) {
		t.Errorf("err = %v, want ErrNoPosition", err)
	}
	if len(fv.placed) != 0 {
		t.Error("a close with no position reached the venue")
	}
}

// The kill switch stops opens but never closes.
func TestKillSwitchStopsOpensNotCloses(t *testing.T) {
	fv := &fakeVenue{positions: []venue.Position{{
		Symbol: "MON", Side: venue.Long, Size: fixed.FromInt(100), EntryPrice: fixed.MustParse("0.025"), Leverage: fixed.FromInt(1),
	}}}
	svc, _ := newService(t, fv)
	svc.Kill("test")

	_, err := svc.Open(context.Background(), OpenRequest{Symbol: "MON", Side: venue.Long, Notional: fixed.FromInt(10), Leverage: fixed.FromInt(1)})
	var denial *policy.Denial
	if !errors.As(err, &denial) || denial.Reason != policy.ReasonKillSwitch {
		t.Fatalf("expected kill_switch denial, got %v", err)
	}
	if _, err := svc.Close(context.Background(), CloseRequest{Symbol: "MON"}); err != nil {
		t.Errorf("close refused under kill switch: %v", err)
	}
}

func TestOpenValidation(t *testing.T) {
	fv := &fakeVenue{}
	svc, _ := newService(t, fv)
	tests := []struct {
		name string
		req  OpenRequest
	}{
		{"no symbol", OpenRequest{Side: venue.Long, Notional: fixed.FromInt(10)}},
		{"no side", OpenRequest{Symbol: "MON", Notional: fixed.FromInt(10)}},
		{"zero notional", OpenRequest{Symbol: "MON", Side: venue.Long}},
		{"negative leverage", OpenRequest{Symbol: "MON", Side: venue.Long, Notional: fixed.FromInt(10), Leverage: fixed.FromInt(-1)}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := svc.Open(context.Background(), tc.req); !errors.Is(err, ErrInvalid) {
				t.Errorf("err = %v, want ErrInvalid", err)
			}
		})
	}
	if len(fv.placed) != 0 {
		t.Error("an invalid request reached the venue")
	}
}

func TestRealizedPnL(t *testing.T) {
	tests := []struct {
		name string
		pos  venue.Position
		ord  venue.Order
		want string
	}{
		{"long gains", venue.Position{Side: venue.Long, EntryPrice: fixed.MustParse("100")},
			venue.Order{AvgPrice: fixed.MustParse("110"), FilledSize: fixed.FromInt(2), Fee: fixed.FromInt(1)}, "19"},
		{"short gains when price falls", venue.Position{Side: venue.Short, EntryPrice: fixed.MustParse("100")},
			venue.Order{AvgPrice: fixed.MustParse("90"), FilledSize: fixed.FromInt(2)}, "20"},
		{"short loses when price rises", venue.Position{Side: venue.Short, EntryPrice: fixed.MustParse("100")},
			venue.Order{AvgPrice: fixed.MustParse("105"), FilledSize: fixed.FromInt(2), Fee: fixed.MustParse("0.5")}, "-10.5"},
		{"no fill counts only the fees", venue.Position{Side: venue.Long, EntryPrice: fixed.MustParse("100")},
			venue.Order{Fee: fixed.MustParse("0.3")}, "-0.3"},
		// The venue charges on open; that fee is already gone from the balance
		// and belongs to this round trip's loss.
		{"opening fee is part of the loss", venue.Position{Side: venue.Long, EntryPrice: fixed.MustParse("0.02596"), FeesPaid: fixed.MustParse("0.013829")},
			venue.Order{AvgPrice: fixed.MustParse("0.0258"), FilledSize: fixed.FromInt(772)}, "-0.137349"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := realizedPnL(tc.pos, tc.ord); got != fixed.MustParse(tc.want) {
				t.Errorf("realizedPnL = %s, want %s", got, tc.want)
			}
		})
	}
}

func stringsReader(s string) io.Reader { return strings.NewReader(s) }
func trimNL(s string) string           { return strings.TrimRight(s, "\n") }

// A wallet without an exchange account is told so with a typed error, which
// the API maps to a code the app can act on — not an internal error.
func TestOpenWithoutExchangeAccount(t *testing.T) {
	fv := &fakeVenue{placeErr: venue.ErrNoExchangeAccount}
	svc, eng := newService(t, fv)
	_, err := svc.Open(context.Background(), OpenRequest{Symbol: "MON", Side: venue.Long, Notional: fixed.FromInt(10), Leverage: fixed.FromInt(1)})
	if !errors.Is(err, venue.ErrNoExchangeAccount) {
		t.Fatalf("err = %v", err)
	}
	if snap := eng.Snapshot("480"); snap.OpenPositions != 0 {
		t.Error("a refused open was recorded")
	}
}
