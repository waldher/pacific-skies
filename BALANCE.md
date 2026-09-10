# Conquest balance baseline

Run `npm run test:balance` for isolated defense comparisons and
`npm run test:balance:campaign` for full-world unattended patrols.
Both use seeds 17, 42 and 93 and write JSON under ignored `playtest/shots/`.

## Initial observations

At the same 180-second checkpoint, using one enemy launch site:

| Strategy | Airfield HP remaining (of 200) | Carrier HP remaining (of 140) |
|---|---:|---:|
| Ignore the attackers | 2–68 | 50–80 |
| Established airfield defenses | 68–112 | Not an available carrier upgrade |
| Personally intercept | 178–200 | 140 |

Ignoring the isolated raids loses an undefended field after 242–258 seconds.
Established defenses delay that to 313–330 seconds. A carrier's existing guns
also delay loss to 313–330 seconds, but do not make it invulnerable.

The full world includes all launch sites, ordinary fighters, allies, repair and
campaign logic. Normal non-firing patrol pilots die after 145–177 seconds while
home remains friendly; those runs cannot establish base-loss timing. A separately
labeled high-HP observer, changing only initial pilot HP, lets the siege continue:
home is overrun after 386–507 seconds. That observer is not evidence of fair pilot
survival or a successful player strategy.

## What these experiments establish

- Player interception and garrison defense measurably change raid outcomes.
- Unattended carriers and bases can be lost through actual attacking aircraft.
- A 45-second global launch gap prevents several overdue facilities launching
  simultaneously. Individual facilities still have their own seeded timers.
- New holdings start at 55% integrity and establish over 90 seconds. Captured
  airfields gain a 100-HP friendly garrison so a lone 22-damage bomber cannot
  instantly erase the landing base.

## Limits and next measurements

The isolated comparisons disable ambient fighter AI and campaign updates, use one
launch site, and give the interceptor bot perfect awareness. It flies and fires
through production movement and weapon code; it does not teleport, land, repair,
conquer, or plan sorties. Later pilot deaths are reported separately from base
losses. Compare the common 180-second checkpoint, not unequal end-of-run HP.

The full-world smoke scenarios include production gameplay but do not represent
active conquest. Only three seeds are sampled. These runs are observations, not
hard balance assertions or a claim that the game is now balanced.

Aircraft gates now require points plus personally productive sorties completed by
landing. The first-aircraft goal of roughly 10–15 minutes remains unvalidated:
there is no mandatory time gate. Use the optional campaign report to inspect
actual unlock times and territory losses during human sessions. Next work is a
conquest bot with return-to-base behavior and human feedback on travel time,
warning time, fatigue, and recoverability.
