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
