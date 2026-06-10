// Player flight model, firing, damage smoke, and death.
import { CONFIG } from './config.js';
import { game } from './state.js';
import { keys, stick, fireTouch } from './input.js';
import { sfxGun } from './audio.js';
import { explosion } from './particles.js';
import { clamp, lerp, angDiff, rand } from './util.js';

export function updatePlayer(dt) {
  const P = CONFIG.player, player = game.player;

  let turnIn = 0, throttleT = P.speedCruise;
  if (keys['ArrowLeft'] || keys['KeyA']) turnIn -= 1;
  if (keys['ArrowRight'] || keys['KeyD']) turnIn += 1;
  if (keys['ArrowUp'] || keys['KeyW']) throttleT = P.speedBoost;
  if (keys['ArrowDown'] || keys['KeyS']) throttleT = P.speedBrake;

  if (stick.active) {
    const m = Math.hypot(stick.dx, stick.dy);
    if (m > 10) {
      const want = Math.atan2(stick.dy, stick.dx);
      const d = angDiff(player.a, want);
      turnIn = clamp(d * 4, -1, 1);
      throttleT = 170 + clamp(m / 70, 0, 1) * 180;
    }
  }
  player.a += turnIn * P.turnRate * dt;
  player.speed = lerp(player.speed, throttleT, 1 - Math.pow(0.02, dt));
  player.x += Math.cos(player.a) * player.speed * dt;
  player.y += Math.sin(player.a) * player.speed * dt;

  player.fireCd -= dt;
  const firing = keys['Space'] || fireTouch.active;
  if (firing && player.fireCd <= 0) {
    player.fireCd = P.fireCooldown;
    const nx = player.x + Math.cos(player.a) * 22, ny = player.y + Math.sin(player.a) * 22;
    for (const off of P.gunOffsets) {
      game.bullets.push({
        x: nx + Math.cos(player.a + Math.PI / 2) * off,
        y: ny + Math.sin(player.a + Math.PI / 2) * off,
        vx: Math.cos(player.a) * P.bulletSpeed,
        vy: Math.sin(player.a) * P.bulletSpeed,
        life: P.bulletLife,
      });
    }
    sfxGun();
  }

  if (player.hp < P.smokeBelowHp) {
    player.smokeCd -= dt;
    if (player.smokeCd <= 0) {
      player.smokeCd = 0.05;
      game.particles.push({
        x: player.x - Math.cos(player.a) * 16, y: player.y - Math.sin(player.a) * 16,
        vx: rand(-15, 15), vy: rand(-15, 15), life: rand(0.5, 0.9), max: 1, size: rand(3, 6), kind: 'smoke',
      });
    }
  }
  player.hitFlash = Math.max(0, player.hitFlash - dt);
}

export function damagePlayer(amount) {
  if (game.mode !== 'play') return;
  const player = game.player;
  player.hp -= amount;
  player.hitFlash = 0.25;
  game.shake = Math.min(game.shake + 4, 14);
  if (player.hp <= 0) {
    player.hp = 0;
    explosion(player.x, player.y, true);
    game.best = Math.max(game.best, game.score);
    game.mode = 'over';
  }
}
