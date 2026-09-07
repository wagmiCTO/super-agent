// Package fixed provides the fixed-point decimal used for every price, size and
// amount that crosses a venue boundary. Money never touches float64.
//
// A D is an int64 scaled by 1e8, so it holds values up to ~92 billion with eight
// decimal places. That covers every price and size on both venues we target: BTC
// at 78,413.1 and PUMP at 0.004343 both fit with room to spare.
package fixed

import (
	"errors"
	"fmt"
	"math/big"
	"math/bits"
	"strconv"
	"strings"
)

// Exp is the number of decimal places a D carries; Scale is 10^Exp.
const (
	Exp   = 8
	Scale = D(100_000_000)
)

// D is a fixed-point decimal with Exp decimal places.
type D int64

var (
	// ErrSyntax is returned by Parse for input that is not a decimal number.
	ErrSyntax = errors.New("fixed: invalid decimal syntax")
	// ErrRange is returned when a value does not fit in a D.
	ErrRange = errors.New("fixed: value out of range")
	// ErrDivByZero is returned by Div when the divisor is zero.
	ErrDivByZero = errors.New("fixed: division by zero")
)

var pow10 = [...]int64{
	1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9,
	1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18,
}

// FromInt returns the D representing a whole number of units.
func FromInt(i int64) D { return D(i) * Scale }

// FromScaled converts a venue-scaled integer with the given number of decimal
// places into a D. Perpl reports a BTC price of 78413.1 as 784131 with
// price_decimals=1; FromScaled(784131, 1) is that price.
func FromScaled(v int64, decimals int) (D, error) {
	if decimals < 0 || decimals >= len(pow10) {
		return 0, fmt.Errorf("%w: %d decimals", ErrRange, decimals)
	}
	if decimals <= Exp {
		f := pow10[Exp-decimals]
		hi, lo := bits.Mul64(uint64(abs64(v)), uint64(f))
		if hi != 0 || lo > uint64(maxInt64) {
			return 0, fmt.Errorf("%w: %d scaled by 1e%d", ErrRange, v, decimals)
		}
		return D(sign64(v) * int64(lo)), nil
	}
	// More precision than a D carries: round half away from zero.
	div := pow10[decimals-Exp]
	q := v / div
	if r := v % div; abs64(r)*2 >= div {
		q += sign64(v)
	}
	return D(q), nil
}

// MustFromScaled is FromScaled for values known at compile time or already
// validated; it panics on error.
func MustFromScaled(v int64, decimals int) D {
	d, err := FromScaled(v, decimals)
	if err != nil {
		panic(err)
	}
	return d
}

// ToScaled converts back to a venue-scaled integer, rounding half away from
// zero. It reports an error when the value cannot be represented exactly enough
// to be a legal order field — that is, never silently truncates size.
func (d D) ToScaled(decimals int) (int64, error) {
	if decimals < 0 || decimals >= len(pow10) {
		return 0, fmt.Errorf("%w: %d decimals", ErrRange, decimals)
	}
	if decimals >= Exp {
		f := pow10[decimals-Exp]
		hi, lo := bits.Mul64(uint64(d.abs()), uint64(f))
		if hi != 0 || lo > uint64(maxInt64) {
			return 0, fmt.Errorf("%w: %s to 1e%d", ErrRange, d, decimals)
		}
		return d.sign() * int64(lo), nil
	}
	div := pow10[Exp-decimals]
	q := int64(d) / div
	if r := int64(d) % div; abs64(r)*2 >= div {
		q += d.sign()
	}
	return q, nil
}

// Parse reads a decimal string such as "-1234.5678". More than Exp decimal
// places is an error rather than a silent truncation: amounts arriving from a
// venue must round-trip exactly.
func Parse(s string) (D, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, fmt.Errorf("%w: empty string", ErrSyntax)
	}
	neg := false
	switch s[0] {
	case '-':
		neg, s = true, s[1:]
	case '+':
		s = s[1:]
	}
	intPart, fracPart, _ := strings.Cut(s, ".")
	if intPart == "" && fracPart == "" {
		return 0, fmt.Errorf("%w: %q", ErrSyntax, s)
	}
	if len(fracPart) > Exp {
		return 0, fmt.Errorf("%w: %q has more than %d decimal places", ErrRange, s, Exp)
	}
	var whole int64
	if intPart != "" {
		v, err := strconv.ParseInt(intPart, 10, 64)
		if errors.Is(err, strconv.ErrRange) {
			return 0, fmt.Errorf("%w: %q", ErrRange, s)
		}
		if err != nil || v < 0 {
			return 0, fmt.Errorf("%w: %q", ErrSyntax, s)
		}
		whole = v
	}
	var frac int64
	if fracPart != "" {
		v, err := strconv.ParseInt(fracPart, 10, 64)
		if err != nil || v < 0 {
			return 0, fmt.Errorf("%w: %q", ErrSyntax, s)
		}
		frac = v * pow10[Exp-len(fracPart)]
	}
	hi, lo := bits.Mul64(uint64(whole), uint64(Scale))
	if hi != 0 || lo > uint64(maxInt64)-uint64(frac) {
		return 0, fmt.Errorf("%w: %q", ErrRange, s)
	}
	out := D(lo) + D(frac)
	if neg {
		out = -out
	}
	return out, nil
}

// MustParse is Parse for literals in tests and configuration defaults.
func MustParse(s string) D {
	d, err := Parse(s)
	if err != nil {
		panic(err)
	}
	return d
}

// String renders the value with trailing zeros trimmed, so 1.50000000 prints as
// "1.5" and a whole number prints without a point.
func (d D) String() string {
	sign := ""
	v := int64(d)
	if v < 0 {
		sign, v = "-", -v
	}
	whole, frac := v/int64(Scale), v%int64(Scale)
	if frac == 0 {
		return sign + strconv.FormatInt(whole, 10)
	}
	fs := strings.TrimRight(fmt.Sprintf("%0*d", Exp, frac), "0")
	return sign + strconv.FormatInt(whole, 10) + "." + fs
}

// Fixed renders the value with exactly n decimal places, for display.
func (d D) Fixed(n int) string {
	scaled, err := d.ToScaled(n)
	if err != nil {
		return d.String()
	}
	sign := ""
	if scaled < 0 {
		sign, scaled = "-", -scaled
	}
	if n == 0 {
		return sign + strconv.FormatInt(scaled, 10)
	}
	div := pow10[n]
	return sign + strconv.FormatInt(scaled/div, 10) + "." + fmt.Sprintf("%0*d", n, scaled%div)
}

// Float64 is for display, charts and analytics only. It must never feed an
// order field.
func (d D) Float64() float64 { return float64(d) / float64(Scale) }

// Add, Sub and Neg are exact.
func (d D) Add(o D) D { return d + o }
func (d D) Sub(o D) D { return d - o }
func (d D) Neg() D    { return -d }

// Mul multiplies two values, rounding half away from zero. The intermediate
// product is computed at 128 bits, so a price times a size cannot overflow.
func (d D) Mul(o D) D { return D(mulDiv(int64(d), int64(o), int64(Scale))) }

// Div divides, rounding half away from zero. It panics on a zero divisor, which
// is a programming error: callers holding a possibly-zero divisor use DivErr.
func (d D) Div(o D) D {
	q, err := d.DivErr(o)
	if err != nil {
		panic(err)
	}
	return q
}

// DivErr is Div for divisors that may legitimately be zero.
func (d D) DivErr(o D) (D, error) {
	if o == 0 {
		return 0, ErrDivByZero
	}
	return D(mulDiv(int64(d), int64(Scale), int64(o))), nil
}

// Cmp orders two values: -1, 0 or 1.
func (d D) Cmp(o D) int {
	switch {
	case d < o:
		return -1
	case d > o:
		return 1
	default:
		return 0
	}
}

// IsZero, IsNeg and IsPos are the predicates worth naming.
func (d D) IsZero() bool { return d == 0 }
func (d D) IsNeg() bool  { return d < 0 }
func (d D) IsPos() bool  { return d > 0 }

// Abs returns the magnitude.
func (d D) Abs() D {
	if d < 0 {
		return -d
	}
	return d
}

// RoundDownTo rounds the magnitude down to a multiple of step, toward zero. It
// is how a size is fitted to a venue's size step: rounding up could exceed the
// balance the caller sized against.
func (d D) RoundDownTo(step D) D {
	if step <= 0 {
		return d
	}
	return D(d.sign()) * D(d.abs()/int64(step)*int64(step))
}

// RoundToNearest rounds the magnitude to the nearest multiple of step, half away
// from zero. It is how a limit price is fitted to a venue's price tick.
func (d D) RoundToNearest(step D) D {
	if step <= 0 {
		return d
	}
	q, r := d.abs()/int64(step), d.abs()%int64(step)
	if r*2 >= int64(step) {
		q++
	}
	return D(d.sign()) * D(q*int64(step))
}

// Bps builds a D from a rate in basis points: Bps(69) is 0.0069.
func Bps(n int64) D { return D(n) * Scale / 10_000 }

// Micros builds a D from a rate in millionths, the unit Perpl reports fees in:
// Micros(690) is 0.00069, i.e. 6.9 bps.
func Micros(n int64) D { return D(n) * Scale / 1_000_000 }

// InBps expresses a rate as basis points: Micros(690).InBps() is 6.9. Exact, so
// it is safe to print and to compare.
func (d D) InBps() D { return d.Mul(FromInt(10_000)) }

const maxInt64 = int64(^uint64(0) >> 1)

func (d D) abs() int64 {
	if d < 0 {
		return -int64(d)
	}
	return int64(d)
}

func (d D) sign() int64 { return sign64(int64(d)) }

func abs64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

func sign64(v int64) int64 {
	if v < 0 {
		return -1
	}
	return 1
}

// mulDiv computes a*b/c at 128-bit precision, rounding half away from zero.
// It falls back to math/big only when the quotient itself would overflow, which
// means a programming error upstream — the panic is deliberate.
func mulDiv(a, b, c int64) int64 {
	if c == 0 {
		panic(ErrDivByZero)
	}
	neg := (a < 0) != (b < 0)
	if c < 0 {
		neg = !neg
		c = -c
	}
	hi, lo := bits.Mul64(uint64(abs64(a)), uint64(abs64(b)))
	uc := uint64(c)
	if hi >= uc {
		// Quotient exceeds 64 bits; fall back rather than produce garbage.
		return bigMulDiv(a, b, c)
	}
	q, r := bits.Div64(hi, lo, uc)
	if r*2 >= uc {
		q++
	}
	if q > uint64(maxInt64) {
		panic(fmt.Errorf("%w: %d*%d/%d", ErrRange, a, b, c))
	}
	if neg {
		return -int64(q)
	}
	return int64(q)
}

func bigMulDiv(a, b, c int64) int64 {
	neg := (a < 0) != (b < 0) != (c < 0)
	p := new(big.Int).Mul(absBig(a), absBig(b))
	q, r := new(big.Int).QuoRem(p, absBig(c), new(big.Int))
	if r.Lsh(r, 1).Cmp(absBig(c)) >= 0 {
		q.Add(q, big.NewInt(1))
	}
	if neg {
		q.Neg(q)
	}
	if !q.IsInt64() {
		panic(fmt.Errorf("%w: %d*%d/%d", ErrRange, a, b, c))
	}
	return q.Int64()
}

func absBig(v int64) *big.Int { return new(big.Int).Abs(big.NewInt(v)) }
