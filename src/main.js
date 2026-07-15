// Game loop: orchestrates updates, collisions, capture/win logic,
// camera, render order.
import { CONFIG } from './config.js';
import { game, startGame } from './state.js';
import { cvs, ctx, view, w2s } from './canvas.js';
import { keys, stick, fireTouch, initInput } from './input.js';
import { updatePlayer, damagePlayer } from './player.js';
import { updateEnemies } from './enemies.js';
import { updateCarrier, drawCarrier } from './carrier.js';
import { updateIslands, drawKeyIslands, captureIsland } from './islands.js';
import { explosion, updateParticles, drawParticles } from './particles.js';
import { drawOcean, drawIslands } from './world.js';
import { drawPlaneAt } from './sprites.js';
import { drawHud, drawMenus } from './hud.js';
import { lerp, angDiff, rand, setSeed } from './util.js';

initInput(cvs);

function update(dt) {
  game.time += dt;
  if (game.mode !== 'play') return;
  game.runTime += dt;

  updatePlayer(dt);
  updateEnemies(dt);
  updateCarrier(dt);
  updateIslands(dt);

  // bullets
  for (const b of game.bullets) { b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; }
  for (const b of game.ebullets) { b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; }

  for (const b of game.bullets) {
    if (b.life <= 0) continue;
    for (const e of game.enemies) {
      if (e.hp <= 0) continue;
      if (Math.hypot(b.x - e.x, b.y - e.y) < 18) {
        b.life = 0; e.hp--;
        game.particles.push({ x: b.x, y: b.y, vx: rand(-40, 40), vy: rand(-40, 40), life: 0.2, max: 0.2, size: 3, kind: 'fire' });
        if (e.hp <= 0) {
          game.score += e.ace ? CONFIG.score.aceKill : CONFIG.score.kill;
          explosion(e.x, e.y, false);
        }
        break;
      }
    }
    if (b.life <= 0) continue;
    // strafing island defenses
    for (const isl of game.islands) {
      if (isl.owner !== 'enemy') continue;
      if (Math.hypot(b.x - isl.x, b.y - isl.y) > isl.r + 80) continue;
      for (const s of isl.structures) {
        if (s.hp <= 0) continue;
        const sx = isl.x + s.dx, sy = isl.y + s.dy;
        if (Math.hypot(b.x - sx, b.y - sy) < 16) {
          b.life = 0; s.hp--;
          game.particles.push({ x: b.x, y: b.y, vx: rand(-40, 40), vy: rand(-40, 40), life: 0.2, max: 0.2, size: 3, kind: 'fire' });
          if (s.hp <= 0) {
            game.score += CONFIG.score.structure;
            explosion(sx, sy, false);
            if (isl.structures.every(q => q.hp <= 0)) captureIsland(isl);
          }
          break;
        }
      }
      if (b.life <= 0) break;
    }
  }
  for (const b of game.ebullets) {
    if (b.life <= 0) continue;
    if (game.player.phase === 'air' && Math.hypot(b.x - game.player.x, b.y - game.player.y) < 15) {
      b.life = 0;
      damagePlayer(b.dmg || CONFIG.enemy.bulletDamage);
    }
  }

  game.bullets = game.bullets.filter(b => b.life > 0);
  game.ebullets = game.ebullets.filter(b => b.life > 0);
  game.enemies = game.enemies.filter(e => e.hp > 0);

  updateParticles(dt);

  game.banner.t = Math.max(0, game.banner.t - dt);

  // victory: the whole front line flies your flag
  if (game.mode === 'play' && game.islands.every(i => i.owner === 'player')) {
    game.score += CONFIG.score.win;
    game.best = Math.max(game.best, game.score);
    game.mode = 'win';
  }

  // camera: lead slightly ahead of the nose
  const lead = CONFIG.camera.lead, player = game.player;
  game.cam.x = lerp(game.cam.x, player.x + Math.cos(player.a) * lead, 1 - Math.pow(0.005, dt));
  game.cam.y = lerp(game.cam.y, player.y + Math.sin(player.a) * lead, 1 - Math.pow(0.005, dt));
  game.shake = Math.max(0, game.shake - 30 * dt);
}

function render() {
  ctx.save();
  if (game.shake > 0) ctx.translate(rand(-game.shake, game.shake) * 0.5, rand(-game.shake, game.shake) * 0.5);

  drawOcean();
  drawIslands();

  if (game.player) {
    drawKeyIslands();
    drawCarrier();

    // bullets under planes
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#ffe28a'; ctx.lineWidth = 3;
    for (const b of game.bullets) {
      const [sx, sy] = w2s(b.x, b.y);
      ctx.beginPath(); ctx.moveTo(sx, sy);
      ctx.lineTo(sx - b.vx * 0.016, sy - b.vy * 0.016); ctx.stroke();
    }
    ctx.strokeStyle = '#ff7b6b'; ctx.lineWidth = 3;
    for (const b of game.ebullets) {
      const [sx, sy] = w2s(b.x, b.y);
      ctx.beginPath(); ctx.moveTo(sx, sy);
      ctx.lineTo(sx - b.vx * 0.018, sy - b.vy * 0.018); ctx.stroke();
    }

    for (const e of game.enemies) drawPlaneAt(e.x, e.y, e.a, 'jp', false);
    if (game.mode === 'play') drawPlaneAt(game.player.x, game.player.y, game.player.a, 'us', game.player.hitFlash > 0.12);

    drawParticles();
    drawHud();
  }
  ctx.restore();

  drawMenus();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug/test API: the playtest harness (and console tinkering) reads
// live state and drives input through this handle.
window.__game = { game, CONFIG, startGame, setSeed, keys, stick, fireTouch, view, angDiff };
