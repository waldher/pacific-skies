# Climb log

## Graphics

Baselines captured with `capture.cjs`: `main` (184edfe) and the tip of
`codex/pacific-skies-bold-hud-trial` (a3b7b16, "theirs").

### Round g1 — blind, 30 images, three judges

Packet: candidate 2 at both tiers (old HUD), theirs at both tiers, main at the
phone tier, five references.

| Build | Judge A | Judge B | Judge C | Median | read / coher / light / env / fx |
|---|---:|---:|---:|---:|---|
| references | 8.00 | 8.03 | 7.74 | 8.00 | 6.8 8.8 8.5 8.6 7.6 |
| theirs | 6.08 | 6.22 | 5.97 | 6.08 | 6.5 6.9 5.7 5.7 5.0 |
| candidate 2 | 5.38 | 5.14 | 5.47 | 5.38 | 5.1 5.6 5.7 5.4 4.9 |
| main | 4.11 | 4.52 | 4.53 | 4.52 | 5.1 5.3 3.5 4.1 3.3 |

Candidate 2 lost. It matched theirs on lighting/depth (planar shadows were
called the best depth cue in the set) and trailed by 1.3–1.4 on readability
and coherence. What the judges named, all three independently:

- world-space objective labels over the player and the deck (old HUD);
- whitecaps reading as "debris chips";
- forest and turf noise reading as "blocky pixel" detail beside smooth UI;
- stretched swell smearing into streaks at the fallback tier;
- smoke as translucent discs in the swarm scene.

Changes for candidate 3: whitecap flecks removed, forest canopy and turf
grain smoothed, swell less anisotropic, smoke rebuilt as outline-free
density, mountains as massifs; HUD replaced by the HUD climb's result.

### Round g2 — blind, 25 images, three judges

Packet: candidate 5 (candidate 3's fixes plus the merged HUD) at both tiers,
theirs and main at the phone tier, five references.

| Build | Judge A | Judge B | Judge C | Median | read / coher / light / env / fx |
|---|---:|---:|---:|---:|---|
| references | 7.93 | 7.95 | 7.89 | 7.93 | 6.8 8.8 8.5 8.7 7.5 |
| candidate 5 | 6.56 | 6.00 | 6.54 | 6.54 | 6.6 6.5 6.6 6.0 5.8 |
| theirs | 6.16 | 5.79 | 5.67 | 5.79 | 6.5 6.5 5.6 5.5 4.5 |
| main | 4.51 | 4.00 | 4.27 | 4.27 | 4.8 5.2 3.7 4.2 2.9 |

All three judges rank candidate 5 above theirs; the gain over round 1 is on
every line. The references are still 1.4 ahead, almost all of it on
coherence, lighting and environment. Still named against candidate 5: swarm
scenes collapse (the stress fixture is 24 aircraft on one deck), low-resolution
world beside crisp UI at the fallback tier, the HAWK label colliding with the
gauge when a wingman is parked under it, thin effects in quiet scenes.

### Render cost after round g2

Changes after the round, none visible at judging size: ground shader compiled
per island (`CLEARS`, `FIELDS`, `DUNES` defines) and two taps removed, the
ocean's tonal tap skipped at detail 0, island shadow meshes frustum-culled,
one shadow triangle per tree. These were not re-judged.

Median p50 / p95 of three alternating runs, SwiftShader ms per render:

| Scene | main p50 | branch p50 | change | main p95 | branch p95 | draws |
|---|---:|---:|---:|---:|---:|---|
| phone-airfield     | 35.3 | 38.7 | 10% | 42.2 | 46.6 | 43 → 30 |
| fallback-airfield  | 16.4 | 18.2 | 11% | 20.4 | 21.4 | 43 → 30 |
| phone-coast        | 30.8 | 31.5 | 2% | 34.9 | 35.5 | 43 → 29 |
| fallback-coast     | 12.6 | 15.0 | 19% | 15.2 | 18.3 | 43 → 29 |
| phone-fleet        | 16.4 | 16.9 | 3% | 20.2 | 20.8 | 17 → 15 |
| fallback-fleet     | 5.9 | 7.0 | 19% | 7.1 | 9.3 | 17 → 15 |
| phone-dogfight     | 20.7 | 21.7 | 5% | 27.0 | 27.7 | 89 → 33 |
| fallback-dogfight  | 10.1 | 11.3 | 12% | 12.4 | 13.2 | 89 → 33 |
| phone-stress       | 39.0 | 35.5 | -9% | 44.7 | 42.3 | 305 → 87 |
| fallback-stress    | 24.1 | 23.7 | -2% | 29.3 | 29.2 | 305 → 87 |

Phone tier: −9% to +10%. Fallback tier: up to +19% on coast and fleet, where
the wider shallows and the wake shader are fill the old build did not have.
PR #17's own bar was 5%; this does not meet it on every scene.

## HUD

### Round h2 — blind, 24 images, one reviewer session in three stances

Eight states each for the merged HUD (on the new world), theirs and main.
Weights 30/30/25/15, scores 0–5. One agent made three separate passes
(first-time player, accessibility, veteran); that is weaker independence than
the graphics rounds' three sessions.

| HUD | Pass A | Pass B | Pass C | Median | status / guidance / legibility / character |
|---|---:|---:|---:|---:|---|
| merged (ring + wind) | 3.98 | 3.85 | 3.95 | 3.95 | 4.1 3.9 3.8 4.0 |
| theirs (banner + brackets) | 3.35 | 3.28 | 3.23 | 3.28 | 3.3 3.0 3.6 3.4 |
| main | 2.25 | 1.99 | 2.25 | 2.25 | 1.9 2.1 2.3 2.6 |

No blocker on the merged HUD or theirs; main hit blockers in the critical
scene. Named against the merged HUD: wind streaks resemble tracers in a
dogfight and do not recede enough, the ring is partly lost in explosions at
critical, the raid plate is nearly as large as the objective plate, BASE text
is tiny. Theirs was judged the most consistently legible text. HUD.md has the
design rationale and its own iteration log.

## Sound

AUDIO.md has the design and 22 iterations. Its scorecard (55 pass / 3 warn /
0 fail, against 11/0/46 for main and 11/2/44 for theirs) was written by the
same agent that built the sound, and main and theirs fail mostly because 29
of 36 game events are silent there. It shows coverage and mix hygiene, not
that the result sounds good. Nobody has listened to it.
