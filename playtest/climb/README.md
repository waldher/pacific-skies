# Climb: graphics, HUD and sound

A lean hill climb run alongside `codex/graphics-hill-climb` (PR #17) to see
whether a second attempt, started from `main`, can beat it. Same reference
games, same rubric weights, far less ceremony: captures and judging packets
are rebuilt on demand rather than archived in the repository.

## Loop

1. `capture.cjs` stages fixed seeded scenes at 852×393 with the whole HUD and
   times `graphics.render()` on SwiftShader. The five graphics scenes
   (airfield, coast, fleet, dogfight, stress × touch tiers 2 and 4) use the
   same fixtures as PR #17's `playtest/graphics.cjs`, so both branches can be
   captured by one script and judged in one packet. `CLIMB_SET=hud` adds
   eight HUD states; `CLIMB_SET=roam` visits other islands and biomes
   (unjudged: the fixed scenes only ever show home).
2. Inner loop: change one thing, recapture, look. Cheap and frequent.
3. Outer gate: `packet.cjs` shuffles captures from several builds plus the
   reference images into anonymous `img-NN` files and writes the key
   elsewhere. Three fresh reviewer sessions score every image on the rubric
   without the key; `score.cjs` joins scores to the key. Judges' notes, not
   just totals, drive the next round.
4. Cost: compare `capture.cjs` p50 per scene against `main`, alternating
   builds on a quiet machine. SwiftShader milliseconds are a relative fill and
   vertex cost, not phone FPS.

Reviewers are agent sessions from one model family. Their scores rank builds
against each other under identical conditions; they are not human validation,
and nobody in this loop can hear the audio. See LOG.md for rounds and results.

## Rubrics

- Graphics (1–10): readability 30, coherence 20, lighting/depth 20,
  environment 15, effects 15. References: Door Kickers 2, Company of Heroes 3,
  StarCraft II publisher images listed in PR #17's `references.json`
  (downloaded for judging, not redistributed here).
- HUD (0–5): integrated status 30, contextual guidance 30, phone legibility
  and action 25, character and restraint 15. Benchmarks: Dead Space's
  on-character status, Ghost of Tsushima's guiding wind. See HUD.md.
- Sound: see AUDIO.md. Measured offline; listening is the owner's call.
