// Bombs retain forward motion while falling; their shadow marks the impact path.
import { CONFIG } from './config.js';
import { damageShip } from './ships.js';
import { explosion, splash } from './particles.js';
import { notify } from './campaign.js';

export function launchBomb(game) {
  const p = game.player, B = CONFIG.bomb;
  if (game.mode !== 'play' || p.flight !== 'flying' || p.loadout !== 'bombs'
    || p.bombCd > 0 || !(p.bombAmmo > 0)) return false;
  p.bombAmmo--; p.bombCd = B.cooldown;
  game.bombs.push({ x: p.x, y: p.y, vx: Math.cos(p.a) * B.driftSpeed,
    vy: Math.sin(p.a) * B.driftSpeed, life: B.fallSeconds, maxLife: B.fallSeconds });
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
    for (const f of game.airfields) {
      if (f.owner !== 'enemy' || f.hp <= 0 || Math.hypot(f.x - b.x, f.y - b.y) > B.blastRadius) continue;
      f.hp = Math.max(0, f.hp - B.damage); hit = true;
      if (f.hp === 0) {
        game.score += B.airfieldScore;
        notify(game, 'Enemy airfield disabled · launches stopped');
      }
    }
    for (const s of game.ships) {
      if (s.team !== 'jp' || s.hp <= 0 || s.active === false) continue;
      // Distance to the actual hull gives long carriers their full hit area.
      const dx = b.x - s.x, dy = b.y - s.y, ca = Math.cos(s.a), sa = Math.sin(s.a);
      const along = Math.max(0, Math.abs(dx * ca + dy * sa) - s.length / 2);
      const across = Math.max(0, Math.abs(-dx * sa + dy * ca) - s.width / 2);
      if (Math.hypot(along, across) > B.blastRadius) continue;
      damageShip(s, B.damage); hit = true;
    }
    if (hit || game.territories.some(t => Math.hypot(t.x - b.x, t.y - b.y) < t.radius)) explosion(b.x, b.y, true);
    else splash(b.x, b.y);
  }
  game.bombs = game.bombs.filter(b => b.life > 0);
}
