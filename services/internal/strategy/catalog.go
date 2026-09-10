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
}

// Catalog is every strategy the platform runs, in lobby order. The id is
// what orders are tagged with and what the leaderboard is keyed by.
var Catalog = []Info{
	{ID: "direction", Name: "Direction", Tagline: "Up or down, an amount, a horizon. The platform closes for you.", Rhythm: "minutes to hours"},
	{ID: "ma-cross", Name: "MA Cross", Tagline: "Trade the trend: enter when the fast average crosses the slow one.", Rhythm: "a few entries an hour"},
	{ID: "box", Name: "Box", Tagline: "Wait inside the range for free; enter when a bar closes outside it.", Rhythm: "long waits, sharp entries"},
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
