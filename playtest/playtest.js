#!/usr/bin/env node
/*
 * Headless playtest harness for Pacific Skies.
 *
 * Functional checks: page loads cleanly, game starts on the carrier
 * deck, takeoff works, island defenders spawn, strafing captures an
 * island, landing on the carrier rearms/repairs, the win state fires
 * when all islands are held, death and restart work.
 * Gameplay probe: a simple bot (take off, chase the nearest enemy
 * plane or island structure, fire when aligned) plays for a fixed
 * duration while we sample hp/ammo/score/islands per second.
 *
 * The game is served over HTTP (ES modules don't load from file://)
 * and inspected through the window.__game debug handle. The RNG is
 * seeded so runs are comparable across balance changes.
 *
 * Usage: node playtest/playtest.js [--seconds 60] [--seed 1942] [--shots shots/]
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
}
const PLAY_SECONDS = Number(argVal('--seconds', 60));
const SEED = Number(argVal('--seed', 1942));
const SHOT_DIR = argVal('--shots', path.join(__dirname, 'shots'));
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };

const results = { checks: [], metrics: {}, errors: [] };
function check(name, ok, detail) {
  results.checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  // tiny static server; ephemeral port avoids collisions
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on('pageerror', e => results.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') results.errors.push(m.text()); });

  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForTimeout(500);

  const snap = () => page.evaluate(() => {
    const g = window.__game.game;
    return {
      mode: g.mode, score: g.score,
      hp: g.player ? g.player.hp : null,
      ammo: g.player ? g.player.ammo : null,
      phase: g.player ? g.player.phase : null,
      enemies: g.enemies.length,
      owned: g.islands.filter(i => i.owner === 'player').length,
      islands: g.islands.length,
    };
  });

  check('page loads without JS errors', results.errors.length === 0, results.errors[0]);
  check('debug handle exposed', await page.evaluate(() => !!window.__game));
  let s = await snap();
  check('boots to title screen', s.mode === 'title');
  await page.screenshot({ path: path.join(SHOT_DIR, '01-title.png') });

  await page.evaluate(seed => window.__game.setSeed(seed), SEED);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  s = await snap();
  check('Space starts the game on the deck', s.mode === 'play' && s.phase === 'deck');
  check('island garrisons spawn', s.enemies > 0, `${s.enemies} defenders`);
  await page.screenshot({ path: path.join(SHOT_DIR, '02-deck.png') });

  // ---- bot plays the game ----
  // The bot holds boost on the deck, then chases the nearest enemy
  // plane (or island structure when the sky is clear) and fires when
  // roughly aligned.
  await page.evaluate(() => {
    const { game, keys, angDiff } = window.__game;
    const off = () => { keys['KeyA'] = keys['KeyD'] = keys['KeyW'] = keys['KeyS'] = keys['Space'] = false; };
    window.__bot = setInterval(() => {
      if (game.mode !== 'play') { off(); return; }
      const p = game.player;
      if (p.phase === 'deck') { off(); keys['KeyW'] = true; return; }
      let tx = 0, ty = 0, td = 1e9;
      for (const e of game.enemies) {
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < td) { td = d; tx = e.x; ty = e.y; }
      }
      if (td > 900) {
        for (const isl of game.islands) {
          if (isl.owner !== 'enemy') continue;
          for (const st of isl.structures) {
            if (st.hp <= 0) continue;
            const x = isl.x + st.dx, y = isl.y + st.dy;
            const d = Math.hypot(x - p.x, y - p.y);
            if (d < td) { td = d; tx = x; ty = y; }
          }
        }
      }
      if (td > 1e8) { off(); return; }
      const want = Math.atan2(ty - p.y, tx - p.x);
      const d = angDiff(p.a, want);
      keys['KeyA'] = d < -0.05; keys['KeyD'] = d > 0.05;
      keys['KeyW'] = td > 300; keys['KeyS'] = td < 120;
      keys['Space'] = Math.abs(d) < 0.3 && td < 600 && p.ammo > 0;
    }, 50);
  });

  await page.waitForTimeout(2500);
  s = await snap();
  check('deck run takes off', s.phase === 'air');
  await page.screenshot({ path: path.join(SHOT_DIR, '03-takeoff.png') });

  const samples = [];
  const start = Date.now();
  let died = false, won = false, shotMidFight = false;
  while ((Date.now() - start) / 1000 < PLAY_SECONDS) {
    await page.waitForTimeout(1000);
    s = await snap();
    samples.push({ t: Math.round((Date.now() - start) / 1000), ...s });
    if (!shotMidFight && s.mode === 'play' && samples.length >= 8) {
      await page.screenshot({ path: path.join(SHOT_DIR, '04-dogfight.png') });
      shotMidFight = true;
    }
    if (s.mode === 'over') { died = true; break; }
    if (s.mode === 'win') { won = true; break; }
  }
  await page.evaluate(() => clearInterval(window.__bot));
  await page.evaluate(() => {
    const { keys } = window.__game;
    keys['KeyA'] = keys['KeyD'] = keys['KeyW'] = keys['KeyS'] = keys['Space'] = false;
  });

  const last = samples[samples.length - 1];
  results.metrics = {
    seed: SEED,
    botSurvivedSeconds: Math.round((Date.now() - start) / 1000),
    finalScore: last.score,
    islandsOwned: `${last.owned}/${last.islands}`,
    finalHp: last.hp,
    finalAmmo: Math.round(last.ammo),
    died, won,
    hpOverTime: samples.map(x => `${x.t}s:${x.hp}hp/${Math.round(x.ammo)}am/${x.owned}isl`).join(' '),
  };
  check('bot can score points', last.score > 0, `score ${last.score}`);
  check('bot spends ammo', last.ammo < (await page.evaluate(() => window.__game.CONFIG.player.ammoMax)), `ammo ${Math.round(last.ammo)}`);

  // ---- deterministic functional checks ----
  if (died || won) {
    // get back into a live run for the functional checks
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
  }

  // strafing destroys defenses and flips the island: inject bullets
  // directly onto the structures of the first enemy-held island
  const captured = await page.evaluate(async () => {
    const { game } = window.__game;
    // park the player out of harm's way so AA/defenders don't muddy the test
    game.player.x = 0; game.player.y = 8000;
    const isl = game.islands.find(i => i.owner === 'enemy');
    if (!isl) return 'no-enemy-island';
    for (let i = 0; i < 80 && isl.owner === 'enemy'; i++) {
      for (const st of isl.structures) {
        if (st.hp <= 0) continue;
        game.bullets.push({ x: isl.x + st.dx, y: isl.y + st.dy, vx: 0, vy: 0, life: 0.05 });
      }
      await new Promise(r => setTimeout(r, 40));
    }
    return isl.owner;
  });
  check('destroying all defenses captures the island', captured === 'player', `owner: ${captured}`);
  await page.screenshot({ path: path.join(SHOT_DIR, '05-capture.png') });

  // landing on the carrier repairs and rearms; make sure we're
  // airborne first (a mid-run restart leaves the player parked)
  s = await snap();
  if (s.phase === 'deck') {
    await page.evaluate(() => { window.__game.keys['KeyW'] = true; });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { window.__game.keys['KeyW'] = false; });
  }
  await page.evaluate(() => {
    const { game, CONFIG } = window.__game;
    const C = CONFIG.carrier, p = game.player;
    p.x = C.x; p.y = C.y; p.a = C.a; p.speed = 100;
    p.airT = 10; p.hp = 47; p.ammo = 3;
  });
  await page.waitForTimeout(400);
  s = await snap();
  check('slow aligned approach lands on the deck', s.phase === 'deck');
  await page.waitForTimeout(2600);
  s = await snap();
  check('deck crew repairs and rearms', s.hp === 100 && s.ammo >= 140, `hp ${s.hp} ammo ${Math.round(s.ammo)}`);

  // and we can take off again
  await page.evaluate(() => { window.__game.keys['KeyW'] = true; });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__game.keys['KeyW'] = false; });
  s = await snap();
  check('relaunch after landing works', s.phase === 'air');

  // holding every island wins the run
  await page.evaluate(() => {
    for (const isl of window.__game.game.islands) isl.owner = 'player';
  });
  await page.waitForTimeout(300);
  s = await snap();
  check('holding all islands wins', s.mode === 'win');
  await page.screenshot({ path: path.join(SHOT_DIR, '06-victory.png') });

  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  s = await snap();
  check('restart after victory works', s.mode === 'play' && s.hp === 100 && s.phase === 'deck');

  // death ends the run: take off, then a kamikaze rams a weakened player
  await page.evaluate(() => { window.__game.keys['KeyW'] = true; });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const { game } = window.__game;
    window.__game.keys['KeyW'] = false;
    game.player.hp = 20;
    game.enemies.push({
      x: game.player.x, y: game.player.y, a: 0, speed: 0, turn: 0, hp: 1,
      ace: false, fireCd: 9, wobble: 0, role: 'hunter', home: null, target: null, orbitA: 0,
    });
  });
  await page.waitForTimeout(400);
  s = await snap();
  check('player can die', s.mode === 'over');
  await page.screenshot({ path: path.join(SHOT_DIR, '07-gameover.png') });

  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  s = await snap();
  check('restart after death works', s.mode === 'play' && s.hp === 100);

  check('no JS errors during play', results.errors.length === 0, results.errors[0]);

  console.log('\n--- gameplay metrics ---');
  for (const [k, v] of Object.entries(results.metrics)) console.log(`${k}: ${v}`);

  fs.writeFileSync(path.join(SHOT_DIR, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  server.close();
  process.exit(results.checks.every(c => c.ok) ? 0 : 1);
})();
