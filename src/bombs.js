// Bombs retain forward motion while falling; their shadow marks the impact path.
import { onHull, onLand } from './surface.js';
import { CONFIG } from './config.js';
import { damageShip } from './ships.js';
import { explosion, splash } from './particles.js';
import { notify } from './campaign.js';

export function launchBomb(game) {
  const p = game.player, B = CONFIG.bomb, A = CONFIG.aircraft[p?.aircraft] || {};
  if (game.mode !== 'play' || p.flight !== 'flying' || p.loadout !== 'bombs'
    || p.bombCd > 0 || !(p.bombAmmo > 0)) return false;
  p.bombAmmo--; p.bombCd = B.cooldown;
  const drift = A.bombDriftSpeed ?? B.driftSpeed, fall = A.bombFallSeconds ?? B.fallSeconds;
  game.bombs.push({ x: p.x, y: p.y, vx: Math.cos(p.a) * drift,
    vy: Math.sin(p.a) * drift, life: fall, maxLife: fall, damage: A.bombDamage ?? B.damage, blastRadius: A.bombBlastRadius ?? B.blastRadius });
  return true;
}

export function updateBombs(game, dt) {
  const B = CONFIG.bomb;
  game.player.bombCd = Math.max(0, (game.player.bombCd || 0) - dt);
  for (const b of game.bombs) {
    const step = Math.min(dt, b.life);
    b.x += b.vx * step; b.y += b.vy * step; b.life -= dt;
    if (b.life > 0) continue;
    let hit = false;
    const land = onLand(b, game.territories), damage = b.damage ?? B.damage;
    for (const f of game.airfields) {
      if (!land || f.owner !== 'enemy' || f.hp <= 0 || Math.hypot(f.x - b.x, f.y - b.y) > (b.blastRadius ?? B.blastRadius)) continue;
      f.hp = Math.max(0, f.hp - damage); hit = true;
      if (f.hp === 0) {
        game.score += B.airfieldScore;
        notify(game, 'Enemy airfield disabled · launches stopped');
      }
    }
    for (const s of game.ships) {
      if (s.hp <= 0 || s.active === false || !onHull(b, s)) continue;
      if (s.team === 'jp') damageShip(s, damage);
      hit = true; break;
    }
    if (hit || land) explosion(b.x, b.y, true);
    else splash(b.x, b.y);
  }
  game.bombs = game.bombs.filter(b => b.life > 0);
}
