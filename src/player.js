// Player flight model, firing, damage smoke, and death.
import { updateCarrierFlight, checkDeckLanding } from './carrier.js';
import { CONFIG } from './config.js';
import { game, recoveryBases } from './state.js';
import { saveCampaign } from './persistence.js';
import { keys, stick, fireTouch } from './input.js';
import { sfxGun, sfxOverheat } from './audio.js';
import { explosion } from './particles.js';
import { clamp, lerp, angDiff, rand } from './util.js';

export function updatePlayer(dt) {
  const player = game.player, P = { ...CONFIG.player, ...CONFIG.aircraft[player.aircraft] };
  if (updateCarrierFlight(game, dt)) return;

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
      throttleT = lerp(P.speedBrake, P.speedBoost, clamp(m / 70, 0, 1));
    }
  }
  // Cruise: full boost with nothing hostile in reach opens the throttle past
  // combat speed. Contact or gunfire cancels it, so fights stay at fighting speed.
  const C = CONFIG.cruise, boosting = throttleT >= P.speedBoost - 1;
  const near = (x, y) => Math.hypot(x - player.x, y - player.y) < C.clearRadius;
  const contact = (keys['Space'] || fireTouch.active) || game.enemies.some(e => e.hp > 0 && near(e.x, e.y))
    || game.ships.some(s => s.team === 'jp' && s.hp > 0 && s.active !== false && near(s.x, s.y))
    || (game.convoys || []).some(s => s.hp > 0 && near(s.x, s.y));
  player.cruiseSpool = boosting && !contact && player.flight === 'flying' ? (player.cruiseSpool || 0) + dt : 0;
  const rate = (C.multiplier - 1) / C.rampSeconds * dt;
  player.cruiseFactor = clamp((player.cruiseFactor || 1) + (player.cruiseSpool >= C.spoolSeconds ? rate : -2 * rate), 1, C.multiplier);
  if (boosting) throttleT *= player.cruiseFactor;
  const previous = { x: player.x, y: player.y };
  player.a += turnIn * P.turnRate * dt;
  player.speed = lerp(player.speed, throttleT, 1 - Math.pow(0.02, dt));
  player.x += Math.cos(player.a) * player.speed * dt;
  player.y += Math.sin(player.a) * player.speed * dt;

  checkDeckLanding(game, previous);
  if (player.flight !== 'flying') return;

  player.fireCd -= dt;
  player.heat = Math.max(0, player.heat - P.heatCoolRate * dt);
  if (player.overheated) {
    if (player.heat <= P.heatRecoverAt) player.overheated = false;
    player.steamCd -= dt;
    if (player.steamCd <= 0) {
      player.steamCd = 0.07;
      const nx = player.x + Math.cos(player.a) * 20, ny = player.y + Math.sin(player.a) * 20;
      game.particles.push({
        x: nx, y: ny, vx: rand(-12, 12), vy: rand(-12, 12),
        life: rand(0.3, 0.5), max: 0.6, size: rand(2, 4), kind: 'smoke',
      });
    }
  }
  const firing = keys['Space'] || fireTouch.active;
  if (firing && player.fireCd <= 0 && !player.overheated) {
    player.fireCd = P.fireCooldown;
    player.heat += P.heatPerShot;
    if (player.heat >= 1) {
      player.heat = 1;
      player.overheated = true;
      sfxOverheat();
    }
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
  if (game.mode !== 'play' || game.player.flight !== 'flying') return;
  const player = game.player;
  player.hp -= amount;
  player.hitFlash = 0.25;
  game.shake = Math.min(game.shake + 4, 14);
  if (player.hp <= 0) {
    player.hp = 0;
    explosion(player.x, player.y, true);
    game.best = Math.max(game.best, game.score);
    game.pilotLosses = (game.pilotLosses || 0) + 1;
    game.mode = recoveryBases().length ? 'recovery' : 'over';
    game.endReason = game.mode === 'over' ? 'All bases lost' : 'Aircraft lost';
    saveCampaign(game);
  }
}
