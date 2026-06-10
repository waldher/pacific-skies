// Vector plane sprites and small shape helpers.
import { ctx, w2s } from './canvas.js';
import { TAU } from './util.js';

// rounded rect, filled with the current fillStyle
export function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath(); ctx.fill();
}

export function drawStar(cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + i * TAU / 5;
    const b = a + TAU / 10;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.lineTo(cx + Math.cos(b) * r * 0.45, cy + Math.sin(b) * r * 0.45);
  }
  ctx.closePath(); ctx.fill();
}

// drawn nose-up; caller rotates
function drawPlane(kind, flash) {
  const us = kind === 'us';
  const body = flash ? '#ffffff' : (us ? '#33597d' : '#d8d4bd');
  const wing = flash ? '#ffffff' : (us ? '#2b4d6e' : '#c9c5ac');
  const dark = us ? '#1f3a55' : '#a8a48c';

  // tailplane
  ctx.fillStyle = wing;
  rr(-10, 12, 20, 6, 3);
  // wings
  rr(-24, -4, 48, 11, 5);
  // fuselage
  ctx.fillStyle = body;
  rr(-5.5, -19, 11, 36, 5);
  // fin
  ctx.fillStyle = dark;
  rr(-2, 10, 4, 8, 2);
  // canopy
  ctx.fillStyle = flash ? '#ffffff' : '#8fd4e8';
  rr(-3, -7, 6, 9, 3);
  // markings
  if (us) {
    ctx.fillStyle = '#1f3a55';
    ctx.beginPath(); ctx.arc(-16, 1.5, 5.4, 0, TAU); ctx.arc(16, 1.5, 5.4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    drawStar(-16, 1.5, 4); drawStar(16, 1.5, 4);
  } else {
    ctx.fillStyle = '#c43a2f';
    ctx.beginPath(); ctx.arc(-16, 1.5, 4.6, 0, TAU); ctx.arc(16, 1.5, 4.6, 0, TAU); ctx.fill();
    // cowl band
    ctx.fillStyle = '#3a3a3a';
    rr(-5.5, -19, 11, 5, 4);
  }
  // prop disc
  ctx.fillStyle = 'rgba(200,200,200,0.25)';
  ctx.beginPath(); ctx.ellipse(0, -19, 9, 2.5, 0, 0, TAU); ctx.fill();
}

export function drawPlaneAt(x, y, a, kind, flash) {
  const [sx, sy] = w2s(x, y);
  // drop shadow on the sea
  ctx.save();
  ctx.translate(sx + 10, sy + 16);
  ctx.rotate(a + Math.PI / 2);
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#000';
  rr(-24, -4, 48, 11, 5); rr(-5.5, -19, 11, 36, 5);
  ctx.restore();
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(a + Math.PI / 2);
  drawPlane(kind, flash);
  ctx.restore();
}
