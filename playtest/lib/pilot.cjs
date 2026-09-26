// A campaign pilot: plays the whole loop the way a player follows the gold
// marker, with keys and HUD calls only (nothing is edited after startGame).
// A persona sets skill (reaction, sight, aim, lead) and strategy (what it
// fights, whether it shoots, whether it pursues objectives at all).
//
// runCampaign() returns telemetry for fun-metrics.cjs: a per-second
// timeline, categorized events and per-sortie activity sequences.
const DT = 1 / 30;

// Skill axis on the marker-following strategy, then restricted strategies
// on average skill. Restricted play: if a restricted persona does as well
// as the full one, whatever it gave up does not matter to the game.
const PERSONAS = {
  rookie: { role: 'skill', about: 'half a second late, notices fighters only close in, sprays at the pipper, presses on hurt',
    reaction: 14, sight: 550, fightRange: 550, aimCone: .3, lead: 'pipper', circleBreak: 16, pressOnHull: 15, menuSeconds: 8, patience: 40 },
  average: { role: 'skill', about: 'the combat-balance average pilot: 0.2 s late, fires on the pipper',
    reaction: 6, sight: Infinity, fightRange: 800, aimCone: .18, lead: 'pipper', circleBreak: 8, menuSeconds: 4, patience: 60 },
  ace: { role: 'skill', about: 'quick, leads along the target\'s arc, tight trigger discipline',
    reaction: 3, sight: Infinity, fightRange: 900, aimCone: .12, lead: 'arc', circleBreak: 5, menuSeconds: 3, patience: 60 },
  brawler: { role: 'strategy', about: 'hunts every aircraft it can see before anything else',
    reaction: 6, sight: Infinity, fightRange: 1600, aimCone: .18, lead: 'pipper', circleBreak: 8, menuSeconds: 4, patience: 90, prefer: ['p51', 'corsair', 'p38', 'dauntless'] },
  rusher: { role: 'strategy', about: 'skips fights: shoots only what is on its tail, boosts everywhere',
    reaction: 6, sight: Infinity, fightRange: 260, aimCone: .18, lead: 'pipper', circleBreak: 8, menuSeconds: 4, patience: 30, boost: true, prefer: ['p51', 'p38', 'corsair', 'dauntless'] },
  pacifist: { role: 'strategy', about: 'never fires a gun: bombs, captures, lets the wing fight',
    reaction: 6, sight: Infinity, fightRange: 0, aimCone: 0, lead: 'pipper', circleBreak: 8, menuSeconds: 4, guns: false },
  passive: { role: 'neglect', about: 'defends the home field and never advances: does the war come to you?',
    reaction: 6, sight: Infinity, fightRange: 700, aimCone: .18, lead: 'pipper', circleBreak: 8, menuSeconds: 4, patience: 60, stayHome: true },
};

function runCampaign(env, { seed, persona: name = 'average', minutes = 45, verbose = false }) {
  const { api, modules, clearStorage } = env;
  const { game, CONFIG, keys, update, angDiff } = api;
  const { AIRCRAFT, availableBases, canUseAircraft, resolveBase, enemyObserved, leadPoint, objectiveFor } = modules;
  const P = PERSONAS[name], Q = CONFIG.conquest;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const toward = (p, q) => Math.atan2(q.y - p.y, q.x - p.x);
  const release = () => { for (const k of Object.keys(keys)) keys[k] = false; };
  function steer(p, heading, throttle = 'cruise', deadband = .05) {
    const d = angDiff(p.a, heading);
    keys.KeyA = d < -deadband; keys.KeyD = d > deadband;
    keys.KeyW = throttle === 'boost'; keys.KeyS = throttle === 'brake';
    return d;
  }

  clearStorage(); api.setSeed(seed); api.startGame();
  const p = game.player;
  const kindOf = e => e.rescue ? 'rescue' : e.strike ? (e.strikeRole === 'escort' ? 'escort' : 'bomber') : e.territory != null ? 'defender' : 'raider';
  const events = [], timeline = [], sorties = [];
  const log = (kind, extra = {}) => {
    events.push({ t: +game.time.toFixed(1), kind, ...extra });
    if (verbose) console.log(`  ${name} ${seed} ${game.time.toFixed(0).padStart(5)}s ${kind}`, JSON.stringify(extra));
  };
  // Patience: a fight with no hits for this long is abandoned, as a person would; the target is ignored unless it closes in.
  const seen = [], engaged = new Map(), ignored = new Map(), approaches = [];
  let circling = 0, extendUntil = 0, fleeUntil = 0, approach = null, groundWait = 0, recoverWait = 0;
  let lastWaypoint, lastTarget = null, sortie = null, wall = 0;
  let lastWar = '', lastProgress = 0;
  const warState = () => [game.territories.map(t => t.owner).join(''), game.rank, game.unlockedAircraft.length,
    game.airfields.filter(f => f.owner === 'enemy').map(f => Math.round(f.hp)).join(','), game.ships.filter(x => x.team === 'jp').map(x => x.hp).join(',')].join('|');
  const ownerOf = new Map(game.territories.map(t => [t.id, t.owner]));
  let unlocks = game.unlockedAircraft.length, rescue = game.rescue.status, raidImpacts = 0;
  const shipsSeen = new Set(), convoysSeen = new WeakSet();
  // Per-second accumulator for the timeline.
  let second = { ticks: {}, near: 0, taken: 0, shots: 0, fighting: 0 };

  while (wall < minutes * 60 && ['play', 'recovery'].includes(game.mode)) {
    wall += DT;
    release();
    let activity;
    if (game.mode === 'recovery') {
      activity = 'recovery';
      if ((recoverWait += DT) > 2) { recoverWait = 0; api.recoverPilot(); log('recovered', { base: p.baseId }); }
    } else if (p.flight === 'landed') {
      activity = 'ground';
      if ((groundWait += DT) > P.menuSeconds) {
        groundWait = 0; chooseAircraft(); api.requestCarrier();
        sortie = { start: game.time, aircraft: p.aircraft, acts: [], end: null };
        log('takeoff', { base: p.baseId, aircraft: p.aircraft });
      }
    } else if (p.flight !== 'flying') activity = 'ground';
    else activity = fly();

    const wpKey = game.waypoint && !(game.waypoint.returning || game.waypoint.rescue)
      ? game.waypoint.team === 'jp' ? game.waypoint.name : `${game.waypoint.name}@${Math.round(game.waypoint.x)},${Math.round(game.waypoint.y)}` : lastWaypoint;
    if (wpKey !== lastWaypoint) { lastWaypoint = wpKey; log('waypoint', { to: wpKey, decision: true }); }

    const hpBefore = p.hp, modeBefore = game.mode, flightBefore = p.flight, meritBefore = game.playerMerit || 0;
    const bulletsBefore = new Set(game.bullets);
    if (game.mode === 'play') update(DT);
    const shots = game.bullets.filter(b => !bulletsBefore.has(b) && !b.fromAlly && !b.fromShip && !b.pilot).length;

    for (const [e, d] of engaged) if (e.hp <= 0 || !game.enemies.includes(e)) {
      const end = e.hp > 0 ? 'left' : (game.playerMerit || 0) > meritBefore ? 'player' : 'other';
      if (end === 'player') log('kill', { of: d.kind });
      engaged.delete(e);
    }
    if (modeBefore === 'play' && game.mode === 'recovery') {
      log('shot down', { activity, by: lastTarget ? kindOf(lastTarget) : null }); approach = null;
      closeSortie('shot down');
    }
    if (p.flight === 'landing' && flightBefore === 'flying') {
      if (approach) approaches.push(game.time - approach.start);
      log('landed', { base: p.baseId, decision: true }); approach = null; closeSortie('landed');
    }
    // What changed in the war this tick.
    for (const t of game.territories) {
      const was = ownerOf.get(t.id);
      if (was !== t.owner) { log(t.owner === 'us' ? 'captured' : 'lost', { role: t.role, name: t.name }); ownerOf.set(t.id, t.owner); }
    }
    if (game.unlockedAircraft.length > unlocks) { unlocks = game.unlockedAircraft.length; log('unlock', { aircraft: game.unlockedAircraft.at(-1) }); }
    if (game.rescue.status !== rescue) { rescue = game.rescue.status; log('rescue', { status: rescue }); }
    if ((game.raidImpacts || 0) > raidImpacts) { raidImpacts = game.raidImpacts; log('base hit'); }
    for (const s of game.ships) if (s.team === 'jp' && s.hp > 0 && s.active !== false && !shipsSeen.has(s.id) && dist(s, p) < 1500) { shipsSeen.add(s.id); log('fleet sighted', { ship: s.kind }); }
    for (const c of game.convoys || []) if (!convoysSeen.has(c) && dist(c, p) < 1500) { convoysSeen.add(c); log('convoy sighted'); }
    const war = warState();
    if (war !== lastWar || game.mode !== 'play') lastProgress = game.time;
    lastWar = war;
    if (game.time - lastProgress > 420) { log('STALL', { activity, waypoint: game.waypoint?.name ?? null }); lastProgress = game.time; }

    // Timeline: one sample per game second.
    second.ticks[activity] = (second.ticks[activity] || 0) + 1;
    if (p.flight === 'flying') second.taken += Math.max(0, hpBefore - p.hp);
    second.shots += shots;
    second.near = Math.max(second.near, game.enemies.filter(e => e.hp > 0 && enemyObserved(game, e) && dist(e, p) < 800).length);
    if (Math.floor(wall) !== Math.floor(wall - DT)) {
      const act = Object.entries(second.ticks).sort((a, b) => b[1] - a[1])[0][0];
      timeline.push({ t: Math.round(game.time), act, hull: Math.round(p.hp), near: second.near, taken: Math.round(second.taken), shots: second.shots,
        holdings: game.territories.filter(t => t.owner === 'us').length, aircraft: p.aircraft,
        objective: game.mode === 'play' ? objectiveFor(game).title : 'Recovery' });
      if (sortie) { const last = sortie.acts.at(-1); if (last?.act === act) last.s++; else sortie.acts.push({ act, s: 1 }); }
      second = { ticks: {}, near: 0, taken: 0, shots: 0 };
    }
  }
  if (game.mode === 'victory') log('victory');
  closeSortie('end');

  function closeSortie(end) { if (sortie) { sortie.end = end; sortie.seconds = Math.round(game.time - sortie.start); sorties.push(sortie); sortie = null; } }

  function chooseAircraft() {
    const base = availableBases(game).find(b => b.id === p.baseId);
    // Each persona takes the first aircraft on its list the base allows: bombers for marker-followers, fighters for hunters, speed for rushers.
    for (const id of P.prefer || ['dauntless', 'p51', 'corsair', 'p38']) if (canUseAircraft(game, base, id) && AIRCRAFT[id].loadouts.includes('bombs')) {
      if (id !== p.aircraft) { api.selectSortie({ baseId: base.id, aircraft: id, loadout: 'bombs' }); log('aircraft', { aircraft: id, decision: true }); }
      return;
    }
  }

  // One flying tick: returns the activity it spent the tick on.
  function fly() {
    const wp = game.waypoint;
    let threat = null, td = Infinity;
    for (const e of game.enemies) {
      if (e.hp <= 0 || !enemyObserved(game, e)) continue;
      const d = dist(e, p);
      if ((ignored.get(e) ?? 0) > game.time) continue;
      if (d < td && d < P.sight) { td = d; threat = e; }
    }
    const returning = wp?.returning && !(P.pressOnHull && p.hp > P.pressOnHull && p.hp < CONFIG.navigation.repairHull);
    const range = returning ? Math.min(350, P.fightRange) : P.fightRange;
    if (threat && td < range) {
      if (threat !== lastTarget) { lastTarget = threat; log('engage', { of: kindOf(threat), decision: true }); }
      if (!engaged.has(threat)) engaged.set(threat, { kind: kindOf(threat), start: game.time, hp: threat.hp });
      const duel = engaged.get(threat);
      if (threat.hp < duel.hp) { duel.hp = threat.hp; duel.start = game.time; }
      else if (P.patience && game.time - duel.start > P.patience) {
        ignored.set(threat, game.time + 30); fleeUntil = game.time + 30; duel.start = game.time; log('gave up', { of: kindOf(threat), decision: true });
      }
      dogfight(threat, td); return 'combat';
    }
    // Unarmed or not engaging: break away from anything on the tail.
    if (threat && td < 300 && P.guns === false) { steer(p, toward(threat, p), 'boost'); return 'evade'; }
    lastTarget = null; seen.length = 0;
    if (returning) {
      land(wp);
      const base = resolveBase(game, wp.baseId);
      return base && dist(p, base) > 1500 ? 'home' : 'approach';
    }
    approach = null;
    if (P.stayHome) {
      const home = resolveBase(game, 'home-airfield') || resolveBase(game);
      if (home) { orbit(home, 700); return 'patrol'; }
    }
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
      if (dist(p, carrier) < 700) { orbit(carrier, 300); return 'patrol'; }
    }
    steer(p, toward(p, wp), P.boost || game.time < fleeUntil || dist(p, wp) > 1200 ? 'boost' : 'cruise');
    return wp.search ? 'explore' : 'transit';
  }

  function dogfight(e, d) {
    if (game.time < extendUntil) { steer(p, p.a + .15, 'boost'); return; }
    const bullet = CONFIG.player.bulletSpeed, v = e.v ?? e.speed, t = d / bullet;
    const aim = P.lead === 'arc' ? leadPoint(p, e, bullet) : P.lead === 'none' ? { x: e.x, y: e.y }
      : { x: e.x + Math.cos(e.a) * v * t, y: e.y + Math.sin(e.a) * v * t };
    seen.push({ x: aim.x, y: aim.y, d });
    if (seen.length > P.reaction) seen.shift();
    const late = seen[0];
    const a = steer(p, toward(p, late), late.d > 350 ? 'boost' : 'cruise', .08);
    keys.KeyS = late.d < 160 && Math.abs(a) > .9;
    keys.Space = P.guns !== false && Math.abs(a) < P.aimCone && late.d < 450;
    if (d < 300 && Math.abs(a) > .5) circling += DT; else if (Math.abs(a) < .18) circling = 0;
    if (circling > P.circleBreak) { circling = 0; extendUntil = game.time + 2.5; log('circle broken', { decision: true }); }
    // Anyone eases off and pulls aside when a fighter fills the windscreen.
    if (d < 150) {
      const dx = e.x - p.x, dy = e.y - p.y, now = angDiff(p.a, toward(p, e));
      const closingSpeed = ((Math.cos(p.a) * p.speed - Math.cos(e.a) * v) * dx + (Math.sin(p.a) * p.speed - Math.sin(e.a) * v) * dy) / d;
      if (closingSpeed > 40 && Math.abs(now) < 1) { keys.KeyW = false; keys.KeyS = true; keys.KeyA = now > 0; keys.KeyD = now <= 0; }
      else if (d < 100 && Math.abs(now) < 1) { keys.KeyW = false; keys.KeyS = true; }
    }
  }

  function bombRun(target, tolerance) {
    const A = CONFIG.aircraft[p.aircraft] || {}, B = CONFIG.bomb;
    const drift = A.bombDriftSpeed ?? B.driftSpeed, fall = A.bombFallSeconds ?? B.fallSeconds;
    const impact = { x: p.x + Math.cos(p.a) * drift * fall, y: p.y + Math.sin(p.a) * drift * fall };
    const d = dist(p, target), off = angDiff(p.a, toward(p, target));
    if (d < 260 && Math.abs(off) > .5) { steer(p, p.a, 'cruise'); return; }
    steer(p, toward(p, target), d > 700 ? 'boost' : 'cruise', .03);
    if (dist(impact, target) < (tolerance ?? (A.bombBlastRadius ?? B.blastRadius) * .6) && p.bombCd <= 0 && api.launchBomb()) log('bomb', { at: target.kind ?? 'airfield', decision: true });
  }

  function orbit(c, radius) {
    const d = dist(p, c), out = Math.atan2(p.y - c.y, p.x - c.x);
    steer(p, out + Math.PI / 2 + Math.max(-.9, Math.min(.9, (d - radius) / radius * 1.5)), 'brake');
  }

  // A manual straight-in approach: gate behind the stern, then ride the centreline.
  function land(wp) {
    const base = resolveBase(game, wp.baseId);
    if (!base) return;
    if (!approach || approach.baseId !== base.id) approach = { start: game.time, baseId: base.id };
    const ca = Math.cos(base.a), sa = Math.sin(base.a), stern = -base.length / 2;
    const along = (p.x - base.x) * ca + (p.y - base.y) * sa, lateral = -(p.x - base.x) * sa + (p.y - base.y) * ca;
    const gate = stern - 650;
    const lined = along < stern - 60 && along > gate - 300 && Math.abs(lateral) < 160 && Math.abs(angDiff(p.a, base.a)) < 1;
    if (lined || (along > gate - 300 && along < stern && Math.abs(lateral) < 60)) {
      steer(p, base.a + Math.max(-.35, Math.min(.35, -lateral * .012)), 'brake', .02);
      return;
    }
    const side = lateral >= 0 ? 1 : -1, gx = base.x + ca * gate, gy = base.y + sa * gate;
    const target = along > gate ? { x: gx - sa * 260 * side - ca * 250, y: gy + ca * 260 * side - sa * 250 } : { x: gx, y: gy };
    steer(p, toward(p, target), dist(p, target) > 1200 ? 'boost' : 'cruise');
  }

  return { seed, persona: name, minutes: +(game.time / 60).toFixed(2), mode: game.mode,
    victory: game.mode === 'victory' ? Math.round(game.time) : null, score: game.score,
    territories: game.territories.length, holdings: game.territories.filter(t => t.owner === 'us').length,
    approaches, timeline, events, sorties };
}

async function loadModules(env) {
  const [types, bases, intel, enemies, objectives] = await Promise.all(['src/aircraft-types.js', 'src/bases.js', 'src/intelligence.js', 'src/enemies.js', 'src/objectives.js'].map(f => env.namespace(f)));
  return { AIRCRAFT: types.AIRCRAFT, availableBases: bases.availableBases, canUseAircraft: bases.canUseAircraft, resolveBase: bases.resolveBase,
    enemyObserved: intel.enemyObserved, leadPoint: enemies.leadPoint, objectiveFor: objectives.objectiveFor };
}
module.exports = { runCampaign, loadModules, PERSONAS, DT };
