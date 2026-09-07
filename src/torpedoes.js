// Arcade air-dropped torpedoes: straight surface runs, ship-only damage.
import { CONFIG } from './config.js';
import { game } from './state.js';
import { hitsShip, damageShip } from './ships.js';
import { splash } from './particles.js';

export function launchTorpedo() {
  const p = game.player, T = CONFIG.torpedo;
  if (game.mode !== 'play' || p.flight !== 'flying' || p.torpedoCd > 0 || p.torpedoAmmo <= 0) return false;
  p.torpedoCd = T.cooldown; p.torpedoAmmo--;
  game.torpedoes.push({ x: p.x, y: p.y, vx: Math.cos(p.a) * T.speed,
    vy: Math.sin(p.a) * T.speed, distance: 0, life: T.range / T.speed, wakeCd: 0 });
  splash(p.x, p.y);
  return true;
}

export function updateTorpedoes(dt) {
  game.player.torpedoCd = Math.max(0, game.player.torpedoCd - dt);
  for (const t of game.torpedoes) {
    t.prevX = t.x; t.prevY = t.y;
    t.x += t.vx * dt; t.y += t.vy * dt; t.life -= dt;
    t.distance += CONFIG.torpedo.speed * dt;
    t.wakeCd -= dt;
    if (t.wakeCd <= 0) { splash(t.x, t.y); t.wakeCd = .15; }
    if (t.life <= 0) continue;
    if (game.territories.some(i => Math.hypot(t.x - i.x, t.y - i.y) < i.radius * .7)) {
      t.life = 0; splash(t.x, t.y); continue;
    }
    if (t.distance < CONFIG.torpedo.armingDistance) continue;
    for (const s of game.ships) {
      if (s.team !== 'jp' || s.hp <= 0 || !hitsShip(t, s)) continue;
      damageShip(s, CONFIG.torpedo.damage); splash(t.x, t.y); t.life = 0; break;
    }
  }
  game.torpedoes = game.torpedoes.filter(t => t.life > 0);
}
