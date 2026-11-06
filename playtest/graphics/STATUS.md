# Initial graphics experiment — 2026-11-06

**Experimental, not accepted; do not merge. The reference-quality goal is not met.**
Three separate agent judges reviewed all 30 Pacific Skies screenshots and five
publisher reference images. Review was unblinded and used the same model family.
Scores are subjective screenshot judgments, not whole-game quality measurements.

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

Publication was explicitly approved by the user. This draft preserves the initial
reviewed checkpoint, including all 30 PNGs and hashed reports. Further graphics
iterations are in progress; this checkpoint is not an accepted winner.

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
