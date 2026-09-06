# Pacific Skies — 1942

Top-down arcade dogfighter over the Pacific. Three.js / WebGL 2, native ES
modules, no build step. A transparent Canvas overlay draws the HUD and touch controls.

**Play it:** https://waldher.github.io/pacific-skies/

- Desktop: WASD/arrows to fly, Space to fire
- Mobile: left thumb steers, right thumb fires

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
instance cleanup, and the existing combat loop. Run `npx playwright install chromium`
after installing the test dependencies. Headless checks use software WebGL;
check performance on physical mobile devices before a release.
