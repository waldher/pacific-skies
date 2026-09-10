# Pacific Skies — 1942

Top-down arcade dogfighter over the Pacific. Three.js / WebGL 2, native ES
modules, no build step. Responsive HTML readouts show status and instructions; a transparent Canvas overlay draws world markers and touch controls.

**Play it:** https://waldher.github.io/pacific-skies/

- Desktop: WASD/arrows to fly, Space to fire, T to release ordnance, L to take off.
- Mobile: left thumb steers, right thumb fires; tap Bomb/Torpedo in flight and Take Off while parked.

Start in a P-38 Lightning at a friendly airfield. Every campaign generates a new
chain of five to seven enemy islands, with wider open-water passages between bases. Clear fighters and patrol ships, bomb any
airfield facilities, then hold the island for six seconds to capture it. Captured
airfields become departure bases. Capture all islands and sink the enemy fleet to win.

Enemy airfields and a patrolling enemy carrier launch interceptable strike groups
at nearby friendly holdings. Bombers attack islands, torpedo flights attack carriers,
and escorts engage you. These attack roles currently share the Zero model. Destroying
a launch site stops future launches. Losing a base is recoverable while another usable
base remains. Raids can overrun captured islands; retaking one never awards capture points twice.
Landing there repairs its facilities as well as your plane.

At 2,500 points, a friendly carrier needs rescue. Its rescue attack starts when you approach,
so earning rank far away does not waste the mission. Intercept at least two of its three
attackers, clear the rescue group, and rendezvous near the carrier to unlock the
naval operations. Aircraft qualifications are earned separately. Failed rescues can be retried after 45 seconds.

Land by aligning with a friendly runway's painted arrow, or with a carrier's bow.
The approach stays manual, with a forgiving heading/offset window. P-38s use
land airfields; Corsairs can use either base type. While safely landed, the sortie
panel lets you choose a friendly departure base, unlocked aircraft, and loadout.
Take off when ready; base transfer is unavailable in flight.

Each loadout has two bombs or two torpedoes. Bombs drift forward before impact
and strike ground targets; only an exact impact on a ship hull damages it. Water
near-misses splash harmlessly; torpedoes run on the surface and only hit ships.
Bullets only damage aircraft. Landing immediately reloads both weapons. Aircraft
selection uses renders of the actual flight models. Single loadouts are shown as
summaries; aircraft and weapon alternatives become selectable cards. Aircraft
unlocks and territory ownership last for the current campaign; restarting creates
a new campaign.

Two allied P-38s patrol independently and engage enemies. Occasional roaming
Zeros still pursue you anywhere, without incoming-fighter announcements.

Aircraft unlock during each campaign:

| Aircraft | Unlock | Role |
|---|---|---|
| P-38 Lightning | Starting aircraft | Fast land-based interceptor with bombs |
| SBD Dauntless | 1,800 points + 3 combat sorties | Slower bomber; one heavy bomb disables an airfield |
| F4U Corsair | Rescue + 5 combat sorties | Versatile naval fighter with bombs or torpedoes |
| TBF Avenger | Rescue + 4,000 points + 8 combat sorties | Slower torpedo specialist; two heavy torpedoes sink an enemy carrier |
| P-51 Mustang | Rescue + 6,000 points + 12 combat sorties | Fastest fighter, land-based, with bombs |

All aircraft carry two rounds of their selected ordnance. Dauntless, Corsair and
Avenger can use carrier decks once the carrier is rescued; P-38 and P-51 require
an airfield. The sortie panel shows the next unlock. Touch throttle respects each
aircraft's speed range, just like keyboard controls.

A combat sortie counts when you land after personally hitting a hostile ground/sea
target or destroying an aircraft since takeoff. Empty circuits, idle time and allied
kills do not qualify. The end menu has an optional campaign report with territory
changes, carrier losses, raid damage, personal interceptions and unlock times.

Islands have distinct roles: airfields offer landing and repair, ports supply fleet
repairs, and radar stations extend raid detection. Newly captured holdings start damaged
and take 90 seconds to establish their defenses and benefits. Capturing a frontline
island draws attacks away from more distant holdings. Early raids have a preparation
window; subsequent launch intervals vary by seed.

## Develop

```sh
npm run serve   # serve locally on :8080
npm test        # headless playtest (needs playwright + chromium)
npm run test:simulation # functional campaign checks
npm run test:balance    # repeatable raid strategy comparisons
```

See `CLAUDE.md` for architecture and conventions, `IDEAS.md` for the
backlog.

## 3D rendering

All six aircraft types load directly from local GLB files with lighting, shadows,
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

The aircraft GLBs are generated from real dimensions by `tools/build-aircraft.mjs`
(`npm run build:aircraft`); the reference measurements and the three-view
drawings they came from are in `tools/reference/`.

The playtest checks GLB loading, heading alignment, banking, propellers, resize,
instance cleanup, naval combat, capture persistence, victory, and carrier recovery. Run `npx playwright install chromium`
after installing the test dependencies. Headless checks use software WebGL;
check performance on physical mobile devices before a release.
