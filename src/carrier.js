// Assisted recovery has a real approach, descent, deck stop, repair and launch.
import { CONFIG } from './config.js';
import { clamp, angDiff, lerp } from './util.js';
import { notify } from './campaign.js';

export function carrierAction(game) {
  const p = game.player;
  if (!p || game.mode !== 'play') return { label: '', enabled: false };
  if (p.flight === 'landed') return { label: 'TAKE OFF', enabled: true };
  if (p.flight === 'approach') return { label: 'ABORT', enabled: true };
  if (p.flight !== 'flying') return { label: p.flight === 'landing' ? 'LANDING' : 'LAUNCHING', enabled: false };
  const c = game.ships.find(s => s.kind === 'carrier');
  const distance = Math.hypot(p.x - c.x, p.y - c.y);
  return { label: distance <= CONFIG.carrier.callRadius ? 'LAND' : 'CARRIER', enabled: true, inRange: distance <= CONFIG.carrier.callRadius };
}

export function requestCarrier(game) {
  const p = game.player, C = CONFIG.carrier;
  if (!p || game.mode !== 'play') return;
  const c = game.ships.find(s => s.kind === 'carrier');
  if (p.flight === 'landed') {
    p.flight = 'takeoff'; p.flightTime = 0;
    p.departure = { x: p.x, y: p.y };
    notify(game, 'Launching — good hunting');
  } else if (p.flight === 'approach') {
    p.flight = 'flying'; p.approach = null;
    notify(game, 'Approach cancelled');
  } else if (p.flight === 'flying') {
    game.target = 'carrier';
    if (Math.hypot(p.x - c.x, p.y - c.y) > C.callRadius) {
      notify(game, 'Carrier marked — get closer to land'); return;
    }
    p.flight = 'approach';
    p.approach = { x: c.x, y: c.y + C.approachDistance };
    notify(game, 'Assisted approach — L or ABORT to cancel');
  }
}

export function updateCarrierFlight(game, dt) {
  const p = game.player, C = CONFIG.carrier;
  if (p.flight === 'flying') return false;
  const c = game.ships.find(s => s.kind === 'carrier');
  p.heat = Math.max(0, p.heat - CONFIG.player.heatCoolRate * dt);
  if (p.heat <= CONFIG.player.heatRecoverAt) p.overheated = false;
  p.hitFlash = Math.max(0, p.hitFlash - dt);
  if (p.flight === 'approach') {
    const dx = p.approach.x - p.x, dy = p.approach.y - p.y;
    const dist = Math.hypot(dx, dy);
    p.a += clamp(angDiff(p.a, Math.atan2(dy, dx)), -CONFIG.player.turnRate * dt, CONFIG.player.turnRate * dt);
    p.speed = lerp(p.speed, C.approachSpeed, 1 - Math.exp(-4 * dt));
    p.x += Math.cos(p.a) * p.speed * dt; p.y += Math.sin(p.a) * p.speed * dt;
    if (dist < C.approachTolerance) {
      p.flight = 'landing'; p.flightTime = 0;
      // A curved final approach turns onto the deck rather than teleporting.
      p.arrival = { x: p.x, y: p.y, a: p.a };
      notify(game, 'Final approach — guns safe');
    }
  } else if (p.flight === 'landing') {
    p.flightTime += dt;
    const t = clamp(p.flightTime / C.landingSeconds, 0, 1);
    const u = t * t * (3 - 2 * t);
    p.x = lerp(p.arrival.x, c.x, u);
    p.y = lerp(p.arrival.y, c.y + C.parkOffset, u);
    p.a = p.arrival.a + angDiff(p.arrival.a, c.a) * Math.min(1, t * 3);
    p.altitude = lerp(CONFIG.render.flightHeight, C.deckHeight, u);
    p.speed = C.approachSpeed * (1 - u);
    if (t >= 1) {
      p.flight = 'landed'; p.a = c.a; p.speed = 0;
      notify(game, 'On deck — repairing. L / TAKE OFF to launch');
    }
  } else if (p.flight === 'landed') {
    p.x = c.x; p.y = c.y + C.parkOffset; p.altitude = C.deckHeight; p.speed = 0;
    p.hp = Math.min(CONFIG.player.hp, p.hp + C.repairPerSecond * dt);
    p.heat = 0; p.overheated = false;
  } else if (p.flight === 'takeoff') {
    p.flightTime += dt;
    const t = clamp(p.flightTime / C.takeoffSeconds, 0, 1);
    p.x = c.x; p.y = p.departure.y - C.launchDistance * t * t;
    p.a = c.a; p.altitude = lerp(C.deckHeight, CONFIG.render.flightHeight, t);
    p.speed = CONFIG.player.speedCruise * t;
    if (t >= 1) { p.flight = 'flying'; p.altitude = CONFIG.render.flightHeight; }
  }
  return true;
}
