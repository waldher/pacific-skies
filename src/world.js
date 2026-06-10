// Procedural ocean and islands, derived from hash noise so the
// world is infinite and stable without storing anything.
import { ctx, view, w2s } from './canvas.js';
import { game } from './state.js';
import { hash2, TAU } from './util.js';

export function drawOcean() {
  const { W, H } = view;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#155e8a'); g.addColorStop(1, '#0e4368');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // drifting wave glints
  const cell = 84, cam = game.cam;
  const x0 = Math.floor((cam.x - W / 2) / cell) - 1, x1 = Math.floor((cam.x + W / 2) / cell) + 1;
  const y0 = Math.floor((cam.y - H / 2) / cell) - 1, y1 = Math.floor((cam.y + H / 2) / cell) + 1;
  ctx.lineWidth = 1.5; ctx.lineCap = 'round';
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      const h = hash2(gx, gy);
      if (h < 0.5) continue;
      const ph = (game.time * 0.6 + h * 7) % 1;
      const a = 0.18 * Math.sin(ph * Math.PI);
      if (a <= 0.01) continue;
      const wx = gx * cell + h * 50, wy = gy * cell + hash2(gy, gx) * 50;
      const [sx, sy] = w2s(wx, wy);
      ctx.strokeStyle = `rgba(220,240,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(sx - 9, sy);
      ctx.quadraticCurveTo(sx, sy - 4, sx + 9, sy);
      ctx.stroke();
    }
  }
}

export function drawIslands() {
  const { W, H } = view;
  const cell = 1500, cam = game.cam;
  const x0 = Math.floor((cam.x - W / 2 - 400) / cell), x1 = Math.floor((cam.x + W / 2 + 400) / cell);
  const y0 = Math.floor((cam.y - H / 2 - 400) / cell), y1 = Math.floor((cam.y + H / 2 + 400) / cell);
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      const h = hash2(gx * 3 + 11, gy * 7 + 5);
      if (h > 0.30) continue; // ~30% of cells host an island
      const cx = gx * cell + cell * (0.25 + hash2(gx, gy * 2) * 0.5);
      const cy = gy * cell + cell * (0.25 + hash2(gx * 2, gy) * 0.5);
      const R = 90 + h * 600;
      const [sx, sy] = w2s(cx, cy);
      if (sx < -R - 60 || sx > W + R + 60 || sy < -R - 60 || sy > H + R + 60) continue;

      // shallow water halo, sand, vegetation — irregular 9-point blobs
      const blob = (rad, jit, seed) => {
        ctx.beginPath();
        for (let i = 0; i < 9; i++) {
          const a = i / 9 * TAU;
          const r = rad * (1 - jit + hash2(gx * 9 + i + seed, gy * 9 + i) * jit * 2);
          const px = sx + Math.cos(a) * r, py = sy + Math.sin(a) * r * 0.85;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.fill();
      };
      ctx.fillStyle = 'rgba(120,200,210,0.35)'; blob(R * 1.25, 0.18, 1);
      ctx.fillStyle = '#e3d49b'; blob(R, 0.22, 2);
      ctx.fillStyle = '#4f8a4a'; blob(R * 0.62, 0.3, 3);
      ctx.fillStyle = '#3b6e39';
      for (let i = 0; i < 5; i++) {
        const a = hash2(gx + i * 13, gy + i * 7) * TAU, r = hash2(gy + i, gx + i * 3) * R * 0.45;
        ctx.beginPath();
        ctx.arc(sx + Math.cos(a) * r, sy + Math.sin(a) * r * 0.8, R * 0.09, 0, TAU);
        ctx.fill();
      }
    }
  }
}
