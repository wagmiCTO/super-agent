# What people did with it

*Last true: 2026-09-23. One session done, four to go.*

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

Session 1 ran remotely: they opened the app on their own phone, went through
the first run with nobody watching and sent back what they thought as they
went. The five questions were not put to them.

## Findings

One row per observation, not per person. The rule for acting on one: **two or
more people hit it, or it does not get changed.** A single person's confusion
is noise; the second occurrence makes it a defect.

| Observation | People | Decision |
|---|---|---|
| Signing in on a second visit was impossible: the account was remembered but locked, and the header's `SIGN IN` was not a button | 1 | **Fixed the same day.** The two-person rule is for preferences; a path that cannot be walked is a defect and does not wait for a second report |
| The first run — intro, passkey, account, first position — was walked without help or questions | 1 | Nothing to change. Recorded because the passkey account is the part we expected to cost people the most |
| The 15-minute horizon read as the right length | 1 | Keep the default. Revisit only if someone says otherwise |
| Nothing tells you when a position closed | 1 | **Open.** The platform closes a position when its horizon ends whether the phone is awake or not, and then says nothing. Waiting on a second occurrence, but see below |

## Numbers for the record

| Measure | Value |
|---|---|
| Share who reached a result without a hint | 1 of 1 so far |
| Share who could say what the app was, unprompted | not asked yet |

## What this changes

Findings acted on land in the changelog like any other change, and the row
above says which observation drove them. Findings deliberately not acted on
stay in the table with the reason, because a decision not to change something
is also a decision.

The open one is worth stating plainly, because it is a hole in the product and
not a missing feature. The platform owns the exit: it closes a position when
the horizon ends, on its own, while the phone is in a pocket. That is the
promise the whole design rests on — and today the person who made the trade has
no way of learning it happened until they next open the app. A closed position
nobody is told about is also the one moment that would bring someone back the
next day, which makes this the same problem as the empty return-rate row in
[`traction.md`](traction.md).
