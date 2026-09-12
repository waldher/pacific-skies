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
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/pacific-skies(?=\/)/, '');
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on('pageerror', e => results.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') results.errors.push(m.text()); });

  // Pin the quality level: under software rendering the adaptive ladder would
  // otherwise step down and change what the screenshots show.
  await page.goto(`http://127.0.0.1:${port}/pacific-skies/?quality=1`);
  await page.waitForFunction(() => window.__game?.rendering?.ready || window.__game?.rendering?.error,
    null, { timeout: 30000 });
  check('3D assets and renderer initialize', await page.evaluate(() => window.__game.rendering.ready),
    await page.evaluate(() => window.__game.rendering.error));
  await page.waitForTimeout(200);

  const snap = () => page.evaluate(() => {
    const g = window.__game.game;
    return {
      mode: g.mode, score: g.score, captured: g.territories.filter(t => t.owner === 'us').length,
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
  check('single-choice sortie is a visual summary without false controls', await page.locator('#sortie-panel button, #sortie-panel select').count() === 0);
  check('starting aircraft card displays a loaded GLB render', await page.locator('#sortie-aircraft img').evaluate(img => img.complete && img.naturalWidth === 256 && img.naturalHeight === 160 && img.src.startsWith('data:image/png')));
  check('starting airfield exposes sortie planning', await page.locator('#sortie-panel').isVisible());
  await page.screenshot({ path: path.join(SHOT_DIR, '01-airfield.png') });
  await page.getByRole('button', { name: /TAKE OFF/ }).click();
  await page.waitForFunction(() => window.__game.game.player.flight === 'flying');
  check('target and landing-request controls are absent in flight', await page.evaluate(() => !document.getElementById('target-action') && document.getElementById('carrier-action').hidden));
  await page.getByRole('button', { name: /BOMB/i }).click();
  check('bomb button drops one round', await page.evaluate(() => window.__game.game.player.bombAmmo === 1));
  await page.keyboard.press('t');
  check('keyboard ordnance respects cooldown', await page.evaluate(() => window.__game.game.player.bombAmmo === 1));
  await page.screenshot({ path: path.join(SHOT_DIR, '02-torpedo.png') });
  const modelChecks = await page.evaluate(async () => {
    const THREE = await import(new URL('vendor/three/three.module.min.js', location.href).href);
    const { graphics, game, view, CONFIG } = window.__game;
    const visual = graphics.aircraft.get(game.player);
    const original = game.player.a;
    let aligned = true;
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      game.player.a = a;
      graphics.render(game, view, 0, 0, 0);
      const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(visual.root.quaternion);
      aligned &&= Math.abs(nose.x - Math.cos(a)) < 1e-6 && Math.abs(nose.z - Math.sin(a)) < 1e-6;
    }
    game.player.a = -Math.PI / 2;
    graphics.render(game, view, 0, 0, 0);
    const size = new THREE.Box3().setFromObject(visual.model).getSize(new THREE.Vector3());
    game.player.a = original;
    graphics.render(game, view, 0, 0, 0);
    return {
      name: visual.model.name,
      propeller: !!visual.propeller,
      aligned,
      scale: Math.abs(size.x - CONFIG.render.aircraftWingspan) < 1,
      orthographic: graphics.camera.isOrthographicCamera,
    };
  });
  check('wingmen use P38 models', await page.evaluate(() => window.__game.game.allies.length > 0 && window.__game.game.allies.every(f => window.__game.graphics.aircraft.get(f)?.model.name === 'P38_Lightning')));
  check('friendly aircraft have independent damage flash materials', await page.evaluate(() => {
    const { graphics, game } = window.__game;
    const p = graphics.aircraft.get(game.player), f = graphics.aircraft.get(game.allies[0]);
    return p.ownedMaterials.length > 0 && f.ownedMaterials.length > 0 && p.ownedMaterials[0] !== f.ownedMaterials[0];
  }));
  check('player starts with a P38 model with animated propeller', modelChecks.name === 'P38_Lightning' && modelChecks.propeller);
  check('model noses match all four flight headings', modelChecks.aligned);
  check('orthographic camera preserves aircraft scale', modelChecks.orthographic && modelChecks.scale);
  const qualityChecks = await page.evaluate(() => {
    const { graphics, game, view, CONFIG } = window.__game;
    const results = [];
    for (let i = CONFIG.render.quality.levels.length - 1; i >= 0; i--) {
      graphics.quality.set(i);
      graphics.render(game, view, 0, 0, 0);
      const L = CONFIG.render.quality.levels[i];
      results.push(graphics.diagnostics.quality === i && graphics.renderer.shadowMap.enabled === L.shadows
        && graphics.diagnostics.pixelRatio === Math.min(view.DPR, L.pixelRatio));
    }
    graphics.quality.set(1);
    return results;
  });
  check('every quality level renders', qualityChecks.every(Boolean), qualityChecks.join(','));
  check('severe foreground stalls still reduce rendering quality', await page.evaluate(() => {
    const {graphics,game,view}=window.__game;
    const original=performance.now.bind(performance); let now=original();
    graphics.quality.set(0); graphics.quality.unlock();
    performance.now=()=>now;
    try {
      for(let i=0;i<32;i++){now+=300;graphics.render(game,view,0,0,0);}
      return graphics.quality.level>0;
    } finally {delete performance.now;graphics.quality.set(1);}
  }));
  check('failed quality levels are never retried', await page.evaluate(() => {
    const {graphics,game,view,CONFIG}=window.__game, Q=CONFIG.render.quality;
    const original=performance.now.bind(performance); let now=original();
    graphics.quality.set(1); graphics.quality.unlock();
    performance.now=()=>now;
    try {
      // Six slow seconds: the change hold eats the first three, settle needs two more.
      for(let i=0;i<60;i++){now+=100;graphics.render(game,view,0,0,0);}
      const dropped=graphics.quality.level;
      for(let i=0;i<(Q.hold+Q.recover)*100+50;i++){now+=10;graphics.render(game,view,0,0,0);}
      return dropped===2 && graphics.quality.level===2;
    } finally {delete performance.now;graphics.quality.set(1);}
  }));
  const scenery = await page.evaluate(() => {
    const { graphics } = window.__game, chunks = [...graphics.world.chunks.values()];
    const batches = chunks.map(group => group.children.filter(node => node.material?.vertexColors).length);
    return { chunks: chunks.length, biomes: chunks.map(g => g.userData.biome), trees: chunks.reduce((n, g) => n + g.userData.trees, 0),
      villages: chunks.reduce((n, g) => n + g.userData.villages, 0), batches, drawCalls: graphics.diagnostics.drawCalls };
  });
  check('islands carry biome scenery in one batched draw each', scenery.chunks > 0 && scenery.trees > 0 && scenery.batches.every(n => n === 1), `${scenery.biomes.join(',')} · ${scenery.trees} trees · ${scenery.villages} villages`);
  check('home airfield view stays under 80 draw calls', scenery.drawCalls < 80, `${scenery.drawCalls} draws`);
  results.metrics.homeDrawCalls = scenery.drawCalls;
  check('island traffic moves between frames', await page.evaluate(() => {
    const { graphics, game, view } = window.__game, pools = graphics.world.traffic.pools;
    const snapshot = () => Object.fromEntries(Object.entries(pools).map(([k, m]) => [k, [m.count, Array.from(m.instanceMatrix.array.slice(0, m.count * 16))]]));
    graphics.render(game, view, .5, 0, 0); const before = snapshot();
    game.time += .5; graphics.render(game, view, .5, 0, 0); const after = snapshot();
    const moved = Object.keys(pools).filter(k => before[k][0] > 0 && before[k][1].some((v, i) => Math.abs(v - after[k][1][i]) > .01));
    return before.people[0] > 0 && moved.includes('people') && (before.trucks[0] === 0 || moved.includes('trucks'));
  }));
  const propAngle = await page.evaluate(() => window.__game.graphics.aircraft.get(window.__game.game.player).propeller.rotation.z);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(350);
  check('right turn banks the 3D aircraft', await page.evaluate(() => window.__game.graphics.aircraft.get(window.__game.game.player).bank < -.1));
  check('propeller animates', await page.evaluate(old => window.__game.graphics.aircraft.get(window.__game.game.player).propeller.rotation.z !== old, propAngle));
  await page.keyboard.up('KeyD');
  await page.screenshot({ path: path.join(SHOT_DIR, '02-bank.png') });
  // Reset after the renderer probe so the gameplay bot retains its seeded setup.
  await page.evaluate(seed => { window.__game.setSeed(seed); window.__game.startGame(); }, SEED);

  const campaign = await page.evaluate(async () => {
    const { campaignChecks } = await import(new URL('playtest/campaign-checks.js', location.href).href);
    return campaignChecks(window.__game);
  });
  for (const result of campaign) check(result.name, result.ok);
  check('head-on fighters sidestep instead of ramming', await page.evaluate(() => {
    const { game, CONFIG, update, keys } = window.__game, p = game.player;
    for (const key of Object.keys(keys)) keys[key] = false;
    const far = game.theaterBounds; p.x = far.maxX + 4000; p.y = far.maxY + 4000; p.a = 0; p.flight = 'flying'; p.hp = 100; p.speed = CONFIG.aircraft.p38.speedCruise;
    game.cam.x = p.x; game.cam.y = p.y; game.enemies = []; game.allies = []; game.raidTimer = 999; game.convoyTimer = 999; game.time = 10;
    const e = { x: p.x + 500, y: p.y, a: Math.PI, hp: 2, speed: CONFIG.enemy.speed, turn: CONFIG.enemy.turn, fireCd: 99, wobble: 0, raider: true, style: 'recruit' };
    game.enemies.push(e);
    for (let i = 0; i < 150; i++) { e.fireCd = 99; update(.02); }
    const survived = p.hp === 100 && e.hp > 0;
    game.enemies = [];
    return survived;
  }));
  check('captured airfields launch patrols and the carrier flies a CAP', await page.evaluate(() => {
    const { game, CONFIG, update } = window.__game;
    game.allies = []; game.raidTimer = 999;
    const home = game.airfields.find(f => f.id === 'home-airfield'); home.patrolTimer = 0;
    const carrier = game.ships.find(s => s.id === 'carrier'); carrier.active = true; carrier.hp = carrier.maxHp; carrier.capTimer = 0;
    update(.02); update(.02); update(.02);
    const patrols = game.allies.filter(f => f.role === 'patrol'), cap = game.allies.filter(f => f.role === 'cap');
    const ok = patrols.length === CONFIG.airWar.patrol.size && cap.length >= 1 && cap.every(f => f.aircraft === 'corsair') && patrols.every(f => f.aircraft === 'p38');
    game.allies = game.allies.filter(f => f.role === 'wing'); carrier.active = false;
    return ok;
  }));
  const convoy = await page.evaluate(() => {
    const { game, CONFIG, update, spawnConvoy, graphics, view } = window.__game;
    game.convoys = []; game.convoyTimer = 999; game.allies = []; game.time = 10; game.enemies = [];
    if (!spawnConvoy()) return { ok: false, why: `no convoy route (${game.territories.filter(t => t.owner === 'enemy').length} enemy holdings, mode ${game.mode})` };
    const s = game.convoys[0], before = game.score, count = game.convoys.length;
    game.player.x = s.x - 200; game.player.y = s.y; game.player.flight = 'flying'; game.cam.x = s.x; game.cam.y = s.y;
    graphics.render(game, view, 0, 0, 0);
    const drawn = graphics.naval.ships.get(s)?.root.name === 'SupplyTransport';
    for (let i = 0; i < 40 && s.hp > 0; i++) {
      game.bullets.push({ x: s.x - 40, y: s.y, prevX: s.x - 40, prevY: s.y, vx: 860, vy: 0, life: .5 });
      update(.05);
    }
    // Parking beside an enemy holding wakes its defenders; leave none behind for later checks.
    game.convoys = []; game.enemies = []; game.bullets = [];
    return { ok: count >= CONFIG.convoy.size[0] && drawn && s.hp === 0 && game.score >= before + CONFIG.convoy.score,
      why: `count ${count} drawn ${drawn} hp ${s.hp} score +${game.score - before}` };
  });
  check('supply convoys spawn between enemy holdings and sink to gunfire', convoy.ok, convoy.why);
  await page.evaluate(() => {
    const { game, CONFIG } = window.__game, t = game.territories.find(t => t.owner === 'enemy');
    game.player.flight = 'flying'; game.player.altitude = CONFIG.render.flightHeight;
    game.player.x = t.x + 300; game.player.y = t.y + 100;
    game.cam.x = game.player.x; game.cam.y = game.player.y;
  });
  await page.waitForFunction(() => window.__game.game.enemies.length > 0);
  check('enemies use Zero GLBs', await page.evaluate(() => {
    const { game, graphics } = window.__game;
    return game.enemies.every(e => graphics.aircraft.get(e)?.model.name === 'Mitsubishi_Zero');
  }));
  await page.screenshot({ path: path.join(SHOT_DIR, '02-territory.png') });

  // ---- bot plays the game ----
  // Steering happens in the page: a tick interval turns toward the
  // nearest enemy and fires when roughly aligned.
  await page.evaluate(() => {
    const { game, keys, angDiff } = window.__game;
    window.__bot = setInterval(() => {
      if (game.mode !== 'play') {
        keys['KeyA'] = keys['KeyD'] = keys['Space'] = false; return;
      }
      const p = game.player;
      let best = null, bd = 1e9;
      for (const e of game.enemies) {
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) {
        for (const ship of game.ships) {
          if (ship.team !== 'jp' || ship.hp <= 0) continue;
          const d = Math.hypot(ship.x - p.x, ship.y - p.y);
          if (d < bd) { bd = d; best = ship; }
        }
      }
      if (!best) best = game.territories.find(t => t.owner !== 'us') ?? game.ships[0];
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
    if (s.mode === 'over' || s.mode === 'recovery') { died = true; break; }
  }
  await page.evaluate(() => clearInterval(window.__bot));

  const last = samples[samples.length - 1];
  const survived = Math.round((Date.now() - start) / 1000);
  results.metrics = {
    seed: SEED,
    botSurvivedSeconds: survived,
    finalScore: last.score,
    territoriesCaptured: last.captured,
    finalHp: last.hp,
    died,
    hpOverTime: samples.map(x => `${x.t}s:${Math.ceil(x.hp)}hp/${x.captured} sectors`).join(' '),
  };
  check('bot can score points', last.score > 0, `score ${last.score}`);
  check('territory combat remains active during free flight', last.score > 0);
  if (died) {
    await page.screenshot({ path: path.join(SHOT_DIR, '04-gameover.png') });
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    s = await snap();
    check('restart after death works', s.mode === 'play' && s.hp === 100);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  check('3D camera and HUD resize together', await page.evaluate(() => {
    const { view, graphics } = window.__game;
    return view.W === 390 && graphics.camera.right - graphics.camera.left === 390
      && document.getElementById('world').width === Math.round(390 * view.DPR);
  }));
  // Real simultaneous touch contacts: the torpedo thumb is non-primary.
  await page.evaluate(() => { window.__game.startGame(); const p = window.__game.game.player; p.flight = 'flying'; p.aircraft = 'corsair'; p.loadout = 'torpedoes'; });
  await page.waitForTimeout(100);
  const touch = await page.context().newCDPSession(page);
  const steering = { x: 75, y: 700, id: 1 };
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [steering] });
  steering.x = 110;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [steering] });
  const torpedoBox = await page.locator('#torpedo-action').boundingBox();
  const trigger = { x: torpedoBox.x + torpedoBox.width / 2, y: torpedoBox.y + torpedoBox.height / 2, id: 2 };
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [steering, trigger] });
  check('secondary thumb fires torpedo while steering stays held', await page.evaluate(() => {
    const { game, stick } = window.__game;
    return game.player.torpedoAmmo === 1 && stick.active && stick.dx > 20;
  }));
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [trigger] });
  check('releasing torpedo thumb preserves steering and does not fire twice', await page.evaluate(() => window.__game.stick.active && window.__game.game.player.torpedoAmmo === 1));
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touch.detach();
  // Show a landing and its actual touch control at narrow-screen size.
  await page.evaluate(() => {
    const { game, requestCarrier, update, keys } = window.__game;
    for (const key of Object.keys(keys)) keys[key] = false;
    window.__game.startGame();
    game.rank = 2; game.combatSorties = window.__game.CONFIG.progression.aircraftSorties.corsair; game.rescue.status = 'complete';
    const c = game.ships[0]; c.active = true; c.hp = c.maxHp;
    game.bases.find(b => b.kind === 'carrier').available = true;
    game.player.flight = 'flying'; game.player.aircraft = 'corsair'; game.player.loadout = 'torpedoes';
    game.player.x = c.x - Math.cos(c.a) * 330; game.player.y = c.y - Math.sin(c.a) * 330;
    game.player.a = c.a; game.player.hp = 40;
    for (let i = 0; i < 900 && game.player.flight !== 'landed'; i++) update(.02);
    game.cam.x = c.x; game.cam.y = c.y;
  });
  await page.waitForFunction(() => document.getElementById('carrier-action').textContent.includes('TAKE OFF'));
  await page.screenshot({ path: path.join(SHOT_DIR, '05-carrier.png') });
  await page.locator('#sortie-base button[data-value=\"home-airfield\"]').click();
  await page.locator('#sortie-aircraft button[data-value=\"p38\"]').click();
  await page.waitForFunction(() => window.__game.graphics.aircraft.get(window.__game.game.player)?.model.name === 'P38_Lightning');
  check('native sortie selectors transfer home and switch the rendered aircraft', await page.evaluate(() => { const p = window.__game.game.player; return p.baseId === 'home-airfield' && p.aircraft === 'p38' && p.altitude === window.__game.CONFIG.airfield.deckHeight && p.loadout === 'bombs'; }));
  await page.locator('#sortie-base button[data-value=\"fleet-carrier\"]').click();
  await page.locator('#sortie-aircraft button[data-value=\"corsair\"]').click();
  await page.locator('#sortie-loadout button[data-value=\"torpedoes\"]').click();
  await page.waitForFunction(() => window.__game.graphics.aircraft.get(window.__game.game.player)?.model.name === 'F4U_Corsair');
  check('native carrier transfer selects compatible Corsair at deck height', await page.evaluate(() => { const p = window.__game.game.player; return p.baseId === 'fleet-carrier' && p.aircraft === 'corsair' && p.loadout === 'torpedoes' && p.altitude === window.__game.CONFIG.carrier.deckHeight; }));

  await page.evaluate(() => { window.__game.game.score = window.__game.CONFIG.progression.aircraftUnlocks.p51; window.__game.game.combatSorties = window.__game.CONFIG.progression.aircraftSorties.p51; });
  await page.locator('#sortie-base button[data-value="home-airfield"]').click();
  for (const [id,model,loadout] of [['dauntless','SBD_Dauntless','bombs'],['avenger','TBF_Avenger','torpedoes'],['p51','P51_Mustang','bombs']]) {
    await page.locator(`#sortie-aircraft button[data-value="${id}"]`).click();
    await page.waitForFunction(model => window.__game.graphics.aircraft.get(window.__game.game.player)?.model.name === model, model);
    check(`${id} card selects its real flight model and compatible weapon`, await page.evaluate(({id,loadout}) => { const p = window.__game.game.player; return p.aircraft === id && p.loadout === loadout; }, {id,loadout}));
  }
  check('all five aircraft cards contain loaded model renders', await page.locator('#sortie-aircraft img').evaluateAll(imgs => imgs.length === 5 && imgs.every(img => img.complete && img.naturalWidth === 256 && img.naturalHeight === 160)));
  await page.getByRole('button', { name: /TAKE OFF/ }).click();
  check('on-screen takeoff control launches the selected aircraft', await page.evaluate(() => window.__game.game.player.flight === 'takeoff'));
  await page.evaluate(() => window.__game.startGame());
  await page.waitForTimeout(200);
  check('restart removes old aircraft instances', await page.evaluate(() => window.__game.graphics.aircraft.size === 1 + window.__game.game.allies.length));
  check('no JS errors during play', results.errors.length === 0, results.errors[0]);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  mobile.on('pageerror', e => results.errors.push(String(e)));
  await mobile.goto(`http://127.0.0.1:${port}/pacific-skies/?quality=1`);
  await mobile.waitForFunction(() => window.__game?.rendering?.ready);
  await mobile.waitForTimeout(150);
  check('phone title shows touch instructions without keyboard shortcuts', await mobile.locator('#menu').innerText().then(t => t.includes('Begin expedition') && !/Space|WASD|Arrows|T to|L to/.test(t)));
  await mobile.screenshot({ path: path.join(SHOT_DIR, '06-phone-title.png') });
  await mobile.touchscreen.tap(190, 600);
  await mobile.screenshot({ path: path.join(SHOT_DIR, '06-phone-sortie.png') });
  check('phone sortie selector fits its panel', await mobile.evaluate(() => { const p = document.getElementById('sortie-panel'); return p.scrollWidth <= p.clientWidth; }));
  await mobile.evaluate(() => { const g = window.__game.game; g.score = window.__game.CONFIG.progression.aircraftUnlocks.p51; g.combatSorties = window.__game.CONFIG.progression.aircraftSorties.p51; g.rank = 2; g.rescue.status = 'complete'; g.ships[0].active = true; g.bases.find(b => b.kind === 'carrier').available = true; });
  for (const [width,height,name] of [[320,568,'small-phone'],[844,390,'landscape']]) {
    await mobile.setViewportSize({ width,height }); await mobile.waitForTimeout(100);
    check(`${name} sortie panel fits without overlapping the HUD`, await mobile.evaluate(() => {
      const p = document.getElementById('sortie-panel'), r = p.getBoundingClientRect();
      const ids = ['stats','objective','campaign-status','flight-controls'];
      return r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight && p.scrollWidth <= p.clientWidth
        && ids.every(id => { const e = document.getElementById(id); if (!e || e.hidden) return true; const b = e.getBoundingClientRect(); return r.right <= b.x || r.x >= b.right || r.bottom <= b.y || r.y >= b.bottom; });
    }));
    check(`${name} expanded aircraft cards have no clipped labels`, await mobile.locator('#sortie-aircraft button').evaluateAll(cards => cards.length === 5 && cards.every(card => card.scrollWidth <= card.clientWidth)));
    await mobile.locator('#sortie-aircraft button[data-value="p51"]').tap();
    check(`${name} last aircraft remains reachable by scrolling`, await mobile.evaluate(() => window.__game.game.player.aircraft === 'p51'));
    await mobile.locator('#sortie-base button[data-value="fleet-carrier"]').tap();
    check(`${name} base transfer remains reachable below aircraft choices`, await mobile.evaluate(() => window.__game.game.player.baseId === 'fleet-carrier'));
    await mobile.locator('#sortie-base button[data-value="home-airfield"]').tap();
    await mobile.screenshot({ path: path.join(SHOT_DIR, `06-${name}-sortie.png`) });
  }
  await mobile.getByRole('button', { name: /TAKE OFF/ }).tap();
  await mobile.waitForFunction(() => window.__game.game.player.flight === 'flying');
  await mobile.waitForTimeout(100);
  check('phone torpedo control has no keyboard prefix', await mobile.locator('#torpedo-action').innerText().then(t => !t.startsWith('T ·')));
  for (const [width, height, name] of [[320,568,'small-phone'], [844,390,'landscape'], [768,1024,'tablet']]) {
    await mobile.setViewportSize({ width, height });
    await mobile.evaluate(() => { window.__game.game.message = 'Patrol destroyer sunk'; window.__game.game.messageTime = 10; });
    await mobile.waitForTimeout(100);
    check(`${name} readouts fit the viewport`, await mobile.evaluate(() => {
      const ids = ['stats','toast','flight-controls'];
      return ids.every(id => { const e = document.getElementById(id), r = e.getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight && e.scrollWidth <= e.clientWidth; });
    }));
    check(`${name} notice sizes to its text`, await mobile.evaluate(() => document.getElementById('toast').getBoundingClientRect().width < innerWidth - 40));
    await mobile.screenshot({ path: path.join(SHOT_DIR, `07-${name}.png`) });
  }
  await mobile.setViewportSize({width:390,height:844});
  await mobile.locator('#map-open').tap();
  const pausedTime=await mobile.evaluate(()=>window.__game.game.time);
  await mobile.waitForTimeout(200);
  check('phone operations chart pauses the live simulation', await mobile.evaluate(t=>window.__game.game.paused&&window.__game.game.time===t,pausedTime));
  check('operations chart fits the phone viewport', await mobile.locator('#operations-panel').evaluate(e=>{const r=e.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&e.scrollWidth<=e.clientWidth;}));
  const chartTarget=await mobile.evaluate(async()=>{
    const {mapProjection}=await import(new URL('src/operations.js',location.href).href);
    const g=window.__game.game,c=document.getElementById('operations-map'),r=c.getBoundingClientRect();
    const [x,y]=mapProjection(g,{x:0,y:0,w:r.width,h:r.height},true).point(g.territories[0]);
    return {x:r.left+x,y:r.top+y};
  });
  await mobile.touchscreen.tap(chartTarget.x,chartTarget.y);
  check('chart touch selects a known destination without steering or firing', await mobile.evaluate(async()=>{
    const {stick,fireTouch}=await import(new URL('src/input.js',location.href).href);
    return window.__game.game.waypoint?.name===window.__game.game.territories[0].name&&!stick.active&&!fireTouch.active;
  }));
  await mobile.screenshot({path:path.join(SHOT_DIR,'08-operations-phone.png')});
  await mobile.setViewportSize({width:844,height:390});
  await mobile.waitForTimeout(100);
  await mobile.screenshot({path:path.join(SHOT_DIR,'08-operations-landscape.png')});
  await mobile.locator('#operations-close').tap();
  await mobile.waitForTimeout(100);
  check('closing chart resumes simulation without a stuck control', await mobile.evaluate(t=>!window.__game.game.paused&&window.__game.game.time>t,pausedTime));
  await mobile.keyboard.press('t');
  await mobile.evaluate(() => { window.__game.game.mode = 'over'; });
  await mobile.waitForTimeout(100);
  check('keyboard input switches to keyboard restart hint', await mobile.locator('#menu-start').innerText().then(t => t.includes('Space')));
  await mobile.touchscreen.tap(90, 500);
  await mobile.evaluate(() => { window.__game.game.mode = 'over'; });
  await mobile.waitForTimeout(100);
  check('touch input restores touch restart hint', await mobile.locator('#menu-start').innerText().then(t => t === 'Begin expedition'));
  check('responsive HUD has no runtime errors', results.errors.length === 0, results.errors[0]);
  await mobile.close();

  const failedPage = await browser.newPage();
  await failedPage.route('**/F4U_Corsair.glb', route => route.fulfill({ status: 503, body: 'unavailable' }));
  await failedPage.goto(`http://127.0.0.1:${port}/pacific-skies/`);
  await failedPage.waitForFunction(() => window.__game?.rendering?.error, null, { timeout: 30000 });
  check('asset failure shows recovery UI', await failedPage.getByRole('button', { name: 'Retry' }).isVisible());
  await failedPage.keyboard.press('Space');
  check('failed loading does not start an invisible game', await failedPage.evaluate(() => window.__game.game.mode === 'title'));
  await failedPage.close();

  console.log('\n--- gameplay metrics ---');
  for (const [k, v] of Object.entries(results.metrics)) console.log(`${k}: ${v}`);

  fs.writeFileSync(path.join(SHOT_DIR, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  server.close();
  process.exit(results.checks.every(c => c.ok) ? 0 : 1);
})();
