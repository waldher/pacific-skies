// Strike groups come from living flight decks and airfields, not the map edge.
import { CONFIG } from './config.js';
import { rand, clamp, angDiff } from './util.js';
import { explosion } from './particles.js';

function baseAsset(game, base) {
  if (base.kind === 'carrier') return base.ship ?? game.ships.find(s => s.id === base.shipId) ?? game.ships[0];
  return base.airfield ?? game.airfields.find(f => f.id === (base.airfieldId ?? base.id)) ?? base;
}

function targetBase(game) {
  const carrier = game.bases.find(b => b.kind === 'carrier' && b.owner !== 'enemy'
    && baseAsset(game, b).active === true && baseAsset(game, b).hp > 0);
  if (carrier) return carrier;
  const living = game.bases.filter(b => b.owner !== 'enemy' && b.available !== false
    && baseAsset(game, b).hp > 0 && baseAsset(game, b).active !== false);
  return living.find(b => b.kind === 'carrier') ?? living[0];
}

export function updateStrikes(game, dt) {
  const S = CONFIG.strike, target = targetBase(game);
  const parked = game.player.flight === 'landed' && game.bases.find(b =>
    b.id === game.player.baseId && b.kind === 'airfield' && b.owner === 'us' && b.available !== false);
  if (parked) {
    const field = baseAsset(game, parked);
    if (field.hp > 0) field.hp = Math.min(field.maxHp, field.hp + S.baseRepairPerSecond * dt);
  }
  const sources = [...game.airfields.filter(f => f.owner === 'enemy' && f.hp > 0),
    ...game.ships.filter(s => s.team === 'jp' && s.kind === 'carrier' && s.hp > 0 && s.active !== false)];
  // Queued launches retain their overdue time, so a distant carrier cannot
  // be starved indefinitely by airfields earlier in the source array.
  for (const source of sources) source.launchTimer = (source.launchTimer ?? rand(S.intervalMin, S.intervalMax)) - dt;
  sources.sort((a, b) => a.launchTimer - b.launchTimer);
  let active = game.enemies.filter(e => e.strike && e.hp > 0).length;
  for (const source of sources) {
    if (source.launchTimer > 0 || !target || active >= S.maxActive) continue;
    source.launchTimer = rand(S.intervalMin, S.intervalMax);
    const asset = baseAsset(game, target), a = Math.atan2(asset.y - source.y, asset.x - source.x);
    for (let i = 0; i < S.groupSize && active < S.maxActive; i++, active++) {
      const offset = (i - (S.groupSize - 1) / 2) * S.formationSpacing;
      game.enemies.push({ x: source.x - Math.sin(a) * offset, y: source.y + Math.cos(a) * offset,
        a, hp: S.hp, speed: S.speed, turn: S.turn, ace: false, fireCd: 0, wobble: 0,
        strike: true, sourceId: source.id, targetBaseId: target.id, phase: 'attack', retreatDistance: 0 });
    }
  }
  for (const e of game.enemies) {
    if (!e.strike || e.hp <= 0) continue;
    e.phase ??= 'attack';
    const base = game.bases.find(b => b.id === e.targetBaseId);
    const asset = base && baseAsset(game, base);
    if (!asset || asset.hp <= 0 || asset.active === false || base.owner === 'enemy') e.phase = 'retreat';
    if (e.phase === 'attack') {
      const want = Math.atan2(asset.y - e.y, asset.x - e.x);
      e.a += clamp(angDiff(e.a, want), -e.turn * dt, e.turn * dt);
      if (Math.hypot(asset.x - e.x, asset.y - e.y) <= S.attackRange) {
        asset.hp = Math.max(0, asset.hp - S.baseDamage);
        explosion(asset.x, asset.y, true);
        e.phase = 'retreat';
      }
    } else {
      e.retreatDistance = (e.retreatDistance || 0) + e.speed * dt;
      if (e.retreatDistance > S.retreatDistance) e.departed = true;
    }
    e.x += Math.cos(e.a) * e.speed * dt; e.y += Math.sin(e.a) * e.speed * dt;
  }
  game.enemies = game.enemies.filter(e => !e.departed);
}
