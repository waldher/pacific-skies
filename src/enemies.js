// Wave spawning and enemy AI: pursue with wobble, fire when
// aligned, deal ram damage up close.
import { CONFIG } from './config.js';
import { game } from './state.js';
import { damagePlayer } from './player.js';
import { explosion } from './particles.js';
import { clamp, angDiff, rand, TAU } from './util.js';

export function spawnWave() {
  const E = CONFIG.enemy, player = game.player;
  game.waveNum++;
  game.waveBanner = 2.2;
  const n = CONFIG.waves.baseCount + CONFIG.waves.perWave * game.waveNum;
  for (let i = 0; i < n; i++) {
    const ace = game.waveNum >= E.aceFromWave && i % E.aceEvery === E.aceEvery - 1;
    const a = rand(0, TAU), d = rand(E.spawnDistMin, E.spawnDistMax);
    game.enemies.push({
      x: player.x + Math.cos(a) * d,
      y: player.y + Math.sin(a) * d,
      a: a + Math.PI,
      speed: ace ? E.ace.speed : E.speed,
      turn: ace ? E.ace.turn : E.turn,
      hp: ace ? E.ace.hp : E.hp,
      ace,
      fireCd: rand(0.5, 1.6),
      wobble: rand(0, TAU),
    });
  }
}

export function updateEnemies(dt) {
  const E = CONFIG.enemy, player = game.player;
  for (const e of game.enemies) {
    e.wobble += dt * 2;
    const tx = player.x + Math.cos(e.wobble) * 60;
    const ty = player.y + Math.sin(e.wobble * 1.3) * 60;
    const want = Math.atan2(ty - e.y, tx - e.x);
    const d = angDiff(e.a, want);
    e.a += clamp(d, -e.turn * dt, e.turn * dt);
    e.x += Math.cos(e.a) * e.speed * dt;
    e.y += Math.sin(e.a) * e.speed * dt;

    e.fireCd -= dt;
    const dist = Math.hypot(player.x - e.x, player.y - e.y);
    if (e.fireCd <= 0 && dist < E.engageDist && Math.abs(d) < E.aimCone) {
      e.fireCd = e.ace ? E.ace.fireCooldown : E.fireCooldown;
      game.ebullets.push({
        x: e.x + Math.cos(e.a) * 20, y: e.y + Math.sin(e.a) * 20,
        vx: Math.cos(e.a) * E.bulletSpeed, vy: Math.sin(e.a) * E.bulletSpeed,
        life: E.bulletLife,
      });
    }
    if (dist < E.ramDist) {
      e.hp = 0;
      damagePlayer(E.ramDamage);
      explosion(e.x, e.y, false);
    }
  }
}
