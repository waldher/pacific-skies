// Enemy supply convoys: slow transports between enemy holdings that resupply
// the destination on arrival. They never shoot back, sink to gunfire, and pay
// score, so an interdiction is worth a detour on any long transit.
import { CONFIG } from './config.js';
import { rand, TAU } from './util.js';
import { explosion, splash } from './particles.js';
import { notify } from './campaign.js';
import { observedAt } from './intelligence.js';

function segmentDistance(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}
// Open water off a holding's island: the port anchorage if it has one,
// otherwise past the island's extent on the holding's side.
function offshore(game, holding) {
  const island = (game.terrain || []).find(t => t.id === holding.terrainId) || holding;
  const a = holding.portShore ? holding.portShore.a : (Math.atan2(holding.y - island.y, holding.x - island.x) || 0);
  const d = (island.extent ?? island.radius) + CONFIG.convoy.offshore;
  return holding.portShore
    ? { x: holding.x + holding.portShore.x + Math.cos(a) * CONFIG.convoy.offshore, y: holding.y + holding.portShore.y + Math.sin(a) * CONFIG.convoy.offshore }
    : { x: island.x + Math.cos(a) * d, y: island.y + Math.sin(a) * d };
}
const clearOfLand = (game, a, b) => (game.terrain || []).every(t => segmentDistance(t, a, b) > (t.extent ?? t.radius) + 30);
let nextId = 1;

// A straight run if the water allows, otherwise one dogleg around whatever is in the way.
function findRoute(game, start, end) {
  if (clearOfLand(game, start, end)) return [end];
  const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2, d = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const nx = -(end.y - start.y) / d, ny = (end.x - start.x) / d;
  for (const offset of [1200, -1200, 2400, -2400, 3600, -3600]) {
    const mid = { x: mx + nx * offset, y: my + ny * offset };
    if (clearOfLand(game, start, mid) && clearOfLand(game, mid, end)) return [mid, end];
  }
  return null;
}

export function spawnConvoy(game) {
  const V = CONFIG.convoy, holdings = game.territories.filter(t => t.owner === 'enemy');
  const links = game.sectorLinks || [];
  const linked = (a, b) => a.sector === b.sector || links.some(([x, y]) => (x === a.sector && y === b.sector) || (x === b.sector && y === a.sector));
  // Every linked pair, in a seeded random order, until one has navigable water.
  const pairs = [];
  for (const from of holdings) for (const to of holdings) if (from !== to && from.terrainId !== to.terrainId && linked(from, to)) pairs.push([from, to]);
  for (let i = pairs.length - 1; i > 0; i--) { const j = Math.floor(rand(0, i + 1)); [pairs[i], pairs[j]] = [pairs[j], pairs[i]]; }
  for (const [from, to] of pairs) {
    const start = offshore(game, from), end = offshore(game, to), route = findRoute(game, start, end);
    if (!route) continue;
    const a = Math.atan2(route[0].y - start.y, route[0].x - start.x), count = Math.floor(rand(V.size[0], V.size[1] + 1));
    const convoyId = nextId++;
    for (let i = 0; i < count; i++) game.convoys.push({
      id: `transport-${convoyId}-${i}`, convoyId, kind: 'transport', team: 'jp', name: 'Supply transport',
      x: start.x - Math.cos(a) * V.spacing * i, y: start.y - Math.sin(a) * V.spacing * i, a,
      hp: V.hp, maxHp: V.hp, length: V.length, width: V.width, speed: V.speed, fireCd: 0,
      route, leg: 0, target: route[route.length - 1], holdingId: to.id, sighted: false,
    });
    return true;
  }
  return false;
}

export function damageTransport(game, s, amount = 1) {
  if (s.hp <= 0) return;
  s.hp = Math.max(0, s.hp - amount);
  game.playerMerit = (game.playerMerit || 0) + 1;
  if (s.hp === 0) {
    s.sinking = 0;
    game.score += CONFIG.convoy.score;
    explosion(s.x, s.y, false); splash(s.x, s.y);
    notify(game, 'Supply transport sunk');
  }
}

export function updateConvoys(game, dt) {
  const V = CONFIG.convoy;
  game.convoys ||= [];
  game.convoyTimer = (game.convoyTimer ?? V.firstDelay) - dt;
  const active = new Set(game.convoys.filter(s => s.hp > 0).map(s => s.convoyId)).size;
  if (game.convoyTimer <= 0) {
    if (active < V.maxActive && spawnConvoy(game)) game.convoyTimer = rand(V.intervalMin, V.intervalMax);
    else game.convoyTimer = 10;
  }
  const sighted = new Set();
  for (const s of game.convoys) {
    if (s.hp <= 0) { s.sinking = (s.sinking || 0) + dt; continue; }
    const goal = s.route?.[s.leg] ?? s.target, last = !s.route || s.leg >= s.route.length - 1;
    const dx = goal.x - s.x, dy = goal.y - s.y, d = Math.hypot(dx, dy);
    if (!last && d < 80) { s.leg++; continue; }
    if (last && d < 120) {
      // Delivered: the holding and any airfield on it are resupplied.
      const holding = game.territories.find(t => t.id === s.holdingId);
      if (holding?.owner === 'enemy') {
        if (holding.maxIntegrity) holding.integrity = Math.min(holding.maxIntegrity, (holding.integrity ?? holding.maxIntegrity) + V.supply);
        for (const f of game.airfields) if (f.territory === holding.id && f.owner === 'enemy') f.hp = Math.min(f.maxHp, f.hp + V.supply);
      }
      s.hp = 0; s.sinking = CONFIG.ship.sinkingSeconds + 1; s.delivered = true;
      continue;
    }
    s.a = Math.atan2(dy, dx);
    s.x += Math.cos(s.a) * s.speed * dt; s.y += Math.sin(s.a) * s.speed * dt;
    if (!s.sighted && observedAt(game, s, true) && Math.hypot(s.x - game.player.x, s.y - game.player.y) < V.sightRadius) sighted.add(s.convoyId);
  }
  for (const id of sighted) {
    for (const s of game.convoys) if (s.convoyId === id) s.sighted = true;
    notify(game, 'Enemy supply convoy sighted · guns can sink transports');
  }
  game.convoys = game.convoys.filter(s => s.hp > 0 || s.sinking <= CONFIG.ship.sinkingSeconds);
}
