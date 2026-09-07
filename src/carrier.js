// Fly the approach yourself; an aligned stern crossing catches the arresting wire.
import { CONFIG } from './config.js';
import { clamp, angDiff, lerp } from './util.js';
import { notify } from './campaign.js';

export function carrierAction(game) {
  const p = game.player;
  if (!p || game.mode !== 'play') return { label: '', enabled: false };
  if (p.flight === 'landed') return { label: 'TAKE OFF', enabled: true };
  return { label: p.flight === 'landing' ? 'LANDING' : 'LAUNCHING', enabled: false };
}

export function requestCarrier(game) {
  const p = game.player;
  if (!p || game.mode !== 'play') return;
  if (p.flight === 'landed') {
    p.flight = 'takeoff'; p.flightTime = 0;
    p.departure = { x: p.x, y: p.y };
    notify(game, 'Launching — good hunting');
  }
}

export function updateCarrierFlight(game, dt) {
  const p = game.player, C = CONFIG.carrier;
  if (p.flight === 'flying') return false;
  const c = game.ships.find(s => s.kind === 'carrier');
  p.heat = Math.max(0, p.heat - CONFIG.player.heatCoolRate * dt);
  if (p.heat <= CONFIG.player.heatRecoverAt) p.overheated = false;
  p.hitFlash = Math.max(0, p.hitFlash - dt);
  if (p.flight === 'landing') {
    p.flightTime += dt;
    const t = clamp(p.flightTime / C.landingSeconds, 0, 1);
    const u = t * (2 - t);
    p.x = lerp(p.arrival.x, p.arrival.x + Math.cos(c.a) * C.rolloutDistance, u);
    p.y = lerp(p.arrival.y, p.arrival.y + Math.sin(c.a) * C.rolloutDistance, u);
    p.a = p.arrival.a + angDiff(p.arrival.a, c.a) * Math.min(1, t * 3);
    p.altitude = C.deckHeight;
    p.speed = p.arrival.speed * (1 - u);
    if (t >= 1) {
      p.parked = { x: p.x, y: p.y };
      p.flight = 'landed'; p.a = c.a; p.speed = 0;
      notify(game, 'On deck — repairing. L / TAKE OFF to launch');
    }
  } else if (p.flight === 'landed') {
    p.x = p.parked.x; p.y = p.parked.y; p.altitude = C.deckHeight; p.speed = 0;
    p.hp = Math.min(CONFIG.player.hp, p.hp + C.repairPerSecond * dt);
    p.heat = 0; p.overheated = false;
  } else if (p.flight === 'takeoff') {
    p.flightTime += dt;
    const t = clamp(p.flightTime / C.takeoffSeconds, 0, 1);
    p.x = p.departure.x; p.y = p.departure.y - C.launchDistance * t * t;
    p.a = c.a; p.altitude = lerp(C.deckHeight, CONFIG.render.flightHeight, t);
    p.speed = CONFIG.player.speedCruise * t;
    if (t >= 1) { p.flight = 'flying'; p.altitude = CONFIG.render.flightHeight; }
  }
  return true;
}

export function checkDeckLanding(game, previous) {
  const p = game.player, c = game.ships.find(s => s.kind === 'carrier'), C = CONFIG.carrier;
  if (p.flight !== 'flying') return;
  const ca = Math.cos(c.a), sa = Math.sin(c.a);
  const along = q => (q.x - c.x) * ca + (q.y - c.y) * sa;
  const lateral = q => -(q.x - c.x) * sa + (q.y - c.y) * ca;
  const stern = -C.length / 2, now = along(p), before = along(previous);
  const aligned = Math.abs(angDiff(p.a, c.a)) <= C.headingTolerance;
  // A short visual descent follows your own approach; steering is always yours.
  const distance = stern - now;
  const inCorridor = aligned && Math.abs(lateral(p)) <= C.lateralTolerance && distance >= 0 && distance < C.descentDistance;
  p.altitude = inCorridor ? lerp(C.deckHeight, CONFIG.render.flightHeight, distance / C.descentDistance) : CONFIG.render.flightHeight;
  if (!(before < stern && now >= stern && aligned)) return;
  const fraction = (stern - before) / (now - before);
  const cross = lerp(lateral(previous), lateral(p), fraction);
  if (Math.abs(cross) > C.lateralTolerance) return;
  p.flight = 'landing'; p.flightTime = 0;
  p.arrival = { x: p.x, y: p.y, a: p.a, speed: p.speed };
  p.altitude = C.deckHeight;
  notify(game, 'Wire caught — landing');
}
