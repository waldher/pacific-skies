// Explosions, smoke, and particle simulation/drawing.
import { game } from './state.js';
import { ctx, w2s } from './canvas.js';
import { rand, TAU } from './util.js';
import { sfxBoom } from './audio.js';

export function explosion(x, y, big) {
  const n = big ? 34 : 20;
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), s = rand(40, big ? 320 : 220);
    game.particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: rand(0.35, big ? 1.0 : 0.7), max: 1,
      size: rand(2, big ? 7 : 5),
      kind: rand(0, 1) < 0.55 ? 'fire' : 'smoke',
    });
  }
  game.particles.push({ x, y, vx: 0, vy: 0, life: 0.3, max: 0.3, size: big ? 46 : 30, kind: 'ring' });
  sfxBoom(big);
  game.shake = Math.min(game.shake + (big ? 10 : 5), 14);
}

export function updateParticles(dt) {
  for (const p of game.particles) {
    p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= Math.pow(0.2, dt); p.vy *= Math.pow(0.2, dt);
  }
  game.particles = game.particles.filter(p => p.life > 0);
  if (game.particles.length > 400) game.particles.splice(0, game.particles.length - 400);
}

export function drawParticles() {
  for (const p of game.particles) {
    const [sx, sy] = w2s(p.x, p.y);
    const t = p.life / p.max;
    if (p.kind === 'ring') {
      ctx.strokeStyle = `rgba(255,220,150,${(t * 0.9).toFixed(3)})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(sx, sy, p.size * (1.6 - t), 0, TAU); ctx.stroke();
    } else {
      ctx.fillStyle = p.kind === 'fire'
        ? `rgba(255,${Math.floor(120 + t * 110)},60,${t.toFixed(3)})`
        : `rgba(90,90,95,${(t * 0.7).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(sx, sy, p.size * (p.kind === 'smoke' ? (2 - t) : t + 0.4), 0, TAU); ctx.fill();
    }
  }
}
