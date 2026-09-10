// Fly the approach yourself; an aligned stern crossing catches the arresting wire.
import { CONFIG } from './config.js';
import { clamp, angDiff, lerp } from './util.js';
import { notify } from './campaign.js';
import { availableBases, canUseAircraft, resolveBase } from './bases.js';

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
  const c = resolveBase(game);
  if (!c) { p.flight = 'flying'; p.altitude = CONFIG.render.flightHeight; return false; }
  const groundHeight = c.kind === 'carrier' ? C.deckHeight : CONFIG.airfield.deckHeight;
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
    p.altitude = groundHeight;
    p.speed = p.arrival.speed * (1 - u);
    if (t >= 1) {
      p.parked = { x: p.x, y: p.y };
      p.parkedOffset = {
        along: (p.x - c.x) * Math.cos(c.a) + (p.y - c.y) * Math.sin(c.a),
        lateral: -(p.x - c.x) * Math.sin(c.a) + (p.y - c.y) * Math.cos(c.a),
      };
      p.rearmTime = 0;
      p.torpedoAmmo = CONFIG.torpedo.capacity; p.bombAmmo = CONFIG.bomb.capacity;
      p.torpedoCd = 0; p.bombCd = 0;
      p.flight = 'landed'; p.a = c.a; p.speed = 0;
      notify(game, 'Landed — rearmed and repairing');
    }
  } else if (p.flight === 'landed') {
    if (p.parkedOffset) {
      p.parked = {
        x: c.x + Math.cos(c.a) * p.parkedOffset.along - Math.sin(c.a) * p.parkedOffset.lateral,
        y: c.y + Math.sin(c.a) * p.parkedOffset.along + Math.cos(c.a) * p.parkedOffset.lateral,
      };
    }
    p.x = p.parked.x; p.y = p.parked.y; p.a = c.a; p.altitude = groundHeight; p.speed = 0;
    p.hp = Math.min(CONFIG.player.hp, p.hp + C.repairPerSecond * dt);
    p.heat = 0; p.overheated = false;
    p.rearmTime = (p.rearmTime || 0) + dt;
    p.torpedoAmmo = CONFIG.torpedo.capacity;
    p.bombAmmo = CONFIG.bomb.capacity;
  } else if (p.flight === 'takeoff') {
    p.flightTime += dt;
    const t = clamp(p.flightTime / C.takeoffSeconds, 0, 1);
    p.x = p.departure.x + Math.cos(c.a) * C.launchDistance * t * t;
    p.y = p.departure.y + Math.sin(c.a) * C.launchDistance * t * t;
    p.a = c.a; p.altitude = lerp(groundHeight, CONFIG.render.flightHeight, t);
    p.speed = (CONFIG.aircraft?.[p.aircraft]?.speedCruise ?? CONFIG.player.speedCruise) * t;
    if (t >= 1) { p.flight = 'flying'; p.altitude = CONFIG.render.flightHeight; }
  }
  return true;
}

export function checkDeckLanding(game, previous) {
  const p = game.player, C = CONFIG.carrier;
  if (p.flight !== 'flying') return;
  p.altitude = CONFIG.render.flightHeight; p.landingHint = '';
  for (const candidate of availableBases(game)) {
    if (!canUseAircraft(game, candidate, p.aircraft || 'corsair')) continue;
    const c = resolveBase(game, candidate.id);
    const groundHeight = c.kind === 'carrier' ? C.deckHeight : CONFIG.airfield.deckHeight;
    const ca = Math.cos(c.a), sa = Math.sin(c.a);
    const along = q => (q.x - c.x) * ca + (q.y - c.y) * sa;
    const lateral = q => -(q.x - c.x) * sa + (q.y - c.y) * ca;
    const tolerance = c.kind === 'airfield' ? Math.max(C.lateralTolerance, c.width / 2) : C.lateralTolerance;
    const stern = -c.length / 2, now = along(p), before = along(previous);
    const aligned = Math.abs(angDiff(p.a, c.a)) <= C.headingTolerance;
    const distance = stern - now;
    const inCorridor = aligned && Math.abs(lateral(p)) <= tolerance && distance >= 0 && distance < C.descentDistance;
    if (inCorridor) p.altitude = lerp(groundHeight, CONFIG.render.flightHeight, distance / C.descentDistance);
    if (before < stern && now >= stern && now > before) p.deckApproach = c.id;
    if (p.deckApproach === c.id && (now < stern || now > stern + C.catchWindow || Math.abs(lateral(p)) > c.width)) p.deckApproach = false;
    if (distance > -C.catchWindow && distance < C.descentDistance && Math.abs(lateral(p)) < c.width * 2)
      p.landingHint = aligned && Math.abs(lateral(p)) <= tolerance ? 'ALIGNED — hold your heading' : `Line up with ${c.kind === 'carrier' ? 'the deck, toward the bow' : 'the runway arrow'}`;
    if (p.deckApproach !== c.id || !aligned || Math.abs(lateral(p)) > tolerance) continue;
    p.baseId = c.id; p.deckApproach = false; p.landingHint = '';
    p.flight = 'landing'; p.flightTime = 0;
    p.arrival = { x: p.x, y: p.y, a: p.a, speed: p.speed };
    p.altitude = groundHeight;
    notify(game, c.kind === 'carrier' ? 'Wire caught — landing' : 'Runway reached — landing');
    return;
  }
}
