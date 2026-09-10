// Surface patrols and carrier defensive fire. Ships require explosive ordnance.
import { CONFIG } from './config.js';
import { game } from './state.js';
import { explosion, splash } from './particles.js';
import { notify } from './campaign.js';

export function updateShips(dt) {
  for (const s of game.ships) {
    if (s.active === false) continue;
    if (s.hp <= 0) { s.sinking = (s.sinking || 0) + dt; continue; }
    if (s.team === 'jp') {
      const t = game.territories[s.territory];
      s.angle += CONFIG.ship.speed / s.orbit * dt;
      const x = t?.x ?? s.anchorX, y = t?.y ?? s.anchorY;
      s.x = x + Math.cos(s.angle) * s.orbit; s.y = y + Math.sin(s.angle) * s.orbit;
      s.a = s.angle + Math.PI / 2;
    }
    s.fireCd -= dt;
    let target = s.team === 'jp' ? game.player : game.enemies.filter(e => e.hp > 0)
      .sort((a, b) => Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y))[0];
    const range = s.team === 'jp' ? CONFIG.ship.gunRange : CONFIG.carrier.defenseRange;
    if (!target || target.flight === 'landed' || Math.hypot(target.x - s.x, target.y - s.y) > range) continue;
    s.gunAngle = Math.atan2(target.y - s.y, target.x - s.x);
    if (s.fireCd <= 0) {
      s.fireCd = s.team === 'jp' ? CONFIG.ship.fireCooldown : CONFIG.carrier.fireCooldown;
      const speed = CONFIG.ship.bulletSpeed;
      const rounds = s.team === 'jp' ? game.ebullets : game.bullets;
      rounds.push({ x: s.x, y: s.y, vx: Math.cos(s.gunAngle) * speed, vy: Math.sin(s.gunAngle) * speed,
        life: range / speed, fromShip: true, damage: CONFIG.ship.bulletDamage });
    }
  }
}

// Swept line vs the oriented hull rectangle, avoiding fast tracer tunnelling.
export function hitsShip(b, s) {
  const ca = Math.cos(s.a), sa = Math.sin(s.a);
  const local = (x, y) => [(x - s.x) * ca + (y - s.y) * sa, -(x - s.x) * sa + (y - s.y) * ca];
  const a = local(b.prevX ?? b.x, b.prevY ?? b.y), z = local(b.x, b.y);
  let enter = 0, exit = 1;
  for (let i = 0; i < 2; i++) {
    const half = (i === 0 ? s.length : s.width) / 2;
    const delta = z[i] - a[i];
    if (Math.abs(delta) < 1e-9) { if (Math.abs(a[i]) > half) return false; continue; }
    const t0 = (-half - a[i]) / delta, t1 = (half - a[i]) / delta;
    enter = Math.max(enter, Math.min(t0, t1)); exit = Math.min(exit, Math.max(t0, t1));
    if (enter > exit) return false;
  }
  return true;
}

export function damageShip(s, amount = 1) {
  if (s.team !== 'jp' || s.hp <= 0) return;
  s.hp = Math.max(0, s.hp - amount);
  game.playerMerit = (game.playerMerit || 0) + 1;
  if (s.hp === 0) {
    s.sinking = 0;
    game.score += CONFIG.ship.score;
    explosion(s.x, s.y, true); splash(s.x, s.y);
    notify(game, s.kind === 'carrier' ? 'Enemy carrier sunk · flight deck silenced' : 'Patrol destroyer sunk');
  }
}
