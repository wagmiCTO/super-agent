package strategy

import (
	"errors"
	"fmt"
	"time"
)

// Rules bound a position after the user opened it. Every field is an exit;
// none is an entry.
type Rules struct {
	// Horizon closes the position this long after it opened. Zero means the
	// position stays until the user closes it.
	Horizon time.Duration
}

// Horizon bounds. The floor keeps a timer from racing the fill it is meant
// to close; the ceiling is "until tomorrow", the longest the app offers.
const (
	MinHorizon = 10 * time.Second
	MaxHorizon = 24 * time.Hour
)

var ErrInvalidRules = errors.New("strategy: invalid rules")

// Validate reports rules the engine will not enforce.
func (r Rules) Validate() error {
	if r.Horizon == 0 {
		return nil
	}
	if r.Horizon < MinHorizon || r.Horizon > MaxHorizon {
		return fmt.Errorf("%w: horizon must be between %s and %s", ErrInvalidRules, MinHorizon, MaxHorizon)
	}
	return nil
}
