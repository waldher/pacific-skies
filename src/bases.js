import { AIRCRAFT, aircraftUnlocked } from './aircraft-types.js';
import { CONFIG } from './config.js';

export function availableBases(game) {
  return (game.bases || []).filter(base => base.owner === 'us' && base.available !== false &&
    (base.kind !== 'carrier' || game.rank >= 2) &&
    (!base.shipId || game.ships.some(ship => ship.id === base.shipId && ship.hp > 0)));
}

export function canUseAircraft(game, base, aircraft) {
  return Boolean(base && aircraftUnlocked(game, aircraft) && (base.kind === 'airfield' || AIRCRAFT[aircraft].carrierCompatible));
}

export function resolveBase(game, baseId = game.player?.baseId) {
  const base = (game.bases || []).find(b => b.id === baseId);
  if (base?.shipId) {
    const ship = game.ships.find(s => s.id === base.shipId);
    if (ship) { base.x = ship.x; base.y = ship.y; base.a = ship.a; }
  }
  return base;
}

export function selectSortie(game, { baseId, aircraft, loadout }) {
  const p = game.player;
  if (!p || game.mode !== 'play' || p.flight !== 'landed') return false;
  const base = availableBases(game).find(b => b.id === baseId);
  if (!canUseAircraft(game, base, aircraft) || !AIRCRAFT[aircraft]?.loadouts.includes(loadout)) return false;
  resolveBase(game, base.id);
  p.baseId = base.id; p.aircraft = aircraft; p.loadout = loadout;
  p.x = base.x; p.y = base.y; p.a = base.a;
  p.parked = { x: p.x, y: p.y };
  p.parkedOffset = { along: 0, lateral: 0 };
  p.altitude = base.kind === 'carrier' ? CONFIG.carrier.deckHeight : CONFIG.airfield.deckHeight;
  p.speed = 0; p.deckApproach = false; p.landingHint = '';
  return true;
}
