package fixed

import (
	"errors"
	"testing"
)

func TestParseAndString(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want D
		out  string
	}{
		{"zero", "0", 0, "0"},
		{"whole", "1", Scale, "1"},
		{"negative whole", "-42", -42 * Scale, "-42"},
		{"trailing zeros trimmed", "1.50000000", 150_000_000, "1.5"},
		{"full precision", "0.00000001", 1, "0.00000001"},
		{"btc price", "78413.1", 7_841_310_000_000, "78413.1"},
		{"pump price", "0.004343", 434_300, "0.004343"},
		{"leading point", ".5", 50_000_000, "0.5"},
		{"explicit plus", "+2.25", 225_000_000, "2.25"},
		{"negative fraction", "-0.25", -25_000_000, "-0.25"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Parse(tc.in)
			if err != nil {
				t.Fatalf("Parse(%q): %v", tc.in, err)
			}
			if got != tc.want {
				t.Errorf("Parse(%q) = %d, want %d", tc.in, got, tc.want)
			}
			if s := got.String(); s != tc.out {
				t.Errorf("String() = %q, want %q", s, tc.out)
			}
		})
	}
}

func TestParseErrors(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want error
	}{
		{"empty", "", ErrSyntax},
		{"not a number", "abc", ErrSyntax},
		{"lone point", ".", ErrSyntax},
		{"double sign", "--1", ErrSyntax},
		{"too many decimals", "1.123456789", ErrRange},
		{"overflow", "99999999999999999999", ErrRange},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Parse(tc.in); !errors.Is(err, tc.want) {
				t.Errorf("Parse(%q) error = %v, want %v", tc.in, err, tc.want)
			}
		})
	}
}

// Scaling is the boundary where a venue's integers become ours; a mistake here
// is an order of the wrong size, so both directions are pinned to real Perpl
// market configs.
func TestScaledRoundTrip(t *testing.T) {
	tests := []struct {
		name     string
		scaled   int64
		decimals int
		want     D
	}{
		{"btc price, 1 decimal", 784131, 1, 7_841_310_000_000},
		{"btc size, 5 decimals", 10000, 5, 10_000_000},
		{"eth price, 2 decimals", 247421, 2, 247_421_000_000},
		{"mon price, 5 decimals", 2542, 5, 2_542_000},
		{"pump price, 6 decimals", 4343, 6, 434_300},
		{"mon size, 0 decimals", 7, 0, 700_000_000},
		{"ausd amount, 6 decimals", 100_000_000, 6, 10_000_000_000},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := FromScaled(tc.scaled, tc.decimals)
			if err != nil {
				t.Fatalf("FromScaled: %v", err)
			}
			if got != tc.want {
				t.Errorf("FromScaled(%d, %d) = %d, want %d", tc.scaled, tc.decimals, got, tc.want)
			}
			back, err := got.ToScaled(tc.decimals)
			if err != nil {
				t.Fatalf("ToScaled: %v", err)
			}
			if back != tc.scaled {
				t.Errorf("ToScaled round trip = %d, want %d", back, tc.scaled)
			}
		})
	}
}

func TestToScaledRounds(t *testing.T) {
	tests := []struct {
		name     string
		in       string
		decimals int
		want     int64
	}{
		{"half rounds away from zero", "0.5", 0, 1},
		{"negative half rounds away", "-0.5", 0, -1},
		{"below half rounds down", "0.4999", 0, 0},
		{"price to one decimal", "78413.14", 1, 784131},
		{"price to one decimal, up", "78413.16", 1, 784132},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := MustParse(tc.in).ToScaled(tc.decimals)
			if err != nil {
				t.Fatalf("ToScaled: %v", err)
			}
			if got != tc.want {
				t.Errorf("ToScaled(%q, %d) = %d, want %d", tc.in, tc.decimals, got, tc.want)
			}
		})
	}
}

// A price times a size overflows int64 at 1e8 scaling, so the 128-bit path is
// the normal path, not an edge case.
func TestMulDoesNotOverflow(t *testing.T) {
	tests := []struct {
		name string
		a, b string
		want string
	}{
		{"btc notional", "78413.1", "1", "78413.1"},
		{"btc notional at size 12", "78413.1", "12", "940957.2"},
		{"fee on notional", "1000", "0.00069", "0.69"},
		{"negative", "-2.5", "4", "-10"},
		{"rounds half away from zero", "0.00000001", "0.5", "0.00000001"},
		{"large notional", "78413.1", "1000", "78413100"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := MustParse(tc.a).Mul(MustParse(tc.b))
			if want := MustParse(tc.want); got != want {
				t.Errorf("%s * %s = %s, want %s", tc.a, tc.b, got, tc.want)
			}
		})
	}
}

func TestDiv(t *testing.T) {
	tests := []struct {
		name string
		a, b string
		want string
	}{
		{"exact", "10", "4", "2.5"},
		{"notional to size", "1000", "78413.1", "0.01275297"},
		{"negative", "-10", "4", "-2.5"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := MustParse(tc.a).Div(MustParse(tc.b))
			if want := MustParse(tc.want); got != want {
				t.Errorf("%s / %s = %s, want %s", tc.a, tc.b, got, tc.want)
			}
		})
	}
	if _, err := MustParse("1").DivErr(0); !errors.Is(err, ErrDivByZero) {
		t.Errorf("DivErr by zero = %v, want ErrDivByZero", err)
	}
}

// Sizes round down and prices round to nearest: rounding a size up can exceed
// the balance it was sized against.
func TestRounding(t *testing.T) {
	tests := []struct {
		name     string
		in, step string
		down     string
		nearest  string
	}{
		{"btc size step", "0.12345678", "0.00001", "0.12345", "0.12346"},
		{"mon whole units", "7.9", "1", "7", "8"},
		{"price tick", "78413.16", "0.1", "78413.1", "78413.2"},
		{"negative", "-7.9", "1", "-7", "-8"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			in, step := MustParse(tc.in), MustParse(tc.step)
			if got := in.RoundDownTo(step); got != MustParse(tc.down) {
				t.Errorf("RoundDownTo = %s, want %s", got, tc.down)
			}
			if got := in.RoundToNearest(step); got != MustParse(tc.nearest) {
				t.Errorf("RoundToNearest = %s, want %s", got, tc.nearest)
			}
		})
	}
}

func TestRateHelpers(t *testing.T) {
	if got, want := Micros(690), MustParse("0.00069"); got != want {
		t.Errorf("Micros(690) = %s, want %s", got, want)
	}
	if got, want := Bps(69), MustParse("0.0069"); got != want {
		t.Errorf("Bps(69) = %s, want %s", got, want)
	}
	if got, want := Micros(690).InBps(), MustParse("6.9"); got != want {
		t.Errorf("Micros(690).InBps() = %s, want %s", got, want)
	}
}

func TestFixed(t *testing.T) {
	tests := []struct {
		in   string
		n    int
		want string
	}{
		{"1.5", 2, "1.50"},
		{"1.005", 2, "1.01"},
		{"-1.005", 2, "-1.01"},
		{"78413.1", 0, "78413"},
	}
	for _, tc := range tests {
		if got := MustParse(tc.in).Fixed(tc.n); got != tc.want {
			t.Errorf("%s.Fixed(%d) = %q, want %q", tc.in, tc.n, got, tc.want)
		}
	}
}
