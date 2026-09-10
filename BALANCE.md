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
Established defenses delay that to 313–330 seconds. An isolated carrier without the new escorts has existing guns that
also delay loss to 313–330 seconds, but do not make it invulnerable.

After the archipelago rewrite, the full world includes all launch sites, ordinary
fighters, allies, repair, task groups and campaign logic. Non-firing patrol pilots
in these three seeds die after 187–189 seconds while home remains friendly. The
separate high-HP observer now reaches the 600-second cutoff with home still held
(127–147 HP) and an active carrier at 96 HP. These runs do not prove that a task
group or the home base eventually falls. The new geography and escorts changed
pressure materially; further human and active-conquest comparison is needed.
The isolated table above excludes the new escorts and is not a task-group benchmark.

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

## Expedition slice (September 10)

The game now shares the atlas macro geography: 4–7 regions, with 36–109 physical landforms in the 500-seed geometry sample. Regional center links exceed 9,000 units; runway/capture sites retain local operational dimensions. The home region includes radar and a forward field placed toward the first outward passage. Flights should be measured from actual bases, not inferred from bounding-box size.

Pressure now originates only in the same or an adjacent region, with one four-aircraft major formation active at a time. Existing pursuit Zeroes and independent allies remain. Ordinary pilot death pauses for recovery; campaign defeat requires losing all viable launch bases. Local saves retain the active war. Earlier bot survival/defeat figures are not directly comparable to this persistent campaign.

Qualifications retain score and personal combat-sortie requirements, adding accumulated flight experience: Dauntless 7 min, Corsair 12 min, Avenger 18 min, P-51 25 min. These are minimum flight times, not promised unlock times or final balance. Landing/idle time does not count. Next human sessions should report first useful discovery, first forward landing, repeated rearm transit, first unlock, and whether attacks have an understandable source.

Geometry, saved-world recovery, front adjacency and source suppression have automated coverage. These checks establish correctness; they do not establish exploration fun or final pacing. Purposeful fleet offensives, logistics and encounter discoveries remain follow-up work.
