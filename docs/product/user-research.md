# What people did with it

*Last true: 2026-09-24. Five sessions run.*

## Method

Someone who trades gets the app and uses it. Sitting beside them, or over a
call, or on their own phone in their own time with the notes coming back by
message — whichever actually happens. What does not change: no demo, no
narration, and no rescuing them when they get stuck, because the sticking
point is the finding.

The path under observation is the whole first run:

    intro → passkey → account opens → lesson → first tap → position → result

What gets written down: where they stopped, what they said, and what they
asked.

Five questions to get through, in this order where the session allows it, so
the early answers are not steered by the later ones:

1. What is this app?
2. What are you paying for?
3. What would you do tomorrow?
4. What was unclear?
5. Would you put $100 in this?

Not every session answers all five. A session where somebody used the thing
and said something true is worth more than one bent into a protocol, so the
notes record which questions were actually asked rather than implying all of
them were.

## Sessions

| # | Date | Trades already? | Where | Reached a result unaided? |
|---|---|---|---|---|
| 1 | 2026-09-21 | yes, on centralised exchanges | direct invite, remote | yes |
| 2 | 2026-09-24 | yes | remote | **no — could not sign in at all** |
| 3 | 2026-09-24 | yes | remote | yes |
| 4 | 2026-09-24 | yes | remote | yes |
| 5 | 2026-09-24 | no, furthest from trading of the five | remote | yes |

All five ran remotely: people opened the app on their own phone and sent back
what they thought as they went. The five questions were not put to them as a
script; what is recorded is what they did and what they said about it.

## Findings

One row per observation, not per person. The rule for acting on one: **two or
more people hit it, or it does not get changed.** A single person's confusion
is noise; the second occurrence makes it a defect.

| Observation | People | Decision |
|---|---|---|
| **The first run is fast and lands.** Intro, passkey, account, first position — walked without help. One person understood what the product was and that the strategies aimed at his own trading problem without being told | **4** | Nothing to change. This is the strongest thing we have and it goes in front of everything else |
| **The risk screen is hard to read, and it is in the wrong place.** One asked for the danger zone to be raised onto the first screen; another, the furthest from trading, called the screen complicated | **2** | **Change it.** Raise the danger zone, and cut the language back to what someone who has never read a risk dashboard can follow |
| **The prize pool is not understood.** One liked the leaderboard tab and still could not follow the on-chain pool; the other found both hard | **2** | **Change it.** Note the shape of this: the board is fine, the payout mechanism is not. Explain where the money comes from in one line, at the point where it is shown |
| A passkey held in a password manager without PRF support locks the person out of the product completely | 1 | **Not waiting for a second.** This is not a preference, it is a door that does not open. The error text now says what happened; the limitation itself is real and is stated in the submission |
| The chart does not render on one mobile device | 1 | Bug. Fixed on its own merits, not by the two-person rule |
| Red in the lobby statistics reads as alarming rather than informative | 1 | Waiting on a second occurrence |
| The bottom of the screen is a list of links where icons were expected — "it doesn't look mobile" | 1 | Waiting on a second occurrence, though it is cheap and it speaks to whether the thing feels like an app |
| Signing in on a second visit was impossible: the account was remembered but locked, and the header's `SIGN IN` was not a button | 1 | **Fixed the same day.** A path that cannot be walked is a defect and does not wait for a second report |
| Nothing tells you when a position closed | 1 | **Still one voice.** It did not come up again across four more sessions, so by our own rule it waits — even though it is the finding we find most interesting |
| The 15-minute horizon read as the right length | 1 | Keep the default |

## Numbers for the record

| Measure | Value |
|---|---|
| Sessions run | 5 |
| Reached a result without a hint | 4 of 5 |
| Blocked before reaching the product at all | 1 of 5 (passkey manager without PRF) |
| Said what the app was, unprompted | 1 of 5 volunteered it; the others were not asked |

## What this changes

Findings acted on land in the changelog like any other change, and the row
above says which observation drove them. Findings deliberately not acted on
stay in the table with the reason, because a decision not to change something
is also a decision.

What five sessions changed, in one line: **the trading screen works on
everyone, and the machinery around it does not.**

The closer somebody is to trading, the faster the product lands. The person who
trades understood what it was and that the strategies aimed at his own problem
without anyone telling him. The person furthest from trading picked up the
trading part quickly too — and then lost the thread at the risk screen and the
prize pool. Nobody struggled with the tap. Two of five struggled with what
surrounds it.

So the work is not on the core. It is on the risk screen, which needs to say
less and say it sooner, and on the prize pool, which needs one line explaining
where the money comes from at the moment it is shown.

One hypothesis came back inverted. [`icp.md`](icp.md) listed a way to know the
segment was wrong: *"the thing they come back for is the leaderboard, not the
trading."* The opposite happened. The leaderboard and the pool were the least
understood parts of the product, and the trading was the part that needed no
explanation. The game wrapper is not yet carrying its weight — which is useful
to know before building more of it.

And the finding we liked most did not survive its own rule. Nothing tells a
trader that a position closed while their phone was in their pocket; one person
asked for it, and across four further sessions nobody raised it again. It stays
on one voice and it stays unbuilt, because a rule that only applies when it
agrees with us is not a rule.
