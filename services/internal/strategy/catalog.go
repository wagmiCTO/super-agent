package strategy

// Info is a strategy as the lobby lists it.
type Info struct {
	ID string
	// Name and Tagline are what the user reads; the tagline is the one
	// line that says what the strategy is, in plain words.
	Name    string
	Tagline string
	// Rhythm says how often the strategy asks for a decision.
	Rhythm string
	// KeyIndex is the strategy's slot in the key family the passkey
	// derives (ADR 0005). It is part of the derivation: never renumber.
	KeyIndex int
	// NotionalCap bounds one position for this strategy, in collateral
	// units; empty means the platform-wide limit. Each strategy trades with
	// its own key under its own limits.
	NotionalCap string
}

// Catalog is every strategy the platform runs, in lobby order. The id is
// what orders are tagged with and what the leaderboard is keyed by.
var Catalog = []Info{
	{ID: "direction", Name: "Direction", Tagline: "Up or down, an amount, a horizon. The platform closes for you.", Rhythm: "minutes to hours", KeyIndex: 0},
	{ID: "ma-cross", Name: "MA Cross", Tagline: "Trade the trend: enter when the fast average crosses the slow one.", Rhythm: "a few entries an hour", KeyIndex: 1, NotionalCap: "30"},
	{ID: "rsi", Name: "RSI Bounce", Tagline: "Counter the trend: enter when the crowd has overdone it — below 30 up, above 70 down.", Rhythm: "long waits, sharp entries", KeyIndex: 2, NotionalCap: "30"},
}

// Lookup returns the catalog entry for id.
func Lookup(id string) (Info, bool) {
	for _, s := range Catalog {
		if s.ID == id {
			return s, true
		}
	}
	return Info{}, false
}

// DefaultStrategy is what an untagged order counts as.
const DefaultStrategy = "direction"

// Known reports whether id names a strategy in the catalog.
func Known(id string) bool {
	for _, s := range Catalog {
		if s.ID == id {
			return true
		}
	}
	return false
}
