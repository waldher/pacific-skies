// Campaign pilot: a bot that plays the whole loop the way a player follows
// the gold marker, headless on the real modules, and reports where the
// time goes.
//
// It takes off, flies the automatic guidance, fights whatever comes within
// sight, bombs enemy runways, circles to capture, flies a manual aligned
// approach to land and rearm, picks unlocked aircraft, and recovers after
// being shot down. Nothing is teleported or edited after startGame(): the
// bot only presses keys and calls what the HUD buttons call.
//
// Every tick is classified (idle, transit, explore, home, approach,
// combat, attack, capture, ground, recovery) so a run answers "how much of
// a sortie is flying somewhere with nothing to decide". Milestones (first
// capture, unlocks, victory) are timed, and a stall detector reports any
// stretch in which the war does not change: a softlock a person would
// quit over. Kills do not count as progress; roaming Zeros never run out.
//
// The pilot is the combat-balance "average pilot" with perfect awareness
// of anything visible, so deaths run low; it bombs rather than torpedoes.
//
// Usage: node --experimental-vm-modules playtest/campaign-pilot.cjs
//   SEEDS=1,2,3  MINUTES=45  VERBOSE=1 (event log)  TRACE=seed:from:to (2 s samples)
// Writes playtest/shots/campaign-pilot.json. Exit code is nonzero when a
// metric leaves its band (BANDS below).
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const records = new Map();
const element = { getContext: () => ({ setTransform() {} }), style: {}, addEventListener() {}, append() {}, setAttribute() {}, querySelector() { return this; } };
const context = vm.createContext({ console, performance, Math, navigator: { maxTouchPoints: 0 },
  localStorage: { getItem: k => records.get(k) ?? null, setItem: (k, v) => records.set(k, v), removeItem: k => records.delete(k) },
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
async function namespace(file) {
  const m = await load(path.join(root, file));
  if (m.status === 'unlinked') await m.link(link);
  if (m.status === 'linked') await m.evaluate();
  return m.namespace;
}

// Bands are campaign-level expectations for an average player who follows
// the marker. Move one only with a reason in the diff.
const BANDS = {
  firstCaptureSeconds: [0, 300],   // median: the first island falls within five minutes
  capturesPer10Min: [1.5, Infinity],// the front keeps moving
  victoryRate: [.8, 1],            // the war can be won by following the marker
  victoryMinutes: [10, 45],        // median campaign length for this pilot
  idleShare: [0, .02],             // flying with no objective at all
  transitShare: [0, .6],           // travel with nothing to decide; about half today (see IDEAS.md)
  groundShare: [0, .15],           // parked, launching and rolling out
  returnSeconds: [0, 45],          // median flight home, turning for base to touchdown
  landingSuccess: [.8, 1],         // approaches that end on the runway or deck
  deathsPer10Min: [0, 4],          // the war costs aircraft, not every sortie
  stalls: [0, 0],                  // seven minutes with no change in the war is a softlock
};
const SEEDS = process.env.SEEDS ? process.env.SEEDS.split(',').map(Number) : [1942, 7, 23, 58, 91, 144];
const MINUTES = Number(process.env.MINUTES || 45), DT = 1 / 30, STALL = 420;
const VERBOSE = !!process.env.VERBOSE, TRACE = process.env.TRACE?.split(':').map(Number);

(async () => {
  await namespace('src/main.js');
  const api = context.window.__game, { game, CONFIG, keys, update, angDiff } = api;
  const { AIRCRAFT } = await namespace('src/aircraft-types.js');
  const { availableBases, canUseAircraft, resolveBase } = await namespace('src/bases.js');
  const { enemyObserved } = await namespace('src/intelligence.js');
  const Q = CONFIG.conquest;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const release = () => { for (const k of Object.keys(keys)) keys[k] = false; };

  // Turn toward a heading at a throttle. Keys only: exactly what a keyboard does.
  function steer(p, heading, throttle = 'cruise', deadband = .05) {
    const d = angDiff(p.a, heading);
    keys.KeyA = d < -deadband; keys.KeyD = d > deadband;
    keys.KeyW = throttle === 'boost'; keys.KeyS = throttle === 'brake';
    return d;
  }
  const toward = (p, q) => Math.atan2(q.y - p.y, q.x - p.x);

  function runSeed(seed) {
    records.clear();
    api.setSeed(seed); api.startGame();
    const p = game.player;
    const budget = { ground: 0, idle: 0, transit: 0, explore: 0, home: 0, combat: 0, attack: 0, capture: 0, approach: 0, recovery: 0 };
    const homeReasons = { hull: 0, rearm: 0 };
    const events = [], log = (kind, extra = {}) => { events.push({ t: +game.time.toFixed(1), kind, ...extra }); if (VERBOSE) console.log(`  ${seed} ${game.time.toFixed(0).padStart(5)}s ${kind}`, JSON.stringify(extra)); };
    const approaches = [];
    // What the fighting is against: roaming raiders, island defenders, strike groups, the rescue attack.
    const kindOf = e => e.rescue ? 'rescue' : e.strike ? 'strike' : e.territory != null ? 'defender' : 'raider';
    const fought = { raider: 0, defender: 0, strike: 0, rescue: 0 }, killedBy = { raider: 0, defender: 0, strike: 0, rescue: 0 };
    let lastThreat = null;
    // Each enemy the pilot engaged: how long from first engagement to its end, and who ended it.
    const engaged = new Map(), duels = [];
    let circling = 0, extendUntil = 0, stalemates = 0, lastWaypoint;
    let approach = null, groundWait = 0, recoverWait = 0, lastProgress = 0, stalls = [];
    let lastScore = 0, lastCaptured = 0, lastWar = '', landings = 0, bombs = 0, deaths = 0, sorties = 0;
    // The war moving: ownership, rank, unlocks, damage to enemy runways and ships. Kills alone are not progress.
    const warState = () => [game.territories.map(t => t.owner).join(''), game.rank, game.unlockedAircraft.length,
      game.airfields.filter(f => f.owner === 'enemy').map(f => Math.round(f.hp)).join(','), game.ships.filter(x => x.team === 'jp').map(x => x.hp).join(',')].join('|');
    const seen = [];   // reaction delay: the pilot acts on what it saw a beat ago
    let wall = 0;

    while (wall < MINUTES * 60 && ['play', 'recovery'].includes(game.mode)) {
      wall += DT;
      release();
      let activity = 'transit';
      if (game.mode === 'recovery') {
        activity = 'recovery';
        if ((recoverWait += DT) > 2) { recoverWait = 0; api.recoverPilot(); log('recovered', { base: p.baseId, aircraft: p.aircraft }); }
        budget[activity] += DT; continue;
      }
      if (p.flight === 'landed') {
        activity = 'ground';
        // A person spends a few seconds in the sortie menu.
        if ((groundWait += DT) > 4) {
          groundWait = 0; chooseAircraft();
          api.requestCarrier(); sorties++;
          log('takeoff', { base: p.baseId, aircraft: p.aircraft, hp: Math.round(p.hp) });
        }
      } else if (p.flight !== 'flying') activity = 'ground';
      else activity = fly();
      budget[activity] += DT;
      const wpKey = game.waypoint ? game.waypoint.team === 'jp' ? game.waypoint.name : `${game.waypoint.name}@${Math.round(game.waypoint.x)},${Math.round(game.waypoint.y)}` : null;
      if (wpKey !== lastWaypoint && !(game.waypoint?.returning || game.waypoint?.rescue)) { lastWaypoint = wpKey; log('waypoint', { to: wpKey, from: `${Math.round(p.x)},${Math.round(p.y)}` }); }
      if (TRACE && TRACE[0] === seed && game.time >= TRACE[1] && game.time <= TRACE[2] && Math.floor(game.time / 2) !== Math.floor((game.time - DT) / 2)) {
        const e = [...game.enemies].sort((a, b) => dist(a, p) - dist(b, p))[0];
        console.log(`  t${game.time.toFixed(0)} ${activity.padEnd(8)} hp${Math.round(p.hp)} v${Math.round(p.speed)} wp:${game.waypoint?.name ?? '-'}` + (e ? `  ${kindOf(e)} d${Math.round(dist(e, p))} hp${e.hp} v${Math.round(e.v)} myOff${angDiff(p.a, toward(p, e)).toFixed(2)} itsOff${angDiff(e.a, toward(e, p)).toFixed(2)}` : ''));
      }

      const hpBefore = p.hp, modeBefore = game.mode, flightBefore = p.flight, meritBefore = game.playerMerit || 0;
      update(DT);
      for (const [e, d] of engaged) if (e.hp <= 0 || !game.enemies.includes(e)) {
        duels.push({ ...d, seconds: +(game.time - d.start).toFixed(1), end: e.hp > 0 ? 'left' : (game.playerMerit || 0) > meritBefore ? 'player' : 'other' });
        engaged.delete(e);
      }
      if (modeBefore === 'play' && game.mode === 'recovery') {
        deaths++; if (activity === 'combat') killedBy[lastThreat]++;
        log('shot down', { activity, by: activity === 'combat' ? lastThreat : null, hull: Math.round(hpBefore) }); approach = null;
      }
      if (p.flight === 'landing' && flightBefore === 'flying') {
        landings++;
        if (approach) approaches.push({ seconds: game.time - approach.start, ok: true, base: approach.baseId });
        log('landed', { base: p.baseId, approach: approach ? +(game.time - approach.start).toFixed(1) : null }); approach = null;
      }

      const captured = game.sessionReport.captured;
      const war = warState();
      if (war !== lastWar || game.mode !== 'play') lastProgress = game.time;
      lastWar = war;
      if (captured > lastCaptured) log('captured', { total: captured });
      if (game.score > lastScore && Math.floor(game.score / 1000) > Math.floor(lastScore / 1000)) log('score', { score: game.score });
      lastScore = game.score; lastCaptured = captured;
      if (game.time - lastProgress > STALL) {
        stalls.push({ t: +game.time.toFixed(0), activity, flight: p.flight, waypoint: game.waypoint?.name ?? null, x: Math.round(p.x), y: Math.round(p.y) });
        log('STALL', stalls.at(-1)); lastProgress = game.time;
      }
    }

    function chooseAircraft() {
      // Take the heaviest bomber the base allows for runways; the P-51 once it is open.
      const base = availableBases(game).find(b => b.id === p.baseId);
      const prefer = ['p51', 'dauntless', 'corsair', 'p38'];
      for (const id of prefer) if (canUseAircraft(game, base, id) && AIRCRAFT[id].loadouts.includes('bombs')) {
        if (id !== p.aircraft) { api.selectSortie({ baseId: base.id, aircraft: id, loadout: 'bombs' }); log('aircraft', { aircraft: id }); }
        return;
      }
    }

    // One flying tick: returns the activity it spent the tick on.
    function fly() {
      const wp = game.waypoint;
      // Threats: anything visible close enough to matter.
      let threat = null, td = Infinity;
      for (const e of game.enemies) {
        if (e.hp <= 0 || !enemyObserved(game, e)) continue;
        const d = dist(e, p);
        if (d < td) { td = d; threat = e; }
      }
      const returning = wp?.returning;
      // Heading home hurt or empty: fight only what is on the tail.
      const fightRange = returning ? 350 : 800;
      if (threat && td < fightRange) { dogfight(threat, td); fought[kindOf(threat)] += DT; lastThreat = kindOf(threat);
        if (!engaged.has(threat)) engaged.set(threat, { kind: kindOf(threat), start: game.time, ace: !!threat.ace, style: threat.style }); return 'combat'; }
      seen.length = 0;
      if (returning) {
        if (!approach) homeReasons[p.hp < CONFIG.navigation.repairHull ? 'hull' : 'rearm']++;
        land(wp);
        const base = resolveBase(game, wp.baseId);
        return base && dist(p, base) > 1500 ? 'home' : 'approach';
      }
      approach = null;
      // No objective at all: a person would open the chart; the bot circles and counts it.
      if (!wp) { steer(p, p.a + .3); return 'idle'; }
      const site = wp.siteId != null ? game.territories.find(t => t.id === wp.siteId) : null;
      if (site && site.owner !== 'us' && dist(p, site) < Q.activateRadius + 200) {
        const field = game.airfields.find(f => f.territory === site.id && f.owner === 'enemy' && f.hp > 0);
        if (field && p.loadout === 'bombs' && p.bombAmmo > 0) { bombRun(field); return 'attack'; }
        if (!field) { orbit(site, 180); return site.activated ? 'capture' : 'transit'; }
      }
      if (wp.team === 'jp') {
        const ship = game.ships.find(x => x.id === wp.shipId);
        if (ship && ship.hp > 0 && dist(p, ship) < 1500 && p.loadout === 'bombs' && p.bombAmmo > 0) { bombRun(ship, ship.width * .35); return 'attack'; }
      }
      if (wp.rescue) {
        const carrier = game.ships.find(s => s.id === wp.shipId) || game.ships[0];
        if (dist(p, carrier) < 700) { orbit(carrier, 300); return 'combat'; }
      }
      steer(p, toward(p, wp), dist(p, wp) > 1200 ? 'boost' : 'cruise');
      return wp.search ? 'explore' : 'transit';
    }

    // Turning circles: close, nose never on. A person breaks one by extending on the throttle.
    function dogfight(e, d) {
      if (game.time < extendUntil) { steer(p, p.a + .15, 'boost'); keys.Space = false; return; }
      // Average pilot from combat-balance: aims where the HUD pipper points, a fifth of a second late.
      const t = d / CONFIG.player.bulletSpeed, lead = { x: e.x + Math.cos(e.a) * (e.v ?? e.speed) * t, y: e.y + Math.sin(e.a) * (e.v ?? e.speed) * t };
      seen.push({ x: lead.x, y: lead.y, d });
      if (seen.length > 6) seen.shift();
      const late = seen[0];
      const a = steer(p, toward(p, late), late.d > 350 ? 'boost' : 'cruise', .08);
      keys.KeyS = late.d < 160 && Math.abs(a) > .9;
      keys.Space = Math.abs(a) < .18 && late.d < 450;
      if (d < 300 && Math.abs(a) > .5) circling += DT; else if (Math.abs(a) < .18) circling = 0;
      if (circling > 8) { circling = 0; stalemates++; extendUntil = game.time + 2.5; log('circle broken', { d: Math.round(d) }); }
      // Anyone eases off and pulls aside when a fighter fills the windscreen.
      if (d < 150) {
        const dx = e.x - p.x, dy = e.y - p.y, ev = e.v ?? e.speed, now = angDiff(p.a, toward(p, e));
        const closingSpeed = ((Math.cos(p.a) * p.speed - Math.cos(e.a) * ev) * dx + (Math.sin(p.a) * p.speed - Math.sin(e.a) * ev) * dy) / d;
        if (closingSpeed > 40 && Math.abs(now) < 1) { keys.KeyW = false; keys.KeyS = true; keys.KeyA = now > 0; keys.KeyD = now <= 0; }
        else if (d < 100 && Math.abs(now) < 1) { keys.KeyW = false; keys.KeyS = true; }
      }
    }

    function bombRun(field, tolerance) {
      // Fly across the field and release when the predicted impact lands on it.
      const A = CONFIG.aircraft[p.aircraft] || {}, B = CONFIG.bomb;
      const drift = A.bombDriftSpeed ?? B.driftSpeed, fall = A.bombFallSeconds ?? B.fallSeconds;
      const impact = { x: p.x + Math.cos(p.a) * drift * fall, y: p.y + Math.sin(p.a) * drift * fall };
      const d = dist(p, field), off = angDiff(p.a, toward(p, field));
      // Too close to line up: extend, then come back round.
      if (d < 260 && Math.abs(off) > .5) { steer(p, p.a, 'cruise'); return; }
      steer(p, toward(p, field), d > 700 ? 'boost' : 'cruise', .03);
      if (dist(impact, field) < (tolerance ?? (A.bombBlastRadius ?? B.blastRadius) * .6) && p.bombCd <= 0 && api.launchBomb()) { bombs++; log('bomb', { target: field.name ?? field.id, hp: field.hp }); }
    }

    function orbit(c, radius) {
      const d = dist(p, c), out = Math.atan2(p.y - c.y, p.x - c.x);
      // Tangent heading, pulled in or out to hold the radius.
      const heading = out + Math.PI / 2 + Math.max(-.9, Math.min(.9, (d - radius) / radius * 1.5));
      steer(p, heading, 'brake');
    }

    // A manual straight-in approach: gate behind the stern, then ride the centreline.
    function land(wp) {
      const base = resolveBase(game, wp.baseId);
      if (!base) return;
      approach ??= { start: game.time, baseId: base.id };
      if (approach.baseId !== base.id) approach = { start: game.time, baseId: base.id };
      if (game.time - approach.start > 180) {   // a person would have given up on this approach
        approaches.push({ seconds: game.time - approach.start, ok: false, base: base.id });
        log('approach abandoned', { base: base.id }); approach = { start: game.time, baseId: base.id };
      }
      const ca = Math.cos(base.a), sa = Math.sin(base.a), stern = -base.length / 2;
      const along = (p.x - base.x) * ca + (p.y - base.y) * sa, lateral = -(p.x - base.x) * sa + (p.y - base.y) * ca;
      const gate = stern - 650;
      const lined = along < stern - 60 && along > gate - 300 && Math.abs(lateral) < 160 && Math.abs(angDiff(p.a, base.a)) < 1;
      if (lined || (along > gate - 300 && along < stern && Math.abs(lateral) < 60)) {
        // Final: heading into the runway, correcting lateral error.
        const correction = Math.max(-.35, Math.min(.35, -lateral * .012));
        steer(p, base.a + correction, 'brake', .02);
        return;
      }
      // Downwind to the gate, from the side we are already on so we do not cross the runway.
      const side = lateral >= 0 ? 1 : -1;
      const gx = base.x + ca * gate, gy = base.y + sa * gate;
      const target = along > gate ? { x: gx - sa * 260 * side + ca * -250, y: gy + ca * 260 * side + sa * -250 } : { x: gx, y: gy };
      steer(p, toward(p, target), dist(p, target) > 1200 ? 'boost' : 'cruise');
    }

    if (game.mode === 'victory') log('victory');
    const report = game.sessionReport, summary = api.sessionSummary();
    const minutes = game.time / 60, played = Object.values(budget).reduce((a, b) => a + b, 0);
    const firstCapture = events.find(e => e.kind === 'captured');
    return {
      seed, minutes: +minutes.toFixed(1), mode: game.mode, victory: game.mode === 'victory' ? +game.time.toFixed(0) : null, endReason: game.endReason || null, score: game.score, rank: game.rank,
      captured: report.captured, lost: report.lost, holdings: game.territories.filter(t => t.owner === 'us').length, territories: game.territories.length,
      deaths, sorties, landings, bombs, combatSorties: game.combatSorties || 0,
      firstCapture: firstCapture ? firstCapture.t : null,
      unlocks: summary.unlocks.map(u => ({ aircraft: u.aircraft, t: +u.time.toFixed(0) })),
      rescue: game.rescue.status, raids: summary.raids, wing: summary.wing,
      share: Object.fromEntries(Object.entries(budget).map(([k, v]) => [k, +(v / played).toFixed(3)])),
      fought: Object.fromEntries(Object.entries(fought).map(([k, v]) => [k, Math.round(v)])), killedBy, duels, stalemates, homeReasons,
      approaches, stalls, events,
    };
  }

  const median = xs => { const s = xs.filter(x => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
  const runs = [];
  for (const seed of SEEDS) {
    const t0 = performance.now();
    const r = runSeed(seed); runs.push(r);
    const s = r.share;
    console.log(`seed ${String(seed).padEnd(5)} ${r.minutes}min ${r.mode.padEnd(8)} score ${String(r.score).padStart(5)}  captured ${r.captured} lost ${r.lost} (${r.holdings}/${r.territories})  deaths ${r.deaths}  sorties ${r.sorties} landed ${r.landings}  first capture ${r.firstCapture ?? '—'}s  unlocks ${r.unlocks.map(u => `${u.aircraft}@${u.t}s`).join(',') || '—'}  rescue ${r.rescue}`);
    console.log(`           time: idle ${(s.idle * 100).toFixed(0)}%  transit ${(s.transit * 100).toFixed(0)}%  explore ${(s.explore * 100).toFixed(0)}%  home ${(s.home * 100).toFixed(0)}% (${r.homeReasons.rearm} rearm, ${r.homeReasons.hull} hull)  combat ${(s.combat * 100).toFixed(0)}%  attack ${(s.attack * 100).toFixed(0)}%  capture ${(s.capture * 100).toFixed(0)}%  approach ${(s.approach * 100).toFixed(0)}%  ground ${(s.ground * 100).toFixed(0)}%  recovery ${(s.recovery * 100).toFixed(0)}%   stalls ${r.stalls.length}  circles ${r.stalemates}\n           fighting (s): ${Object.entries(r.fought).map(([k, v]) => `${k} ${v}`).join('  ')}   shot down by: ${Object.entries(r.killedBy).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join('  ') || '—'}   (${((performance.now() - t0) / 1000).toFixed(0)}s wall)`);
  }
  const total = key => runs.reduce((n, r) => n + r[key], 0), totalMinutes = runs.reduce((n, r) => n + r.minutes, 0);
  const shareOf = key => runs.reduce((n, r) => n + r.share[key] * r.minutes, 0) / totalMinutes;
  const allApproaches = runs.flatMap(r => r.approaches);
  const duels = runs.flatMap(r => r.duels);
  for (const kind of ['raider', 'defender', 'strike', 'rescue']) {
    const d = duels.filter(x => x.kind === kind);
    if (d.length) console.log(`duels vs ${kind.padEnd(8)} ${String(d.length).padStart(3)}  median ${median(d.map(x => x.seconds)).toFixed(0)}s  player kill ${(d.filter(x => x.end === 'player').length / d.length * 100).toFixed(0)}%  others ${(d.filter(x => x.end === 'other').length / d.length * 100).toFixed(0)}%  broke off ${(d.filter(x => x.end === 'left').length / d.length * 100).toFixed(0)}%`);
  }
  const metrics = {
    firstCaptureSeconds: median(runs.map(r => r.firstCapture ?? Infinity)),
    victoryRate: runs.filter(r => r.victory != null).length / runs.length,
    victoryMinutes: median(runs.map(r => r.victory == null ? Infinity : r.victory / 60)),
    idleShare: shareOf('idle'),
    capturesPer10Min: total('captured') / totalMinutes * 10,
    transitShare: shareOf('transit') + shareOf('explore') + shareOf('home'), groundShare: shareOf('ground'),
    returnSeconds: median(allApproaches.filter(a => a.ok).map(a => a.seconds)) ?? 0,
    landingSuccess: allApproaches.length ? allApproaches.filter(a => a.ok).length / allApproaches.length : 1,
    deathsPer10Min: total('deaths') / totalMinutes * 10,
    stalls: runs.reduce((n, r) => n + r.stalls.length, 0),
  };
  let failed = 0;
  for (const [key, [low, high]] of Object.entries(BANDS)) {
    const value = metrics[key], ok = value >= low && value <= high;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${key.padEnd(20)} ${Number.isFinite(value) ? value.toFixed(2).padStart(8) : String(value).padStart(8)}   band ${low}..${high}`);
  }
  const out = path.join(__dirname, 'shots'); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'campaign-pilot.json'), JSON.stringify({ minutes: MINUTES, bands: BANDS, metrics, runs }, null, 2));
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
