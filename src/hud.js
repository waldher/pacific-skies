// HUD, wave banner, off-screen arrows, touch controls, menus.
import { ctx, view, w2s } from './canvas.js';
import { game } from './state.js';
import { stick, fireTouch, isTouchDevice } from './input.js';
import { rr } from './sprites.js';
import { clamp, TAU } from './util.js';

export function drawHud() {
  const { W, H } = view, player = game.player;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.font = '700 15px "Courier New", monospace';
  ctx.fillStyle = 'rgba(10,30,45,0.55)';
  rr(10, 10, 200, 58, 6);
  ctx.fillStyle = '#f2e8c9';
  ctx.fillText('SCORE ' + game.score, 22, 18);
  ctx.fillText('WAVE  ' + Math.max(1, game.waveNum), 22, 36);
  // health bar
  ctx.fillStyle = '#1c3347'; rr(22, 54, 176, 8, 4);
  ctx.fillStyle = player.hp > 35 ? '#7fc36b' : '#d8554a';
  if (player.hp > 0) rr(22, 54, 176 * (player.hp / 100), 8, 4);

  // wave banner
  if (game.waveBanner > 0) {
    const a = Math.min(1, game.waveBanner / 0.4, (2.2 - game.waveBanner) / 0.3);
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.textAlign = 'center';
    ctx.font = '700 34px "Courier New", monospace';
    ctx.fillStyle = '#f2e8c9';
    ctx.fillText('— WAVE ' + game.waveNum + ' —', W / 2, H * 0.22);
    ctx.globalAlpha = 1;
  }

  // off-screen enemy arrows
  ctx.fillStyle = 'rgba(255,120,90,0.9)';
  for (const e of game.enemies) {
    const [sx, sy] = w2s(e.x, e.y);
    if (sx > -10 && sx < W + 10 && sy > -10 && sy < H + 10) continue;
    const dx = sx - W / 2, dy = sy - H / 2;
    const m = 26;
    const t = Math.min(
      Math.abs((dx > 0 ? W - m - W / 2 : m - W / 2) / (dx || 1e-6)),
      Math.abs((dy > 0 ? H - m - H / 2 : m - H / 2) / (dy || 1e-6))
    );
    const px = W / 2 + dx * t, py = H / 2 + dy * t, a = Math.atan2(dy, dx);
    ctx.save(); ctx.translate(px, py); ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -6); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // touch controls
  if (isTouchDevice) {
    if (stick.active) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(stick.ax, stick.ay, 56, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath(); ctx.arc(stick.ax + stick.dx, stick.ay + stick.dy, 24, 0, TAU); ctx.fill();
    }
    const fx = W - 74, fy = H - 84;
    ctx.fillStyle = fireTouch.active ? 'rgba(216,85,74,0.75)' : 'rgba(216,85,74,0.4)';
    ctx.beginPath(); ctx.arc(fx, fy, 44, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 14px "Courier New", monospace';
    ctx.fillText('FIRE', fx, fy);
  }
}

function drawCenterText(lines) {
  const { W, H } = view;
  ctx.fillStyle = 'rgba(8,24,38,0.62)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f2e8c9';
  let y = H / 2 - lines.length * 16;
  for (const [txt, size] of lines) {
    ctx.font = `700 ${size}px "Courier New", monospace`;
    ctx.fillText(txt, W / 2, y);
    y += size * 1.7;
  }
}

export function drawMenus() {
  if (game.mode === 'title') {
    drawCenterText([
      ['PACIFIC SKIES', 42],
      ['· 1942 ·', 18],
      ['', 8],
      [isTouchDevice ? 'LEFT THUMB STEERS — RIGHT THUMB FIRES' : 'WASD / ARROWS TO FLY — SPACE TO FIRE', 14],
      ['', 8],
      [isTouchDevice ? 'TAP TO SCRAMBLE' : 'PRESS SPACE TO SCRAMBLE', 16],
    ]);
  } else if (game.mode === 'over') {
    drawCenterText([
      ['SHOT DOWN', 38],
      ['', 6],
      ['SCORE ' + game.score + '   ·   BEST ' + game.best, 18],
      ['WAVE ' + game.waveNum, 14],
      ['', 8],
      [isTouchDevice ? 'TAP TO FLY AGAIN' : 'PRESS SPACE TO FLY AGAIN', 15],
    ]);
  }
}
