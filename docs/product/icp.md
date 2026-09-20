# The first user

*Last true: 2026-09-21. Written before the onboarding sessions, so every line
here is a hypothesis to be confirmed or killed by [`user-research.md`](user-research.md).*

## Who

A retail trader, 20 to 35, who **already trades perps on a centralised
exchange at 10–50x and loses to a lack of discipline rather than a lack of
analysis**. He has no stop. He has no limit on the day. He sits in a losing
position until it comes back, and it does not. He does not want to learn a
terminal; he wants to trade more simply, and more safely than he manages on
his own.

He is not a beginner who has never traded, and he is not a quant. He knows
what a liquidation is — usually first-hand.

## What we give him

A strategy as a game with one tap. The stop and the timer are on by default,
not an option he has to find. The day has a budget. The week has a
leaderboard and a prize pool, so coming back is about a streak rather than a
recovery trade.

The tap is his. The signal is a hint, and the exit happens on time whether
the app is open or not.

## Why this does not exist yet

- **Centralised exchanges earn from his mistakes.** Liquidations and
  overtrading are revenue; discipline is not a feature they are paid to ship.
- **On-chain terminals copy the centralised UI.** They compete on order types
  and depth, which serves the trader who already has discipline.
- **Copy-trading copies somebody else's trade.** It moves the decision away
  from him instead of framing it so he can make it well.

And the honest constraint: a 15-minute horizon is only viable if the round
trip is cheap enough not to eat the move. That is an inequality, not an
opinion — see [`../fee-model.md`](../fee-model.md). Settlement on Monad is
what puts a short horizon on the right side of it.

## How we will know this is wrong

Any of these kills the segment as written and sends us back to this page:

- People who show up already have stops and a plan, and find the defaults
  patronising.
- People who show up have never traded at all, and the lesson screens are
  doing the real work rather than the discipline defaults.
- The thing they come back for is the leaderboard, not the trading — in which
  case this is a game with a trading skin, and should be built as one.

## Status

Not yet confirmed. Five onboarding sessions with strangers are the test; the
segment statement above gets rewritten from what those sessions show.
