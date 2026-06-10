#!/usr/bin/env node
/*
 * Headless playtest harness for Pacific Skies.
 *
 * Functional checks: page loads cleanly, game starts, entities spawn,
 * shooting kills enemies, player can die, restart works.
 * Gameplay probe: a simple bot (turn toward nearest enemy, hold fire)
 * plays for a fixed duration while we sample metrics that proxy for
 * difficulty and pacing.
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
      mode: g.mode, score: g.score, waveNum: g.waveNum,
      hp: g.player ? g.player.hp : null,
      enemies: g.enemies.length, bullets: g.bullets.length,
    };
  });

  check('page loads without JS errors', results.errors.length === 0, results.errors[0]);
  check('debug handle exposed', await page.evaluate(() => !!window.__game));
  let s = await snap();
  check('boots to title screen', s.mode === 'title');
  await page.screenshot({ path: path.join(SHOT_DIR, '01-title.png') });

  await page.evaluate(seed => window.__game.setSeed(seed), SEED);
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  s = await snap();
  check('Space starts the game', s.mode === 'play');

  await page.waitForTimeout(3000);
  s = await snap();
  check('wave 1 spawns enemies', s.enemies > 0, `${s.enemies} enemies`);
  await page.screenshot({ path: path.join(SHOT_DIR, '02-wave1.png') });

  // ---- bot plays the game ----
  // Steering happens in the page: a tick interval turns toward the
  // nearest enemy and fires when roughly aligned.
  await page.evaluate(() => {
    const { game, keys, angDiff } = window.__game;
    window.__bot = setInterval(() => {
      if (game.mode !== 'play' || !game.enemies.length) {
        keys['KeyA'] = keys['KeyD'] = keys['Space'] = false; return;
      }
      const p = game.player;
      let best = null, bd = 1e9;
      for (const e of game.enemies) {
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < bd) { bd = d; best = e; }
      }
      const want = Math.atan2(best.y - p.y, best.x - p.x);
      const d = angDiff(p.a, want);
      keys['KeyA'] = d < -0.05; keys['KeyD'] = d > 0.05;
      keys['KeyW'] = bd > 300; keys['KeyS'] = bd < 120;
      keys['Space'] = Math.abs(d) < 0.3 && bd < 600;
    }, 50);
  });

  const samples = [];
  const start = Date.now();
  let died = false, shotMidFight = false;
  while ((Date.now() - start) / 1000 < PLAY_SECONDS) {
    await page.waitForTimeout(1000);
    s = await snap();
    samples.push({ t: Math.round((Date.now() - start) / 1000), ...s });
    if (!shotMidFight && s.mode === 'play' && samples.length >= 8) {
      await page.screenshot({ path: path.join(SHOT_DIR, '03-dogfight.png') });
      shotMidFight = true;
    }
    if (s.mode === 'over') { died = true; break; }
  }
  await page.evaluate(() => clearInterval(window.__bot));

  const last = samples[samples.length - 1];
  const survived = Math.round((Date.now() - start) / 1000);
  results.metrics = {
    seed: SEED,
    botSurvivedSeconds: survived,
    finalScore: last.score,
    waveReached: last.waveNum,
    finalHp: last.hp,
    died,
    hpOverTime: samples.map(x => `${x.t}s:${x.hp}hp/w${x.waveNum}`).join(' '),
  };
  check('bot can score points', last.score > 0, `score ${last.score}`);
  check('waves progress under play', last.waveNum >= 1, `reached wave ${last.waveNum}`);
  if (died) {
    await page.screenshot({ path: path.join(SHOT_DIR, '04-gameover.png') });
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    s = await snap();
    check('restart after death works', s.mode === 'play' && s.hp === 100);
  }

  check('no JS errors during play', results.errors.length === 0, results.errors[0]);

  console.log('\n--- gameplay metrics ---');
  for (const [k, v] of Object.entries(results.metrics)) console.log(`${k}: ${v}`);

  fs.writeFileSync(path.join(SHOT_DIR, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  server.close();
  process.exit(results.checks.every(c => c.ok) ? 0 : 1);
})();
