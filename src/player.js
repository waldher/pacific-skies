// Player flight model, deck operations (takeoff/landing/rearm),
// firing, damage smoke, and death.
import { CONFIG } from './config.js';
import { game, setBanner } from './state.js';
import { keys, stick, fireTouch } from './input.js';
import { sfxGun, sfxOverheat, sfxDing } from './audio.js';
import { explosion } from './particles.js';
import { deckFrame, deckPoint, overDeck } from './carrier.js';
import { clamp, lerp, angDiff, rand } from './util.js';

function boostHeld() {
  return keys['ArrowUp'] || keys['KeyW'] ||
    (stick.active && Math.hypot(stick.dx, stick.dy) > 30);
}

// On the deck the plane is a taxiing cart: locked to the deck axis,
// serviced while slow, airborne once the run reaches takeoff speed.
function updateOnDeck(dt) {
  const P = CONFIG.player, C = CONFIG.carrier, player = game.player;

  player.speed = boostHeld()
    ? player.speed + C.deckAccel * dt
    : Math.max(0, player.speed - C.deckBrake * dt);
  player.a = C.a;
  player.x += Math.cos(C.a) * player.speed * dt;
  player.y += Math.sin(C.a) * player.speed * dt;

  // ease onto the centerline and never roll off the bow
  const f = deckFrame(player.x, player.y);
  const along = Math.min(f.along, C.deckLen / 2 - 12);
  const lat = f.lat * Math.pow(0.05, dt);
  [player.x, player.y] = deckPoint(along, lat);

  // deck crew works while the plane is (nearly) stopped
  if (player.speed < 30) {
    player.hp = Math.min(P.hp, player.hp + C.repairRate * dt);
    player.ammo = Math.min(P.ammoMax, player.ammo + P.ammoMax * C.rearmRate * dt);
    if (!player.serviced && player.hp >= P.hp && player.ammo >= P.ammoMax) {
      player.serviced = true;
      setBanner('REARMED — READY TO LAUNCH', 2);
      sfxDing();
    }
  }

  if (player.speed >= C.takeoffSpeed) {
    player.phase = 'air';
    player.airT = 0;
  }
}

function tryLand() {
  const C = CONFIG.carrier, player = game.player;
  if (player.airT < C.minAirTime) return;
  if (player.speed > C.landSpeed) return;
  if (Math.abs(angDiff(player.a, C.a)) > C.landAngle) return;
  if (!overDeck(player.x, player.y, 8)) return;
  player.phase = 'deck';
  player.a = C.a;
  player.serviced = false;
  setBanner('TOUCH DOWN', 1.4);
  sfxDing();
}

export function updatePlayer(dt) {
  const P = CONFIG.player, player = game.player;

  if (player.phase === 'deck') {
    updateOnDeck(dt);
  } else {
    player.airT += dt;
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

    tryLand();
  }

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
  if (firing && player.phase === 'air' && player.fireCd <= 0 &&
      !player.overheated && player.ammo > 0) {
    player.fireCd = P.fireCooldown;
    player.ammo--;
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
