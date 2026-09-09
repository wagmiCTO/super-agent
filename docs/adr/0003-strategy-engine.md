# ADR 0003: The strategy engine frames the user's tap; it never trades for them

**Status:** accepted, 2026-09-10

## Context

The product is a lobby of strategies, each a small game around one trading
decision. For that to be a lobby and not three separate apps, a strategy must
be configuration over shared parts: a signal, position rules, a screen, and a
leaderboard metric — on top of the venue adapter (ADR 0001). The acceptance
test is cost: a new strategy must take at most three days.

The first strategy, Direction, was built straight into the platform service
and the screen. This ADR fixes what the engine is before the second strategy
is written.

## Decision

A strategy never opens a position. Entries are the user's taps. What the engine
owns is everything around the tap:

1. **Signal** — server-side, computed from the venue's candles, delivered to
   the screen as state ("the window is open"). It is a hint rendered by the
   screen, not an order. Direction has no signal: the tap is the signal.
2. **Rules** — the exit the user chose together with the entry: a horizon
   that closes the position after a set time, and later stop-loss and
   take-profit. Rules only ever close. They run on the server so the exit
   does not depend on the app being open.
3. **Screen** — one per strategy, designed around its rhythm. Screens share
   the API; they do not share layout.
4. **Metric** — the strategy's leaderboard formula over real fills.

Rules are enforced by `internal/strategy`: `Rules` validates what the user
asked for, `Timers` arms one exit per market. The platform service owns the
timers and routes every close — a tap or a timer — through the same path,
policy engine included. A manual close disarms the timer first so the two can
never race into an opposite position. The last close is kept in the account
state with its reason, because a position closed by the horizon must be
explained on the screen the next time the user looks.

The API carries rules on the open request (`horizon_seconds`), the pending
exit on the position (`closes_at`), and the outcome on the state
(`last_close`).

## Consequences

- Direction becomes: tap → open with a horizon → the platform closes. The
  screen shows a countdown and, after the fact, why the position is gone.
- The second strategy (MA cross) adds a signal and a screen; it reuses rules,
  timers, policy, and the venue adapter unchanged. That is the three-day test.
- Timers live in memory. A platform restart forgets pending horizons; the
  positions stay open on the venue until the user closes them. Persisting
  strategy state, together with policy state, is required before real money
  and is tracked as debt, not solved here.
- Stop-loss and take-profit are venue orders where the venue supports them
  and engine-side triggers where it does not; that choice is deferred to the
  strategy that first needs them.
