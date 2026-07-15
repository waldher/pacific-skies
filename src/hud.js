// HUD, banners, off-screen arrows, deck prompts, touch controls, menus.
import { CONFIG } from './config.js';
import { ctx, view, w2s } from './canvas.js';
import { game } from './state.js';
import { stick, fireTouch, isTouchDevice } from './input.js';
import { rr } from './sprites.js';
import { clamp, TAU } from './util.js';

// clamp an off-screen world point to the screen edge; returns
// [x, y, angle] for drawing a pointer, or null if it's on screen
function edgePointer(wx, wy) {
  const { W, H } = view;
  const [sx, sy] = w2s(wx, wy);
  if (sx > -10 && sx < W + 10 && sy > -10 && sy < H + 10) return null;
  const dx = sx - W / 2, dy = sy - H / 2, m = 26;
  const t = Math.min(
    Math.abs((dx > 0 ? W - m - W / 2 : m - W / 2) / (dx || 1e-6)),
    Math.abs((dy > 0 ? H - m - H / 2 : m - H / 2) / (dy || 1e-6))
  );
  return [W / 2 + dx * t, H / 2 + dy * t, Math.atan2(dy, dx)];
}

function centerText(txt, y, size, color, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${size}px "Courier New", monospace`;
  ctx.fillStyle = color;
  ctx.fillText(txt, view.W / 2, y);
  ctx.globalAlpha = 1;
}

export function drawHud() {
  const { W, H } = view, player = game.player, P = CONFIG.player;

  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.font = '700 15px "Courier New", monospace';
  ctx.fillStyle = 'rgba(10,30,45,0.55)';
  rr(10, 10, 200, 96, 6);
  ctx.fillStyle = '#f2e8c9';
  ctx.fillText('SCORE ' + game.score, 22, 18);
  ctx.fillText('ISLES', 22, 36);
  // island ownership pips
  game.islands.forEach((isl, i) => {
    ctx.fillStyle = isl.owner === 'player' ? '#7fc36b' : '#d8554a';
    rr(88 + i * 22, 38, 14, 10, 3);
    if (isl.capture > 0 && Math.sin(game.time * 12) > 0) {
      ctx.fillStyle = '#ffd24a';
      rr(88 + i * 22, 38, 14 * isl.capture, 10, 3);
    }
  });
  // health bar
  ctx.fillStyle = '#1c3347'; rr(22, 56, 176, 8, 4);
  ctx.fillStyle = player.hp > 35 ? '#7fc36b' : '#d8554a';
  if (player.hp > 0) rr(22, 56, 176 * (player.hp / 100), 8, 4);
  // gun heat bar (blinks red while overheated)
  ctx.fillStyle = '#1c3347'; rr(22, 68, 176, 5, 2);
  ctx.fillStyle = player.overheated
    ? (Math.sin(game.time * 18) > 0 ? '#ff5b4a' : '#8a2f26')
    : '#e8a33d';
  if (player.heat > 0) rr(22, 68, 176 * player.heat, 5, 2);
  // ammo bar
  const ammoFrac = player.ammo / P.ammoMax;
  ctx.fillStyle = '#1c3347'; rr(22, 77, 176, 5, 2);
  ctx.fillStyle = ammoFrac < 0.25
    ? (Math.sin(game.time * 10) > 0 ? '#ff5b4a' : '#9fd8ff')
    : '#9fd8ff';
  if (player.ammo > 0) rr(22, 77, 176 * ammoFrac, 5, 2);
  ctx.fillStyle = 'rgba(242,232,201,0.75)';
  ctx.font = '700 10px "Courier New", monospace';
  ctx.fillText('AMMO', 22, 86);
  ctx.fillText(Math.ceil(player.ammo) + '', 58, 86);

  // event banner
  if (game.banner.t > 0) {
    const b = game.banner;
    const a = clamp(Math.min(b.t / 0.3, (b.dur - b.t) / 0.3, 1), 0, 1);
    centerText(b.text, H * 0.13, 30, '#f2e8c9', a);
  }

  // deck prompts
  if (game.mode === 'play' && player.phase === 'deck') {
    const ready = player.hp >= P.hp && player.ammo >= P.ammoMax;
    const txt = ready
      ? (isTouchDevice ? 'PUSH THE STICK TO LAUNCH' : 'HOLD ↑ / W TO LAUNCH')
      : 'REARMING…';
    centerText(txt, H * 0.66, 17, '#f2e8c9', 0.7 + 0.3 * Math.sin(game.time * 4));
  }

  // out-of-ammo warning
  if (game.mode === 'play' && player.phase === 'air' && player.ammo <= 0) {
    centerText('OUT OF AMMO — LAND ON THE CARRIER', H * 0.3, 17,
      '#ffd24a', 0.6 + 0.4 * Math.sin(game.time * 8));
  }

  // off-screen enemy arrows — threats only: distant island defenders
  // stay off the edges so the HUD doesn't drown in arrows
  ctx.fillStyle = 'rgba(255,120,90,0.9)';
  for (const e of game.enemies) {
    if (e.role === 'defender' && Math.hypot(e.x - player.x, e.y - player.y) > 1200) continue;
    const p = edgePointer(e.x, e.y);
    if (!p) continue;
    ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(p[2]);
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -6); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // carrier pointer (home plate)
  const cp = edgePointer(CONFIG.carrier.x, CONFIG.carrier.y);
  if (cp) {
    ctx.save(); ctx.translate(cp[0], cp[1]); ctx.rotate(cp[2]);
    ctx.fillStyle = 'rgba(159,216,255,0.9)';
    ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-7, -7); ctx.lineTo(-7, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(159,216,255,0.9)';
    ctx.font = '700 10px "Courier New", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('CV', cp[0] - Math.cos(cp[2]) * 16, cp[1] - Math.sin(cp[2]) * 16);
  }

  // island pointers: diamonds colored by owner, pulsing when contested
  for (const isl of game.islands) {
    const p = edgePointer(isl.x, isl.y);
    if (!p) continue;
    const contested = isl.capture > 0;
    ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(Math.PI / 4);
    ctx.fillStyle = contested
      ? (Math.sin(game.time * 12) > 0 ? '#ffd24a' : '#d8554a')
      : isl.owner === 'player' ? 'rgba(127,195,107,0.85)' : 'rgba(216,85,74,0.85)';
    const s = contested ? 8 : 6;
    ctx.fillRect(-s / 2, -s / 2, s, s);
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

function fmtTime(s) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return m + ':' + (r < 10 ? '0' : '') + r;
}

export function drawMenus() {
  const owned = game.islands ? game.islands.filter(i => i.owner === 'player').length : 0;
  if (game.mode === 'title') {
    drawCenterText([
      ['PACIFIC SKIES', 42],
      ['· 1942 ·', 18],
      ['', 8],
      ['CAPTURE ALL 4 ISLANDS — LAND ON YOUR CARRIER TO REARM', 14],
      [isTouchDevice ? 'LEFT THUMB STEERS — RIGHT THUMB FIRES' : 'WASD / ARROWS TO FLY — SPACE TO FIRE', 14],
      ['', 8],
      [isTouchDevice ? 'TAP TO SCRAMBLE' : 'PRESS SPACE TO SCRAMBLE', 16],
    ]);
  } else if (game.mode === 'over') {
    drawCenterText([
      ['SHOT DOWN', 38],
      ['', 6],
      ['SCORE ' + game.score + '   ·   BEST ' + game.best, 18],
      ['ISLANDS HELD ' + owned + '/' + game.islands.length, 14],
      ['', 8],
      [isTouchDevice ? 'TAP TO FLY AGAIN' : 'PRESS SPACE TO FLY AGAIN', 15],
    ]);
  } else if (game.mode === 'win') {
    drawCenterText([
      ['VICTORY', 42],
      ['THE PACIFIC IS YOURS', 16],
      ['', 6],
      ['SCORE ' + game.score + '   ·   BEST ' + game.best, 18],
      ['TIME ' + fmtTime(game.runTime), 14],
      ['', 8],
      [isTouchDevice ? 'TAP TO FLY AGAIN' : 'PRESS SPACE TO FLY AGAIN', 15],
    ]);
  }
}
