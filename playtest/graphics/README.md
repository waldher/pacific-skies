# Graphics hill climb

Optimize visual quality subject to performance, never by inventing judge scores.
Current experiment status and unresolved gates: [STATUS.md](STATUS.md).

## Fixed protocol

- Five seeded scenes: airfield, coast, fleet, dogfight, stress (24 enemy planes,
  180 particles). Seed 1942; exact cameras and fixtures in `../graphics.cjs`.
- Both 852×393 touch profiles: native quality 2 and fallback quality 4, DPR 1.
  Never substitute the desktop tier for the phone result.
- Scene capture uses manual frames. The ordinary RAF loop does not run; simulation
  is held fixed. Traffic and propellers receive a fixed number of render steps.
  Visual captures use 30 samples; all matched performance runs use the same
  sample count, at least 60. Current final measurement uses 180.
- Scores 1–10: readability 30%, coherence 20%, lighting/depth 20%, environment
  15%, effects 15%. Three separate judges inspect every image, not just a montage.
  Every reviewer also scores the same reference images. Distinct agent sessions
  do not imply distinct underlying models or human validation.
- Require median visual gain ≥0.15 over the preceding candidate and no scene
  with a majority readability regression. Still compare to the original baseline.
- Alternate three baseline/candidate performance runs **sequentially on the same
  machine**, with no simultaneous functional tests/browser workloads. For every
  scene, the median of run p95 values must not regress by >5%. Preserve failed
  and exploratory runs. Investigate noise; do not cherry-pick or relax the gate.
- Motion review must cover actual hit feedback, smoke fading, wakes and camera
  movement, with an artifact hash, source hash and three reviewer findings.
- Ultimate target: beat each reference on held-out comparable gameplay scenes,
  and test a physical low-end Android phone for at least ten minutes: sustained
  30 FPS floor, 60 FPS target, p95 frame time ≤33.3 ms. Record device, browser,
  quality/resolution, heat state and frame-time samples. Snapdragon 680-class,
  4 GB Android is a provisional device class, not a measured certification.

## Commands

```sh
npm install
npx playwright install --with-deps chromium
GRAPHICS_OUT=playtest/shots/candidate GRAPHICS_SAMPLES=30 npm run graphics:capture
GRAPHICS_OUT=playtest/shots/perf-candidate-1 GRAPHICS_SAMPLES=180 npm run graphics:capture
npm run graphics:gate
npm run graphics:target
npm test
```

`GRAPHICS_OUT` selects an evidence directory. `PLAYWRIGHT_EXECUTABLE_PATH` may
select Chromium. Keep the same browser for matched runs. The benchmark uses
SwiftShader and readPixels completion; its milliseconds are render-cost proxies,
**not FPS on a phone**. It excludes simulation/HUD time and has no physical-device
thermal model. The first sample can include queued warmup work; the p95 uses
180 samples in final measurements. A future harness revision should drain warmup,
retain raw timing samples and record the actual GL backend; recapture all rounds
when changing the suite, rather than mixing protocol versions.

## Each iteration

1. Read aircraft decisions in `assets/aircraft/README.md` and `tools/reference/`.
   Models are generated through `tools/build-aircraft.mjs`; keep their recognizable
   proportions and required nodes. Changing engine is allowed when evidence
   supports it, not required to make progress.
2. Keep the original baseline and previous incumbent. Propose one hypothesis.
   Make the change on a branch; do not push experimental rendering to live main.
3. Capture the whole suite for each build using the exact same harness. For a
   historical build, apply only the manual-frame instrumentation from `main.js`
   and copy the harness/helper. Record that instrumentation, source hash and dirty
   state. Never silently compare a historical automatic RAF benchmark.
4. Give three judges anonymized, randomized A/B packets and frozen references.
   Keep the identity key outside their context until verdicts. Initial reviews
   here were **unblinded**, disclosed in `reviews.json`; they must not be presented
   as a blind experiment. Record evidence and score arrays, not rounded totals.
5. Append a round in `reviews.json.rounds`; add `evidence/<round>/report.json`
   and all PNGs. Bind report hashes, final runtime sourceHash and reference-manifest
   hash. Each reviewer supplies arrays for every round/scene and reference.
   The gate calculates weighted scores itself because hand-computed totals can err.
6. Retain three matched performance reports as `evidence/perf-base-{1,2,3}.json`
   and `perf-candidate-{1,2,3}.json`. They must match source, suite, camera, seed,
   viewport, quality, browser and sample count. Keep prior measurements separately.
7. Run the gate, motion review and functional suite. Reject/revise failures.
   A draft PR is a place to preserve incomplete experiments, not an accepted winner.

`graphics.yml` captures every PR and runs the evidence gate. Runtime or asset
edits invalidate old reviews. Its `review` job deliberately fails while evidence
is missing or a candidate regresses. GitHub required-status/branch-protection
settings are separate; this change does not claim to configure them.

This workflow does not invoke a paid external vision API or create an unattended
agent service. The implementing agent obtains the three reviewer sessions; CI
verifies their recorded evidence. Never replace missing judges with synthetic
scores or turn a pending gate into success.

## References

Exact official publisher URLs, source pages and SHA-256 hashes are frozen in
`references.json`. Download and verify the originals before review; fit the full
image into the same phone display area without favorable cropping. Initial
reference previews were 693×390, preserving their 16:9 framing. The Pacific frame
is wider, 852×393; this is a disclosed comparability limitation, not a victory test.

Door Kickers 2 images are publisher gameplay screenshots. StarCraft II and
Company of Heroes 3 images are HUD-free in-engine promotional views, and SC2 has
closer framing. They set art targets; their gameplay readability and phone
performance are not established. Obtain comparable HUD-on gameplay and held-out
scenes before setting `comparableGameplayReferences` or claiming superiority.
Reference images are not redistributed in this repository.
