# The first user

*Last true: 2026-09-24. Written as a hypothesis before the sessions, and tested
by five of them. What survived, what did not and what came back inverted is at
the bottom of this page; the sessions themselves are in
[`user-research.md`](user-research.md).*

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

## How we said we would know this is wrong

Three ways, written down before anyone was shown the product:

1. People who show up already have stops and a plan, and find the defaults
   patronising.
2. People who show up have never traded at all, and the lesson screens are
   doing the real work rather than the discipline defaults.
3. The thing they come back for is the leaderboard, not the trading — in which
   case this is a game with a trading skin, and should be built as one.

## What the five sessions did to it

**The segment holds.** Nobody called the defaults patronising. The person who
trades understood what the product was, and that the strategies aimed at his
own trading problem, without being told — which is the segment statement
arriving back at us unprompted. Four of five reached a result with no help.

**Test 2 half-fired, and not the way we expected.** The person furthest from
trading did not need the lesson screens to understand the trading; he picked
that up quickly. He lost the thread on the risk screen and the leaderboard
instead. So the trading is not the hard part for a newcomer. The machinery
around it is.

**Test 3 came back inverted, which is the most useful thing we learned.** We
were watching for people who came back for the leaderboard rather than the
trading. Instead the leaderboard and the on-chain prize pool were the *least*
understood parts of the product, in two sessions out of five, while the trading
needed no explanation at all. This is not a game with a trading skin. If
anything the game wrapper is currently a tax on comprehension, and it has to
earn its place before more of it gets built.

**One thing we had not written down as a risk at all.** A passkey kept in a
password manager without PRF support cannot open an account here, so one of the
five never reached the product. The segment is fine; the account layer has a
hole in it that the segment statement did not anticipate.

## Status

**Confirmed as written, with one correction.** The trader described above is the
right first user. The correction is to what we owe him: the tap is understood,
and the risk screen and the prize pool are not, so the next work is on those
rather than on more strategies or more game.
