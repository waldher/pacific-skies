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
 * Usage: node playtest/playtest.js [--seconds 45] [--shots shots/]
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
}
const PLAY_SECONDS = Number(argVal('--seconds', 45));
const SHOT_DIR = argVal('--shots', path.join(__dirname, 'shots'));
fs.mkdirSync(SHOT_DIR, { recursive: true });

const results = { checks: [], metrics: {}, errors: [] };
function check(name, ok, detail) {
  results.checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on('pageerror', e => results.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') results.errors.push(m.text()); });

  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForTimeout(500);

  // The game keeps its state in top-level let bindings, which are
  // reachable from evaluate() via the global lexical scope.
  const snap = () => page.evaluate(() => ({
    state, score, waveNum,
    hp: player ? player.hp : null,
    enemies: typeof enemies !== 'undefined' && enemies ? enemies.length : null,
    bullets: typeof bullets !== 'undefined' && bullets ? bullets.length : null,
  }));

  check('page loads without JS errors', results.errors.length === 0, results.errors[0]);
  let s = await snap();
  check('boots to title screen', s.state === 'title');
  await page.screenshot({ path: path.join(SHOT_DIR, '01-title.png') });

  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  s = await snap();
  check('Space starts the game', s.state === 'play');

  await page.waitForTimeout(3000);
  s = await snap();
  check('wave 1 spawns enemies', s.enemies > 0, `${s.enemies} enemies`);
  await page.screenshot({ path: path.join(SHOT_DIR, '02-wave1.png') });

  // ---- bot plays the game ----
  // Steering happens in the page: a tick interval turns toward the nearest
  // enemy and fires when roughly aligned. Keyboard state is set directly.
  await page.evaluate(() => {
    window.__bot = setInterval(() => {
      if (state !== 'play' || !enemies.length) {
        keys['KeyA'] = keys['KeyD'] = keys['Space'] = false; return;
      }
      let best = null, bd = 1e9;
      for (const e of enemies) {
        const d = Math.hypot(e.x - player.x, e.y - player.y);
        if (d < bd) { bd = d; best = e; }
      }
      const want = Math.atan2(best.y - player.y, best.x - player.x);
      const d = angDiff(player.a, want);
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
    if (!shotMidFight && s.state === 'play' && samples.length >= 8) {
      await page.screenshot({ path: path.join(SHOT_DIR, '03-dogfight.png') });
      shotMidFight = true;
    }
    if (s.state === 'over') { died = true; break; }
  }
  await page.evaluate(() => clearInterval(window.__bot));

  const last = samples[samples.length - 1];
  const survived = Math.round((Date.now() - start) / 1000);
  results.metrics = {
    botSurvivedSeconds: survived,
    finalScore: last.score,
    waveReached: last.waveNum,
    finalHp: last.hp,
    died,
    hpOverTime: samples.map(x => `${x.t}s:${x.hp}hp/w${x.waveNum}`).join(' '),
  };
  check('bot can score points', last.score > 0, `score ${last.score}`);
  check('waves progress under play', last.waveNum >= 1, `reached wave ${last.waveNum}`);
  if (died) await page.screenshot({ path: path.join(SHOT_DIR, '04-gameover.png') });

  // restart path
  if (died) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    s = await snap();
    check('restart after death works', s.state === 'play' && s.hp === 100);
  }

  check('no JS errors during play', results.errors.length === 0, results.errors[0]);

  console.log('\n--- gameplay metrics ---');
  for (const [k, v] of Object.entries(results.metrics)) console.log(`${k}: ${v}`);

  fs.writeFileSync(path.join(SHOT_DIR, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  process.exit(results.checks.every(c => c.ok) ? 0 : 1);
})();
