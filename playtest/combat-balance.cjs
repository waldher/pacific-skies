// Dogfight balance bands, run headless on the real flight, gunnery and AI.
//
// A scripted "average pilot" fights seeded engagements and the harness
// measures what decides them: hull lost to guns versus collisions, how
// long a fight takes, how much a wingman contributes, and whether enemies
// can hit anything at all. Each metric must land inside a band; a change
// that makes collisions lethal, guns toothless or the wingman a second
// player fails here before anyone plays it. Bands live in BANDS below.
//
// Usage: node --experimental-vm-modules playtest/combat-balance.cjs
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const element = { getContext: () => ({ setTransform() {} }), style: {}, addEventListener() {}, append() {}, setAttribute() {}, querySelector() { return this; } };
const context = vm.createContext({ console, performance, Math, navigator: { maxTouchPoints: 0 },
  document: { getElementById: () => element, createElement: () => ({ ...element }) }, requestAnimationFrame() {},
  window: { innerWidth: 900, innerHeight: 600, addEventListener() {} } });
const cache = new Map();
async function load(file) {
  if (cache.has(file)) return cache.get(file);
  const code = file.endsWith('/src/renderer.js') ? 'export async function createRenderer(){return {diagnostics:{ready:true}}}'
    : file.endsWith('/src/aircraft-previews.js') ? 'export const aircraftPreviews={}; export function renderAircraftPreviews(){}'
    : fs.readFileSync(file, 'utf8');
  const mod = new vm.SourceTextModule(code, { context, identifier: file });
  cache.set(file, mod); return mod;
}
const link = (specifier, parent) => load(path.resolve(path.dirname(parent.identifier), specifier));

const BANDS = {
  soloHullLost: [12, 75],        // a three-ship fight should cost real hull, not the aircraft
  soloCollisions: [0, 1.2],      // collisions per fight: rare once fighters sidestep
  collisionShare: [0, .55],      // fraction of hull lost to collisions: guns decide fights (a scripted pilot rams more than a person)
  soloCleared: [.8, 1],          // fraction of fights the pilot wins inside the time limit
  soloSeconds: [6, 55],          // neither a wipe nor a stalemate
  wingKillShare: [0, .45],       // the wingman helps; it does not take the fight
  wingHullRelief: [.35, 1],      // hull lost with a wingman as a fraction of solo: help, not immunity
  wingSurvival: [.6, 1],         // a wingman worth keeping mostly comes home
  ramSurvivable: [3, Infinity],  // deliberate collisions survived before dying
  straightHits: [2, Infinity],   // a non-manoeuvring target gets hit
};
const SEEDS = [11, 23, 37, 51, 68, 74, 85, 96];
const DT = .02, LIMIT = 60;

(async () => {
  const main = await load(path.join(root, 'src/main.js')); await main.link(link); await main.evaluate();
  const api = context.window.__game, { game, CONFIG, keys, update, angDiff } = api;
  const E = CONFIG.enemy;
  const reset = key => { for (const k of Object.keys(keys)) keys[k] = false; };
  // Open water far from every island: nothing but the fight.
  function arena(seed, wingman) {
    api.setSeed(seed); api.startGame();
    game.raidTimer = Infinity; game.convoyTimer = Infinity; game.allies = []; game.enemies = [];
    game.airfields.forEach(f => { f.patrolTimer = Infinity; });
    const p = game.player, b = game.theaterBounds;
    p.x = b.maxX + 5000; p.y = b.maxY + 5000; p.a = 0; p.flight = 'flying'; p.altitude = CONFIG.render.flightHeight; p.hp = 100; p.speed = CONFIG.aircraft.p38.speedCruise;
    game.cam.x = p.x; game.cam.y = p.y; game.collisions = 0;
    if (wingman) update(DT);            // musters the wingman at time zero
    else game.time = 5;
    game.allies = game.allies.filter(f => f.role === 'wing');
    return p;
  }
  function spawn(p, styles, distance = 700, seed = 0) {
    // Seeds rotate and stretch the setup so five fights are five geometries.
    const phase = (seed % 17) / 17 * Math.PI * 2, stretch = 1 + (seed % 5) * .1;
    styles.forEach((style, i) => {
      const a = i / styles.length * Math.PI * 2 + .3 + phase, ace = style === 'ace';
      distance = 700 * stretch;
      game.enemies.push({ x: p.x + Math.cos(a) * distance, y: p.y + Math.sin(a) * distance, a: a + Math.PI,
        hp: ace ? E.ace.hp : E.hp, speed: ace ? E.ace.speed : E.speed, turn: ace ? E.ace.turn : E.turn,
        ace, style, fireCd: .8, wobble: i, raider: true });
    });
  }
  // The average pilot: reacts a fifth of a second late, turns toward the
  // nearest fighter, boosts to close, brakes to cut inside, and fires when
  // fairly well aligned. Deliberately not a laser.
  const seen = [];
  function pilot(p) {
    let best = null, bd = Infinity;
    for (const e of game.enemies) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < bd) { bd = d; best = e; } }
    reset();
    // Aim at where the target will be (the HUD pipper shows this), seen a beat late.
    const lead = best ? (best.v ?? best.speed) * bd / CONFIG.player.bulletSpeed : 0;
    seen.push(best ? { x: best.x + Math.cos(best.a) * lead, y: best.y + Math.sin(best.a) * lead, d: bd } : null);
    if (seen.length > 10) seen.shift();
    const late = seen[0];
    if (!late) return;
    const d = angDiff(p.a, Math.atan2(late.y - p.y, late.x - p.x));
    keys['KeyA'] = d < -.08; keys['KeyD'] = d > .08;
    keys['KeyW'] = late.d > 350; keys['KeyS'] = late.d < 160 && Math.abs(d) > .9;
    keys['Space'] = Math.abs(d) < .18 && late.d < 450;
    // Anyone eases off and pulls aside when a fighter fills the windscreen.
    if (best && bd < 150) {
      const dx = best.x - p.x, dy = best.y - p.y, ev = best.v ?? best.speed;
      const closingSpeed = ((Math.cos(p.a) * p.speed - Math.cos(best.a) * ev) * dx + (Math.sin(p.a) * p.speed - Math.sin(best.a) * ev) * dy) / bd;
      const now = angDiff(p.a, Math.atan2(dy, dx));
      if (closingSpeed > 40 && Math.abs(now) < 1) { keys['KeyW'] = false; keys['KeyS'] = true; keys['KeyA'] = now > 0; keys['KeyD'] = now <= 0; }
      else if (bd < 100 && Math.abs(now) < 1) { keys['KeyW'] = false; keys['KeyS'] = true; }   // never ride a tail at full throttle
    }
  }
  function fight(seed, wingman) {
    const p = arena(seed, wingman); seen.length = 0;
    spawn(p, ['recruit', 'veteran', 'ace'], 700, seed);
    const wing = game.allies[0];
    let t = 0, hits = 0, collisionHull = 0, startScore = game.score, wingKills = 0;
    while (t < LIMIT && game.enemies.length && p.hp > 0) {
      const hp = p.hp, collisions = game.collisions, kills = game.wing?.kills || 0;
      pilot(p); update(DT); t += DT;
      if (game.collisions > collisions) collisionHull += hp - p.hp;
      else if (p.hp < hp) hits++;
      wingKills += (game.wing?.kills || 0) - kills;
    }
    return { seed, seconds: t, hullLost: 100 - Math.max(0, p.hp), collisions: game.collisions, collisionHull, hits,
      cleared: game.enemies.length === 0 && p.hp > 0, wingKills, wingAlive: wing ? game.allies.includes(wing) && wing.hp > 0 : null };
  }
  const mean = (rows, key) => rows.reduce((n, r) => n + r[key], 0) / rows.length;
  const solo = SEEDS.map(seed => fight(seed, false));
  const paired = SEEDS.map(seed => fight(seed, true));
  console.log('solo   ' + solo.map(r => `s${r.seed}:${r.seconds.toFixed(0)}s hull-${r.hullLost} col${r.collisions}${r.cleared ? '' : ' LOST'}`).join('  '));
  console.log('wing   ' + paired.map(r => `s${r.seed}:${r.seconds.toFixed(0)}s hull-${r.hullLost} col${r.collisions} wk${r.wingKills}${r.wingAlive ? '' : ' wingman down'}${r.cleared ? '' : ' LOST'}`).join('  '));

  // Deliberate ramming: fly straight into a fighter that cannot shoot, repeatedly.
  const p = arena(99, false);
  spawn(p, ['recruit'], 300);
  let rams = 0, alive = true;
  for (let t = 0; t < 40 && alive; t += DT) {
    const e = game.enemies[0]; if (!e) break;
    e.fireCd = 99; reset();
    const d = angDiff(p.a, Math.atan2(e.y - p.y, e.x - p.x));
    keys['KeyA'] = d < -.05; keys['KeyD'] = d > .05; keys['KeyW'] = true;
    const before = game.collisions; update(DT);
    if (game.collisions > before) rams++;
    alive = p.hp > 0;
  }
  const ramSurvived = alive ? Math.max(rams, 3) : rams - 1;

  // Gunnery: a veteran chasing a target that flies straight must land hits.
  const q = arena(7, false);
  game.enemies.push({ x: q.x - 380, y: q.y + 20, a: 0, hp: 99, speed: E.speed, turn: E.turn, ace: false, style: 'veteran', fireCd: .3, wobble: 0, raider: true });
  let straightHits = 0;
  for (let t = 0; t < 12; t += DT) { const hp = q.hp; reset(); keys['KeyW'] = false; update(DT); if (q.hp < hp) straightHits++; }

  const metrics = {
    soloHullLost: mean(solo, 'hullLost'), soloCollisions: mean(solo, 'collisions'),
    collisionShare: solo.reduce((n, r) => n + r.collisionHull, 0) / Math.max(1, solo.reduce((n, r) => n + r.hullLost, 0)),
    soloCleared: solo.filter(r => r.cleared).length / solo.length, soloSeconds: mean(solo, 'seconds'),
    wingKillShare: paired.reduce((n, r) => n + r.wingKills, 0) / (paired.length * 3),
    wingHullRelief: mean(paired, 'hullLost') / Math.max(1, mean(solo, 'hullLost')),
    wingSurvival: paired.filter(r => r.wingAlive).length / paired.length,
    ramSurvivable: ramSurvived, straightHits,
  };
  let failed = 0;
  for (const [key, [low, high]] of Object.entries(BANDS)) {
    const value = metrics[key], ok = value >= low && value <= high;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${key.padEnd(16)} ${Number.isFinite(value) ? value.toFixed(2).padStart(7) : String(value).padStart(7)}   band ${low}..${high}`);
  }
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
