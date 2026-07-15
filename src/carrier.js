// Friendly carrier: deck geometry, defensive flak, drawing.
import { CONFIG } from './config.js';
import { game } from './state.js';
import { ctx, view, w2s } from './canvas.js';
import { angDiff } from './util.js';

// world position of a point given in deck coordinates (along, lateral)
export function deckPoint(along, lat) {
  const C = CONFIG.carrier;
  const ca = Math.cos(C.a), sa = Math.sin(C.a);
  return [C.x + ca * along - sa * lat, C.y + sa * along + ca * lat];
}

// a world position expressed in deck coordinates
export function deckFrame(x, y) {
  const C = CONFIG.carrier;
  const dx = x - C.x, dy = y - C.y;
  const ca = Math.cos(C.a), sa = Math.sin(C.a);
  return { along: dx * ca + dy * sa, lat: -dx * sa + dy * ca };
}

export function overDeck(x, y, margin = 0) {
  const C = CONFIG.carrier, f = deckFrame(x, y);
  return Math.abs(f.along) < C.deckLen / 2 - margin && Math.abs(f.lat) < C.deckWid / 2 - 4;
}

// Flak guns pick the nearest plane in range and fire friendly bullets,
// so the deck is a defended place to land, not a free kill for raiders.
export function updateCarrier(dt) {
  const C = CONFIG.carrier;
  C.guns.forEach((g, i) => {
    game.carrier.fireCds[i] -= dt;
    if (game.carrier.fireCds[i] > 0) return;
    const [gx, gy] = deckPoint(g[0], g[1]);
    let best = null, bd = C.flakRange;
    for (const e of game.enemies) {
      const d = Math.hypot(e.x - gx, e.y - gy);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) return;
    game.carrier.fireCds[i] = C.flakCooldown;
    const t = bd / C.flakBulletSpeed; // simple lead on current velocity
    const a = Math.atan2(
      best.y + Math.sin(best.a) * best.speed * t - gy,
      best.x + Math.cos(best.a) * best.speed * t - gx
    );
    game.bullets.push({
      x: gx, y: gy,
      vx: Math.cos(a) * C.flakBulletSpeed,
      vy: Math.sin(a) * C.flakBulletSpeed,
      life: C.flakBulletLife,
    });
  });
}

export function drawCarrier() {
  const C = CONFIG.carrier;
  const [sx, sy] = w2s(C.x, C.y);
  const L = C.deckLen, W = C.deckWid;
  if (sx < -L || sx > view.W + L || sy < -L || sy > view.H + L) return;

  const rrp = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath(); ctx.fill();
  };

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(C.a + Math.PI / 2); // draw bow-up, like the plane sprites

  // wake foam halo
  ctx.fillStyle = 'rgba(150,215,225,0.28)';
  rrp(-W / 2 - 14, -L / 2 - 26, W + 28, L + 52, 30);
  // hull
  ctx.fillStyle = '#3d4750';
  rrp(-W / 2 - 5, -L / 2 - 16, W + 10, L + 32, 16);
  // flight deck
  ctx.fillStyle = '#69737e';
  rrp(-W / 2, -L / 2, W, L, 9);
  // deck border
  ctx.fillStyle = '#59636e';
  rrp(-W / 2, -L / 2, W, 6, 3); rrp(-W / 2, L / 2 - 6, W, 6, 3);
  // dashed centerline
  ctx.fillStyle = '#dfe6ec';
  for (let y = -L / 2 + 16; y < L / 2 - 18; y += 30) rrp(-2, y, 4, 15, 2);
  // arrestor stripes near the stern
  ctx.fillStyle = 'rgba(240,235,210,0.55)';
  for (let i = 0; i < 3; i++) rrp(-W / 2 + 6, L / 2 - 26 - i * 12, W - 12, 3, 1);
  // island superstructure (starboard)
  ctx.fillStyle = '#2e363e';
  rrp(W / 2 - 4, -34, 13, 54, 3);
  ctx.fillStyle = '#8fd4e8';
  rrp(W / 2 - 2, -28, 8, 6, 2);
  // flak mounts
  ctx.fillStyle = '#252c33';
  for (const [along, lat] of C.guns) {
    ctx.beginPath(); ctx.arc(lat, along, 5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // landing guide: dashed approach line off the stern while the player
  // is nearby and airborne; green once speed and alignment would stick.
  const p = game.player;
  if (p && p.phase === 'air' && game.mode === 'play') {
    const d = Math.hypot(p.x - C.x, p.y - C.y);
    if (d < 900) {
      const ok = p.speed <= C.landSpeed && Math.abs(angDiff(p.a, C.a)) < C.landAngle;
      const [ax, ay] = deckPoint(-L / 2, 0);
      const [bx, by] = deckPoint(-L / 2 - 280, 0);
      const [asx, asy] = w2s(ax, ay), [bsx, bsy] = w2s(bx, by);
      ctx.save();
      ctx.setLineDash([10, 12]);
      ctx.lineDashOffset = -game.time * 40;
      ctx.strokeStyle = ok ? 'rgba(140,230,140,0.8)' : 'rgba(240,240,240,0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(bsx, bsy); ctx.lineTo(asx, asy); ctx.stroke();
      ctx.restore();
    }
  }
}
