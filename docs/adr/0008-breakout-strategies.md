# ADR 0008 — Two breakout strategies: the Donchian channel and the opening range

Status: accepted · 2026-09-27 · extends ADR 0003

## Context

The lobby had three strategies: Direction (no signal), MA Cross (trend)
and RSI Bounce (counter-trend). Both signal strategies read closes. Neither
reads the one thing a breakout trader reads — where the price has *not*
been — and neither has a clock: the market is the same at 03:00 as at
14:00. Two classic rules fill both gaps, and both are simple enough to
explain in five lesson steps, which is the bar every strategy here has to
clear.

Adding a strategy is meant to be configuration over shared parts (ADR
0003): a signal, the shared screen, the shared rules, a board. This ADR
fixes the two definitions so they are not decided silently in code.

## Decision

### Turtles (`donchian`)

The Donchian channel of the last **20 closed bars**: the highest high and
the lowest low. A bar that **closes** above the channel of the 20 bars
before it opens a window up; a bar that closes below it opens one down.
The channel is recomputed after every bar, so it moves out to include the
breakout bar and a strong trend breaks out again on the next bar; a range
never does. Only closed bars count: a wick through the edge that closes
back inside is the market testing the edge, not leaving it.

The Turtles' original rule was intrabar (a stop order at the channel edge)
on daily bars. On the chart's own bars, with a window the user takes by
hand, a close is the honest version: it is the same rule the other two
signals use, and it cannot fire on a spike the user could never have
caught.

### Open Range (`orb`)

A market that never closes still wakes up on a clock. The **sessions** are
three opens in UTC, the day every crypto venue prints its daily bar on:

| open | what wakes up |
| --- | --- |
| 00:00 | the daily candle, Asia |
| 08:00 | London |
| 13:30 | New York's cash open |

The **opening range** is the first **15 minutes** after the open, or one
bar of the timeframe if a bar is longer — the hourly chart's opening range
is the hour that holds the open. Its high and low come from the bars that
closed inside it. After the range, the **first** bar to close above the
high opens a window up, the first to close below the low opens one down,
and the session is done: one signal a session, no second chance on the
other side. A breakout later than **4 hours** after the open does not
count; the open is old news by then and the watch ends.

Session opens are fixed UTC times all year. New York's open moves with US
daylight saving; 13:30 is its summer time and is kept in winter too,
because a rule the user can remember beats one that is right by an hour
twice a year.

### What both share with the others

- Computed on the platform, from the same bar feed as MA Cross and RSI,
  on every chart timeframe; the window lasts three bars of the timeframe.
- The signal is a hint the screen shows; the tap is the user's and both
  keys stay live. Rules, timers, policy and the venue adapter are reused
  unchanged.
- Each has a key index in the catalog (3 and 4), a board, a prize pool, a
  lesson, and a screen that is the shared strategy screen with its own
  drawing on the chart: the channel as a study for the Turtles, the range
  as a shaded box with its two levels for the opening range.

## Consequences

- The opening range signal needs more history than the chart keeps on the
  minute timeframe: a session's watch is four hours, the chart two. Seeds
  read the longer span; every signal trims to its own history.
- The strategy of the day can now point at a session that has just opened
  or a channel that has just been left, which are moments rather than
  regimes; it prefers them when they are live.
- Two more boards, two more weekly pools. Screens that list strategies in
  a row — the leaderboard's tabs, the history's filters — scroll sideways.
