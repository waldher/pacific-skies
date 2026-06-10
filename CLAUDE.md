# Pacific Skies — 1942

Top-down free-roam arcade dogfighter over the Pacific. Pure HTML5
canvas, native ES modules, zero dependencies, no build step.
Deployed via GitHub Pages straight from `main` — every push to main
is live at https://waldher.github.io/pacific-skies/ within minutes.

## Design pillars

- **Arcade, not sim.** Sessions are 1–5 minutes, restart is instant,
  one input scheme per platform (keyboard / two thumbs).
- **Zero tooling.** No bundler, no framework, no assets — graphics
  are canvas vectors, audio is WebAudio synthesis, world is hash
  noise. Keep it that way unless a feature truly demands more.
- **main is production.** It must always be a playable game.

## Architecture

`index.html` is a thin shell; everything lives in `src/`:

| File | Responsibility |
|---|---|
| `main.js` | game loop, bullet movement/collisions, waves, camera, render order, debug handle |
| `state.js` | the shared mutable `game` object + `startGame()` |
| `config.js` | **all** gameplay tuning constants |
| `util.js` | math helpers, hash noise, seedable RNG (`setSeed`/`rand`) |
| `canvas.js` | canvas/ctx, resize, `view {W,H}`, world→screen `w2s` |
| `input.js` | keyboard + touch (virtual stick left half, fire right half) |
| `player.js` | flight model, firing, damage, death |
| `enemies.js` | wave spawning, pursuit AI, enemy fire, ramming |
| `particles.js` | explosions, smoke, particle sim/draw |
| `world.js` | procedural ocean + islands |
| `sprites.js` | vector plane sprites, `rr` rounded-rect helper |
| `hud.js` | HUD, wave banner, off-screen arrows, touch UI, menus |
| `audio.js` | procedural sfx |

Conventions:

- Game state mutations go through the shared `game` object from
  `state.js`. `game.mode` is `title | play | over`.
- Tuning numbers belong in `config.js`, never inline. A balance
  change should be a one-line diff there.
- Gameplay randomness must use `rand()` from `util.js` (seedable for
  deterministic playtests), not `Math.random()` directly.
- `window.__game` (set in `main.js`) is the debug/test API: live
  `game` state, `CONFIG`, `startGame`, `setSeed`, `keys`. The
  playtest harness depends on it — keep it working.

## Running

Serve over HTTP (ES modules don't load from `file://`):

    npm run serve        # http-server on :8080

## Testing

    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=/opt/node22/lib/node_modules npm test

(The env vars are for the Claude Code cloud container, where
playwright and chromium are preinstalled globally. In CI or after a
local `npm install`, plain `npm test` works.)

`playtest/playtest.js` boots the game headless, runs functional
checks (load, start, spawn, score, death, restart, zero JS errors),
then a bot plays with a seeded RNG while sampling hp/score/wave per
second. Screenshots land in `playtest/shots/` (gitignored). Exit
code is nonzero on any failed check — run it before every push, and
compare its metrics before/after when changing anything in
`config.js`. CI (`.github/workflows/playtest.yml`) runs it on every
push and PR.

When evaluating gameplay changes, look at the screenshots too —
visual readability is part of the game being good.

## Backlog

Feature ideas and known gameplay issues live in `IDEAS.md`.
