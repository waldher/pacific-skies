# Graphics hill climb — 2026-11-06

**Experimental, not accepted; do not merge. The reference-quality goal is not met.**
The initial experiment used unblinded reviews of 30 Pacific Skies screenshots and
five publisher references. Later randomized reviews are detailed below. All judges
were agent sessions from the same model family; scores are subjective screenshot
judgments, not whole-game quality measurements.

## Publication packaging

The tested candidate-6 runtime is unchanged from local commit `93ae2bf`. The unused
4 MB source PNG is stored losslessly in eight binary parts under
`tools/reference/generated-terrain`, with a SHA-256 manifest and `reconstruct.py`,
because the publication connector stalled on the single payload. Runtime still
loads the identical 149,756-byte WebP. Historical reports and their hashes are
unchanged; their source hash includes the reconstructed original PNG. The packaged
checkout therefore has a different source hash until reconstruction. This is not
an evidence-gate bypass or an acceptance claim; all pending gates still apply.

## Later experiments: candidates 3–6

Draft PR: https://github.com/waldher/pacific-skies/pull/17. This checkpoint preserves
the source and evidence through candidate 6; it is not ready to merge.
**No later candidate is accepted; the reference target remains unmet.**

Candidate 3 added baked terrain variation and contact shadows, richer installations,
quieter water, a particle atlas and objective labels outside the central action.
Candidate 4 added shallow static-object relief, textured shores, aircraft silhouette
shadows and a revised explosion ring. These are experimental code states, not an
accepted sequence of incumbents.

Three new reviewer sessions inspected each of 25 randomized full-frame images per
packet: ten previous-candidate images, ten new-candidate images and the same five
frozen references. Source labels and mapping were withheld during scoring, though
game families can be recognized visually. All sessions used the same model family.
The new judges have different scoring anchors from the initial reviewers: compare
within these pairs, not the earlier 3–4 scores against these 6–7 scores.

| Judge | Candidate 2 | Candidate 3 | Candidate 4 | Candidate 5 | Candidate 6 | Reference mean |
|---|---:|---:|---:|---:|---:|---:|
| A | 5.1100 | 6.0550 | 6.1475 | 6.3725 | 6.5525 | 8.2850 |
| B | 5.2100 | 6.3850 | 6.5400 | 6.6600 | 6.6900 | 8.3400 |
| C | 5.5700 | 6.9025 | 7.0200 | 7.2550 | 7.5100 | 8.2150 |

Scores are recomputed from the five category arrays and fixed weights; the exact
arrays, observations, image hashes and identity keys are archived under
`evidence/blind-review-{3,4,5,6}` and `evidence/blind-review-summary.json`.
Every Pacific Skies packet image was verified byte-for-byte against its archived
capture. Reference files are identified by hashes but not redistributed.

Candidate 3 gained a median **1.175** points with no judge reporting a numeric
readability regression. This passes only the visual-gain portion of the rubric.
Candidate 4 gained a median **0.1175**, below the unchanged **0.15** minimum.
Judges A and C also lowered readability for both stress profiles. Weaker ship
wakes and clutter from many aircraft shadows were visible regressions. Candidate 4
is rejected as an improvement; its evidence is retained to guide revision.

Candidates 3–6 use schema 2, `graphics-v2-fixed-42-step-capture`: twelve warmup
and thirty fixed visual steps, followed by a screenshot before separate timing.
GPU readback drains queued warmup before timing; reports retain raw samples and GL
backend details. Their captures each include only one 60-sample timing run, not the
three alternating 180-sample matched pairs required for performance acceptance.
The original schema-1 evidence remains unchanged. Historical source states have
not all been recaptured under v2, so the existing gate record must not be treated
as a valid acceptance record for these later candidates. Report/source hashes are
preserved exactly, not rewritten to make different protocols appear equivalent.

Candidate 5 added a generated ground material baked into existing island textures,
stronger directional lighting, metal/glass response, ship deck grain, restored wakes,
and reduced crowding from enemy aircraft shadows. Its median gain over candidate 4
is **0.225** with no numeric readability regression from any of the three judges.
This passes only that pair's screenshot criteria, not full acceptance; candidate 4
was already a rejected experiment. All judges still score the references higher.

Candidate 5 motion evidence is archived under `evidence/motion-5`: eighteen PNGs,
original `motion.json`, all three reviewer records, and a derived HTML player.
The 3.9 MB original player embedded duplicate PNG bytes; `archive-manifest.json`
preserves its exact hash and records the transformation to relative PNG URLs in
`motion-player.html`. The original report is unchanged. The sparse samples cover
three seconds of real simulation, not a 60 FPS video. **All three motion judges
reject acceptance**: the large explosion is insufficiently distinct from a small
impact. Judges A and C also identify dotted smoke with weak plume expansion.
Hit-flash lifecycle, wake continuity and HUD visibility fare better, but sparse
samples cannot establish continuous smoothness or touch-control usability.

`evidence/transit-provisional/transit.json` records the early candidate-5 cold-island
probe at source hash `dd239932b0e47b9f6a22ca7b106f05eb09fc59a72f003db201a2222e68ac1f8f`.
It predates the wake correction and differs from the screenshot/motion source hash
`b0b1d1b7991f30d67164c7a0dcec0c58ac132fb12ffd28f49db694eac6d37609`.
It is diagnostic evidence, not a certified measurement of the final candidate.
Both profiles released land textures/geometries after empty-ocean visits with zero
retained renderer-count deltas after the two cycles. The worst completed cold render was **721.4 ms** in the phone profile and
**680.2 ms** in fallback on SwiftShader. These diagnostic stalls are not physical
phone measurements. Cold-build cost remains a separate concern from warm render
timing and is being investigated.

Candidate 6 adds a coherent full-width carrier deck, airfield service-yard detail,
restrained vegetation colors, a 149,756-byte WebP runtime ground texture and bounded
reuse of detached island geometry/textures. The original generated PNG remains for
provenance, but is not downloaded by the game. Median screenshot gain over candidate
5 is **0.180**; no judge lowered a numeric readability category. This passes that
pair's screenshot criteria only. Judge B still observes reduced pale-aircraft
contrast over brighter decks, while generic particles and limited local lighting
remain weaknesses. All three reference means remain above Pacific Skies.

Candidate 6 is frozen in runtime commit `981241d`; its captures and transit report
share source hash `61c5ca830e59baece895abdcc1d35c1fb082468616ac99e2cd9c16e6c1fd4514`.
The report's earlier commit/dirty fields are preserved from capture time; the source
hash identifies the captured bytes. `evidence/transit-6/transit.json` confirms bounded
detached-cache accounting and complete resource release on reset. Empty views now
intentionally retain a bounded detached island, rather than disposing everything.
This cache does **not** cap the active world, driver overhead or temporary build
allocations. It also does **not solve the first cold build**: worst completed cold
render remains **726.1 ms** phone and **638.2 ms** fallback on SwiftShader.
Warm cache reuse must not hide those stalls or stand in for physical phone testing.

Candidate 6 `npm test` passed in an isolated checkout: browser checks, expedition,
recovery/navigation, combat balance, and fun audit. The audit reported 25 ok,
5 warnings and 2 pre-existing fun-killers with no regressions. Candidate 5's
rejected motion review does not approve candidate 6. Current-source motion review,
matched performance acceptance and physical-device validation remain outstanding.

There are no physical low-end phone measurements, no held-out comparable
gameplay-reference victory, and no claim of phone FPS.

## Initial experiment archive

## What changed

- Manual-frame mode removes the competing RAF loop from the old benchmark.
- Five fixed scenes, two phone tiers, screenshot hashes, source hashes and matched
  timing reports make future comparisons reproducible.
- Aircraft paint is baked into vertex colors and identical material properties
  are batched together. PBR settings, dimensioned shapes, markings and propellers
  remain intact. Stress draw calls fall **305 → 79**; fleet **17 → 7**.
- Candidate 1: tapered feathered wakes and soft particle edges, reducing obstruction.
- Candidate 2: quieter terrain palette and relief, finer low-contrast surface detail,
  cultivation excluded around installations, and a less repetitive wake pattern.
- CI captures PRs and checks recorded reviews. AGENTS.md requires three visual judges
  for future changes. This is not an unattended external judge service.

## Visual results

Computed from category arrays in reviews.json (not the judges' hand-calculated totals):

| Judge | Baseline | Candidate 1 | Candidate 2 | Reference mean |
|---|---:|---:|---:|---:|
| judge_protocol | 3.19 | 3.65 | 3.85 | 8.03 |
| reference_judge | 3.96 | 4.29 | 4.55 | 8.32 |
| third_judge | 3.23 | 3.63 | 3.95 | 8.00 |

The judges preferred both iterations with no screenshot-visible readability
regression. They did **not** approve the whole candidate: performance and motion
remain gates. Remaining weaknesses: patterned terrain, ruler-straight coastline,
flat airfield/carrier surfaces, sparse base detail, labels across the action and
faint effects. Models are not currently the highest-priority visual bottleneck.

Publication was explicitly approved. [Draft PR #17](https://github.com/waldher/pacific-skies/pull/17)
preserves the initial checkpoint; subsequent local experiments are described below.
Screenshot artifact uploading is enabled. The draft is not approved for merge.

## Performance — still rejected

Three alternating baseline/candidate runs, 180 completed-GPU samples per scene.
No concurrent functional test load. Median of each run's p95, milliseconds:

| Scene | Baseline | Candidate 2 | Change |
|---|---:|---:|---:|
| Phone airfield | 29.00 | 30.10 | +3.8% |
| Phone coast | 25.70 | 26.20 | +1.9% |
| Phone fleet | 16.30 | 14.40 | -11.7% |
| Phone dogfight | 16.60 | 17.60 | **+6.0% — fail** |
| Phone stress | 26.80 | 24.50 | -8.6% |
| Fallback airfield | 16.40 | 16.50 | +0.6% |
| Fallback coast | 15.10 | 15.20 | +0.7% |
| Fallback fleet | 7.10 | 8.00 | **+12.7% — fail** |
| Fallback dogfight | 10.20 | 11.10 | **+8.8% — fail** |
| Fallback stress | 19.20 | 16.70 | -13.0% |

These are SwiftShader render-cost proxies, not measured phone FPS. The 5% limit
is unchanged. Earlier 60-sample matched runs are preserved as `perf-short-*`;
initial 30-sample visual-capture timings overlapped functional tests and are not
used as performance evidence. Longer runs were used to investigate variance,
not selectively selected by scene; the whole final run set is retained.

Motion review is pending. A physical low-end phone was not available here;
no device FPS, thermal stability or reference superiority is claimed.

## Evidence integrity and next iteration

- The initial visual reports lacked source hashes. All three code states were
  reconstructed and recaptured with source metadata. **All 30 image SHA-256 values
  were byte-for-byte identical** to the actually reviewed images; scores therefore
  carry forward unchanged. Capture commit IDs precede the experiment; exact source
  hashes and dirty-state flags identify the reviewed runtime.
- The historical baseline differs from original main only by manual-frame/debug
  instrumentation. Aircraft and scenery source are otherwise original.
- Gate validation tests cover accepted synthetic fixtures, stale source, missing
  judges/motion, tampered screenshots, wrong performance source, duplicate scenes
  and regressions. Synthetic scores exist only in temporary unit-test directories.
- The review gate correctly exits nonzero for the three regressions and missing
  motion evidence. Do not treat a green capture job as candidate acceptance.

Next work: isolate the timing regressions by testing batching, wake and particles
separately; collect real animated hit/explosion evidence; then add coherent contact
shading, airfield aprons/taxiways and ship deck depth. Recapture and judge each
candidate. Obtain HUD-on reference gameplay and held-out scenes before a victory
claim. Keep this draft unmerged until those incremental gates pass.

## Validation

`npm test` passed: browser functional checks, expedition/recovery/navigation,
combat balance and fun audit. The fun audit reported no regressions against its
existing baseline (25 ok, 5 warnings, 2 pre-existing fun-killers).
All eight evidence-gate unit tests passed. `git diff --check` passed.
`npm run graphics:gate` correctly **failed** for the three timing regressions and
missing motion review listed above. This is expected evidence, not a passing
acceptance result.
