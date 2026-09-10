// Task groups share a route cursor so escorts retain their protective formation.
import { CONFIG } from './config.js';
import { rand, angDiff } from './util.js';

export function createFleets(theater) {
  const ships = [];
  for (const team of ['us', 'jp']) {
    const route = theater.fleetRoutes[team];
    const [x, y] = route[0], a = Math.atan2(route[1][1] - y, route[1][0] - x);
    const fleet = { id: `${team}-taskgroup`, route, leg: 1, x, y, a, activated: team === 'jp' };
    const hp = team === 'us' ? CONFIG.progression.rescueHp : CONFIG.fleet.enemyCarrierHp;
    const carrier = { id: team === 'us' ? 'carrier' : 'enemy-carrier', name: team === 'us' ? 'USS Resolute' : 'Enemy carrier',
      kind: 'carrier', team, active: team === 'jp', x, y, a, hp, maxHp: hp,
      length: CONFIG.carrier.length, width: CONFIG.carrier.width, fireCd: 0,
      launchTimer: rand(CONFIG.strike.firstMin, CONFIG.strike.firstMax), fleet, formationAlong: 0, formationLateral: 0 };
    ships.push(carrier);
    for (const side of [-1, 1]) {
      ships.push({ id: `${team}-escort-${side === -1 ? 'port' : 'starboard'}`, name: 'Destroyer escort',
        kind: 'destroyer', team, active: team === 'jp', x, y, a, hp: CONFIG.ship.hp, maxHp: CONFIG.ship.hp,
        length: CONFIG.ship.length, width: CONFIG.ship.width, fireCd: 0, fleet,
        formationAlong: CONFIG.fleet.escortAhead, formationLateral: side * CONFIG.fleet.escortLateral });
    }
    for (const s of ships.filter(s => s.fleet === fleet)) place(s);
  }
  return ships;
}

function place(s) {
  const f = s.fleet, ca = Math.cos(f.a), sa = Math.sin(f.a);
  s.x = f.x + ca * s.formationAlong - sa * s.formationLateral;
  s.y = f.y + sa * s.formationAlong + ca * s.formationLateral;
  s.a = f.a;
}

export function fleetHoldingForLanding(game, carrier) {
  const p = game.player;
  if (!p || carrier.team !== 'us' || carrier.hp <= 0 || carrier.active === false) return false;
  if (p.baseId === 'fleet-carrier' && p.flight !== 'flying') return true;
  const dx = p.x - carrier.x, dy = p.y - carrier.y;
  const along = dx * Math.cos(carrier.a) + dy * Math.sin(carrier.a);
  const lateral = -dx * Math.sin(carrier.a) + dy * Math.cos(carrier.a);
  return along < carrier.length / 2 && Math.hypot(dx, dy) < CONFIG.fleet.approachHoldDistance
    && Math.abs(lateral) < carrier.width * 2
    && Math.abs(angDiff(p.a, carrier.a)) < CONFIG.fleet.approachHoldAngle;
}

export function updateFleets(game, dt) {
  for (const fleet of new Set(game.ships.map(s => s.fleet).filter(Boolean))) {
    const members = game.ships.filter(s => s.fleet === fleet);
    const carrier = members.find(s => s.kind === 'carrier');
    if (carrier?.active && carrier.hp > 0) fleet.activated = true;
    if (!fleet.activated) continue;
    for (const s of members) if (s.kind !== 'carrier') s.active = true;
    const hold = fleetHoldingForLanding(game, carrier);
    fleet.moving = !hold;
    let remaining = hold ? 0 : CONFIG.fleet.speed * dt;
    let heading = fleet.a;
    // Advance by distance, including leg crossings, independent of frame rate.
    while (remaining > 0 && fleet.route.length > 1) {
      const target = fleet.route[fleet.leg];
      const dx = target[0] - fleet.x, dy = target[1] - fleet.y, distance = Math.hypot(dx, dy);
      if (distance > 0) heading = Math.atan2(dy, dx);
      if (distance > remaining) {
        fleet.x += dx / distance * remaining; fleet.y += dy / distance * remaining; remaining = 0;
      } else {
        fleet.x = target[0]; fleet.y = target[1]; remaining -= distance;
        fleet.leg = (fleet.leg + 1) % fleet.route.length;
        if (distance === 0 && fleet.route.every(p => p[0] === fleet.x && p[1] === fleet.y)) break;
      }
    }
    const turn = CONFIG.fleet.turnRate * dt;
    fleet.a += Math.max(-turn, Math.min(turn, angDiff(fleet.a, heading)));
    for (const s of members) if (s.hp > 0) place(s);
  }
}
