# Pacific Skies — 1942

Top-down arcade dogfighter over the Pacific. Three.js / WebGL 2, native ES
modules, no build step. Responsive HTML readouts show status and instructions; a transparent Canvas overlay draws world markers and touch controls.

**Play it:** https://waldher.github.io/pacific-skies/

- Desktop: WASD/arrows to fly, Space to fire, T to drop a torpedo, L to take off from the carrier
- Mobile: left thumb steers, right thumb fires; use TORPEDO in flight and TAKE OFF when on deck.

Clear each island’s fighters and patrol destroyers, then hold its marked airspace
for six seconds to capture it. Secure all four territories to win. Ownership lasts
until you restart; defenders do not respawn in waves. Ships require torpedoes; bullets only damage aircraft.

Return to the friendly carrier from behind its stern, aligned with the deck centerline
and pointing toward the bow. Landing accepts up to 25° of heading error and 24 units of lateral offset. You can
correct your alignment over the rear half of the deck after crossing the stern;
you still steer the approach yourself. Repairs restore health while parked.
Press L or TAKE OFF to launch when ready. The minimap shows islands and your carrier.

Carry two torpedoes per sortie. T / TORPEDO drops a straight-running surface weapon;
a hit sinks a destroyer. There is a five-second release cooldown, a short arming run,
and limited range. Empty means return to the carrier: two seconds on deck reloads both.

Two friendly Corsairs fly their own patrol routes, engage nearby enemies and can be
shot down. Occasional roaming Zeros pursue you anywhere on the map, one at a time;
they do not count as island defenders or undo captured territory.

## Develop

```sh
npm run serve   # serve locally on :8080
npm test        # headless playtest (needs playwright + chromium)
```

See `CLAUDE.md` for architecture and conventions, `IDEAS.md` for the
backlog.

## 3D rendering

The Corsair and Zero load directly from local GLB files with lighting, shadows,
animated propellers, and banking in turns. An orthographic camera preserves the
original screen-to-world scale, controls, and combat tuning. The ocean, islands,
tracers, and particles render in Three.js; gameplay remains a top-down XY simulation.
The sea is a single shader: hash-noise ripples lit by the sun, sparse whitecaps,
sun glitter, drifting cloud shadows, turquoise shallows and surf around islands,
and splash rings where rounds hit the water. Tuning is in `CONFIG.render.ocean`.

Quality adapts to the device: the renderer times its own frames and steps down
`CONFIG.render.quality.levels` (pixel ratio, then ocean detail, then shadows)
while frames stay slow, stepping back up only into levels that never failed.
Aircraft shadows use a small receiver quad per aircraft rather than a
full-screen plane, and fall back to a soft blob on the lowest tier. Append
`?quality=N` (0 best … 4 lowest) to the URL to pin a level when testing.

Three.js 0.185.1 and its loader are vendored under `vendor/three/`, so GitHub Pages
can still serve this repository directly without a build or third-party CDN.
A browser with WebGL 2 is required. Loading failures show a retry screen; graphics
context loss pauses the simulation until recovery.

`src/renderer.js` owns the scene/camera and render lifecycle, `src/aircraft.js`
loads and animates models, `src/world.js` streams islands, and `src/effects.js`
batches tracers and particles. Visual tuning lives in `CONFIG.render`.

Both aircraft GLBs are generated from real dimensions by `tools/build-aircraft.mjs`
(`npm run build:aircraft`); the reference measurements and the three-view
drawings they came from are in `tools/reference/`.

The playtest checks GLB loading, heading alignment, banking, propellers, resize,
instance cleanup, naval combat, capture persistence, victory, and carrier recovery. Run `npx playwright install chromium`
after installing the test dependencies. Headless checks use software WebGL;
check performance on physical mobile devices before a release.
