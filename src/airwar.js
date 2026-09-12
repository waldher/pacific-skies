// Friendly air activity and the occasional roaming Zero.
//
//   wing     the player's squadron: formation off the quarters, engages what
//            the player engages, comes home. Slots by rank; a loss is only
//            replaced after further combat sorties (main.js keeps the tally).
//   patrol   pairs launched by captured airfields to sweep the neighbourhood
//   cap      combat air patrol orbiting the active carrier
//   strike   carrier dive bombers flown against the nearest enemy holding
// All of them fly with the same throttle-for-turn model as everyone else.
import { CONFIG } from './config.js';
import { game } from './state.js';
import { view } from './canvas.js';
import { clamp, angDiff, rand, lerp, TAU } from './util.js';
import { turnFactor } from './player.js';
import { leadPoint, headOn } from './enemies.js';
import { damageShip } from './ships.js';
import { explosion } from './particles.js';
import { notify } from './campaign.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const flying = f => f.hp > 0 && (!f.flight || f.flight === 'flying');

function pilot(role, aircraft, x, y, a, extra = {}) {
  const W = CONFIG.airWar.wing, type = CONFIG.aircraft[aircraft] || {};
  return { team: 'us', role, aircraft, x, y, a, hp: W.hp, maxHp: W.hp,
    speed: type.speedCruise ?? W.speed, boost: type.speedBoost ?? W.boost, brake: type.speedBrake ?? W.speed * .6,
    turn: type.turnRate ?? W.turn, v: type.speedCruise ?? W.speed, fireCd: 0, hitFlash: 0, kills: 0, ...extra };
}
// Common flight: turn toward a point at a throttle, with turn rate following speed.
function steer(f, tx, ty, throttle, dt) {
  const want = Math.atan2(ty - f.y, tx - f.x), diff = angDiff(f.a, want);
  const turn = f.turn * turnFactor(f.v, f.brake, f.boost);
  f.a += clamp(diff, -turn * dt, turn * dt);
  const goal = throttle > 1 ? f.boost : throttle < 1 ? f.brake : f.speed;
  f.v = lerp(f.v, goal, 1 - Math.pow(.05, dt));
  f.x += Math.cos(f.a) * f.v * dt; f.y += Math.sin(f.a) * f.v * dt;
  return diff;
}
function nearestEnemy(point, range) {
  let best = null, bd = range;
  for (const e of game.enemies) {
    if (e.hp <= 0) continue;
    const d = distance(point, e);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
// Lead pursuit and gunfire; returns true while the target is still worth chasing.
function attack(f, target, dt, veteran = false) {
  const W = CONFIG.airWar.wing, aim = veteran ? W.veteran.aimCone : W.aimCone, cooldown = veteran ? W.veteran.fireCooldown : W.fireCooldown;
  let tx, ty;
  if (headOn(f, target, CONFIG.enemy.avoidRange)) {
    const side = angDiff(f.a, Math.atan2(target.y - f.y, target.x - f.x)) > 0 ? -1 : 1;
    tx = f.x + Math.cos(f.a + side * 1.2) * 200; ty = f.y + Math.sin(f.a + side * 1.2) * 200;
  } else ({ x: tx, y: ty } = leadPoint(f, target, CONFIG.player.bulletSpeed));
  const off = Math.abs(angDiff(f.a, Math.atan2(ty - f.y, tx - f.x)));
  const diff = steer(f, tx, ty, off > 1.1 ? 0 : 1, dt);
  if (f.fireCd <= 0 && Math.abs(diff) < aim && distance(f, target) < CONFIG.enemy.engageDist) {
    f.fireCd = cooldown;
    game.bullets.push({ x: f.x + Math.cos(f.a) * 22, y: f.y + Math.sin(f.a) * 22,
      vx: Math.cos(f.a) * CONFIG.player.bulletSpeed, vy: Math.sin(f.a) * CONFIG.player.bulletSpeed,
      life: CONFIG.player.bulletLife, fromShip: true, fromAlly: true, pilot: f.name });
  }
}

// --- wing -------------------------------------------------------------------
function musterWing() {
  const W = CONFIG.airWar.wing, p = game.player;
  game.wing ||= { lost: 0, kills: 0, roster: 0, replacementAt: null };
  const wing = game.allies.filter(f => (f.role ?? 'wing') === 'wing');
  const slots = W.slots[Math.min(game.rank || 0, W.slots.length - 1)];
  if (wing.length >= slots) return;
  // New pilots report at a base, or at the start of a campaign.
  if (p.flight === 'flying' && game.time > 1) return;
  if (game.wing.replacementAt != null && (game.combatSorties || 0) < game.wing.replacementAt) return;
  const name = W.names[game.wing.roster % W.names.length];
  const [along, lateral] = W.formation[wing.length % W.formation.length];
  const x = p.x + Math.cos(p.a) * along - Math.sin(p.a) * lateral, y = p.y + Math.sin(p.a) * along + Math.cos(p.a) * lateral;
  game.allies.push(pilot('wing', 'p38', x, y, p.a, { name, slot: wing.length }));
  game.wing.roster++;
  if (game.wing.replacementAt != null) { game.wing.replacementAt = null; notify(game, `${name} reports for duty as your wingman`); }
}
function flyWing(f, dt) {
  const W = CONFIG.airWar.wing, p = game.player, veteran = (f.kills || 0) >= W.veteranKills;
  if (veteran && f.maxHp !== W.veteran.hp) { f.maxHp = W.veteran.hp; f.hp = Math.min(f.maxHp, f.hp + (W.veteran.hp - W.hp)); }
  if (p.flight !== 'flying') {
    // Repair while the player is on the ground and hold overhead.
    f.hp = Math.min(f.maxHp, f.hp + 5 * dt);
    const a = game.time * .6 + (f.slot || 0) * 2;
    steer(f, p.x + Math.cos(a) * 260, p.y + Math.sin(a) * 260, 1, dt);
    return;
  }
  // Fight what threatens the player, or whatever is right on top of the wingman itself.
  const near = nearestEnemy(f, W.engageRange), threat = nearestEnemy(p, W.engageRange) || near;
  if (threat && (distance(p, threat) < W.leashRange || distance(f, threat) < W.engageRange * .6)) { attack(f, threat, dt, veteran); return; }
  // Formation slot off the player's quarters; speed matches the gap.
  const [along, lateral] = W.formation[(f.slot || 0) % W.formation.length];
  const sx = p.x + Math.cos(p.a) * along - Math.sin(p.a) * lateral, sy = p.y + Math.sin(p.a) * along + Math.cos(p.a) * lateral;
  const gap = Math.hypot(sx - f.x, sy - f.y);
  if (gap > W.rejoinRange) { steer(f, sx, sy, 2, dt); return; }
  const want = gap < 30 ? p.a : Math.atan2(sy - f.y, sx - f.x), diff = angDiff(f.a, want);
  const turn = f.turn * turnFactor(f.v, f.brake, f.boost);
  f.a += clamp(diff, -turn * dt, turn * dt);
  const ahead = (sx - f.x) * Math.cos(f.a) + (sy - f.y) * Math.sin(f.a);
  const goal = clamp(p.speed * (1 + ahead / 120), f.brake, f.boost);
  f.v = lerp(f.v, goal, 1 - Math.pow(.02, dt));
  f.x += Math.cos(f.a) * f.v * dt; f.y += Math.sin(f.a) * f.v * dt;
}

// --- airfield patrols ---------------------------------------------------------
function launchPatrols(dt) {
  const P = CONFIG.airWar.patrol;
  let active = game.allies.filter(f => f.role === 'patrol').length;
  for (const field of game.airfields) {
    if (field.owner !== 'us' || field.hp <= 0) continue;
    field.patrolTimer = (field.patrolTimer ?? rand(P.intervalMin, P.intervalMax)) - dt;
    if (field.patrolTimer > 0 || active + P.size > P.maxActive) continue;
    field.patrolTimer = rand(P.intervalMin, P.intervalMax);
    const heading = rand(0, TAU);
    const route = [0, 2.2, 4.3].map(offset => ({ x: field.x + Math.cos(heading + offset) * P.radius, y: field.y + Math.sin(heading + offset) * P.radius }));
    for (let i = 0; i < P.size; i++) {
      game.allies.push(pilot('patrol', 'p38', field.x + Math.cos(field.a + Math.PI / 2) * (i ? 40 : -40), field.y + Math.sin(field.a + Math.PI / 2) * (i ? 40 : -40), field.a,
        { name: `${field.name} patrol`, home: { x: field.x, y: field.y }, route, leg: 0, life: P.duration }));
      active++;
    }
  }
}
function flyPatrol(f, dt) {
  const P = CONFIG.airWar.patrol;
  f.life -= dt;
  const target = nearestEnemy(f, P.engageRange);
  if (target) { attack(f, target, dt); return; }
  const goal = f.life > 0 ? f.route[f.leg % f.route.length] : f.home;
  if (distance(f, goal) < CONFIG.airWar.waypointRadius) {
    if (f.life <= 0) { f.departed = true; return; }
    f.leg++;
  }
  steer(f, goal.x, goal.y, 1, dt);
}

// --- carrier air ---------------------------------------------------------------
function carrierAir(dt) {
  const C = CONFIG.airWar.cap, K = CONFIG.airWar.carrierStrike;
  const carrier = game.ships.find(s => s.id === 'carrier');
  if (!carrier || carrier.active === false || carrier.hp <= 0) return;
  const cap = game.allies.filter(f => f.role === 'cap');
  carrier.capTimer = Math.max(0, (carrier.capTimer ?? 0) - dt);
  if (cap.length < C.count && carrier.capTimer <= 0) {
    game.allies.push(pilot('cap', 'corsair', carrier.x, carrier.y, carrier.a, { name: 'Carrier CAP', phase: cap.length * Math.PI }));
    carrier.capTimer = cap.length + 1 < C.count ? 2 : C.respawn;
  }
  carrier.strikeTimer = (carrier.strikeTimer ?? rand(K.intervalMin, K.intervalMax)) - dt;
  if (carrier.strikeTimer <= 0 && !game.allies.some(f => f.role === 'strike')) {
    carrier.strikeTimer = rand(K.intervalMin, K.intervalMax);
    const targets = [...game.territories.filter(t => t.owner === 'enemy'), ...game.ships.filter(s => s.team === 'jp' && s.hp > 0 && s.active !== false)];
    const target = targets.filter(t => distance(carrier, t) < K.range).sort((a, b) => distance(carrier, a) - distance(carrier, b))[0];
    if (target) {
      for (let i = 0; i < K.size; i++) game.allies.push(pilot('strike', 'dauntless', carrier.x, carrier.y - 30 + i * 60, carrier.a,
        { name: 'Carrier strike', target: { x: target.x, y: target.y, id: target.id, ship: !!target.kind }, phase: 'attack' }));
      notify(game, `Carrier strike launched against ${target.name || 'enemy shipping'}`);
    }
  }
}
function flyCap(f, dt) {
  const C = CONFIG.airWar.cap, carrier = game.ships.find(s => s.id === 'carrier');
  if (!carrier || carrier.active === false || carrier.hp <= 0) { f.departed = true; return; }
  const target = nearestEnemy(carrier, C.engageRange) || nearestEnemy(f, C.engageRange * .6);
  if (target) { attack(f, target, dt); return; }
  const a = game.time * .35 + f.phase;
  steer(f, carrier.x + Math.cos(a) * C.radius, carrier.y + Math.sin(a) * C.radius, 1, dt);
}
function flyStrike(f, dt) {
  const K = CONFIG.airWar.carrierStrike, carrier = game.ships.find(s => s.id === 'carrier');
  if (f.phase === 'attack') {
    steer(f, f.target.x, f.target.y, 1, dt);
    if (distance(f, f.target) > K.attackRange) return;
    f.phase = 'return';
    if (f.target.ship) {
      const ship = game.ships.find(s => s.id === f.target.id);
      if (ship && ship.hp > 0) damageShip(ship, K.damage);
    } else {
      const holding = game.territories.find(t => t.id === f.target.id);
      if (holding?.owner === 'enemy') {
        if (holding.maxIntegrity) holding.integrity = Math.max(0, (holding.integrity ?? holding.maxIntegrity) - K.damage);
        for (const field of game.airfields) if (field.territory === holding.id && field.owner === 'enemy') field.hp = Math.max(0, field.hp - K.damage);
      }
    }
    explosion(f.target.x, f.target.y, true);
    return;
  }
  if (!carrier || carrier.active === false || carrier.hp <= 0) { f.departed = true; return; }
  steer(f, carrier.x, carrier.y, 1, dt);
  if (distance(f, carrier) < CONFIG.airWar.waypointRadius) f.departed = true;
}

export function updateAirWar(dt) {
  const A = CONFIG.airWar;
  game.raidTimer -= dt;
  if (game.raidTimer <= 0 && game.player.flight === 'flying' && !game.enemies.some(e => e.raider && e.hp > 0)) {
    const angle = rand(0, TAU), radius = Math.max(A.raidSpawnDistance, Math.hypot(view.W, view.H) / 2 + 200);
    game.enemies.push({ x: game.player.x + Math.cos(angle) * radius, y: game.player.y + Math.sin(angle) * radius,
      a: angle + Math.PI, hp: CONFIG.enemy.hp, speed: A.raidSpeed, turn: CONFIG.enemy.turn,
      raider: true, ace: false, style: 'veteran', fireCd: 1, wobble: rand(0, TAU) });
    game.raidTimer = rand(A.raidMin, A.raidMax);
  }
  musterWing();
  launchPatrols(dt);
  carrierAir(dt);
  for (const f of game.allies) {
    if (!flying(f)) continue;
    f.fireCd -= dt; f.hitFlash = Math.max(0, f.hitFlash - dt);
    f.v ??= f.speed; f.brake ??= f.speed * .6; f.boost ??= f.speed * 1.35;
    if (f.role === 'patrol') flyPatrol(f, dt);
    else if (f.role === 'cap') flyCap(f, dt);
    else if (f.role === 'strike') flyStrike(f, dt);
    else flyWing(f, dt);
  }
  game.allies = game.allies.filter(f => !f.departed);
}
