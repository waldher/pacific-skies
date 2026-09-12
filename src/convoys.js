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

export function spawnConvoy(game) {
  const V = CONFIG.convoy, holdings = game.territories.filter(t => t.owner === 'enemy');
  const links = game.sectorLinks || [];
  const linked = (a, b) => a.sector === b.sector || links.some(([x, y]) => (x === a.sector && y === b.sector) || (x === b.sector && y === a.sector));
  for (let attempt = 0; attempt < 12; attempt++) {
    const from = holdings[Math.floor(rand(0, holdings.length))];
    const choices = holdings.filter(t => t !== from && t.terrainId !== from.terrainId && linked(from, t));
    if (!from || !choices.length) continue;
    const to = choices[Math.floor(rand(0, choices.length))];
    const start = offshore(game, from), end = offshore(game, to);
    if (!clearOfLand(game, start, end)) continue;
    const a = Math.atan2(end.y - start.y, end.x - start.x), count = Math.floor(rand(V.size[0], V.size[1] + 1));
    const convoyId = nextId++;
    for (let i = 0; i < count; i++) game.convoys.push({
      id: `transport-${convoyId}-${i}`, convoyId, kind: 'transport', team: 'jp', name: 'Supply transport',
      x: start.x - Math.cos(a) * V.spacing * i, y: start.y - Math.sin(a) * V.spacing * i, a,
      hp: V.hp, maxHp: V.hp, length: V.length, width: V.width, speed: V.speed, fireCd: 0,
      target: end, holdingId: to.id, sighted: false,
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
    const dx = s.target.x - s.x, dy = s.target.y - s.y, d = Math.hypot(dx, dy);
    if (d < 120) {
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
