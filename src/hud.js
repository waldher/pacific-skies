// HUD, wave banner, off-screen arrows, touch controls, menus.
import { ctx, view, w2s } from './canvas.js';
import { game } from './state.js';
import { stick, fireTouch, isTouchDevice } from './input.js';
import { rr } from './sprites.js';
import { carrierAction } from './carrier.js';
import { defenders } from './campaign.js';
import { CONFIG } from './config.js';
import { clamp, TAU } from './util.js';

export function drawHud() {
  const { W, H } = view, player = game.player;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.font = '700 15px "Courier New", monospace';
  ctx.fillStyle = 'rgba(10,30,45,0.55)';
  rr(10, 10, 174, 70, 6);
  ctx.fillStyle = '#f2e8c9';
  ctx.fillText('SCORE ' + game.score, 22, 18);
  ctx.fillText('SECTORS ' + game.territories.filter(t => t.owner === 'us').length + '/' + game.territories.length, 22, 36);
  // health bar
  ctx.fillStyle = '#1c3347'; rr(22, 54, 150, 8, 4);
  ctx.fillStyle = player.hp > 35 ? '#7fc36b' : '#d8554a';
  if (player.hp > 0) rr(22, 54, 150 * (player.hp / 100), 8, 4);
  // gun heat bar (blinks red while overheated)
  ctx.fillStyle = '#1c3347'; rr(22, 66, 150, 5, 2);
  ctx.fillStyle = player.overheated
    ? (Math.sin(game.time * 18) > 0 ? '#ff5b4a' : '#8a2f26')
    : '#e8a33d';
  if (player.heat > 0) rr(22, 66, 150 * player.heat, 5, 2);

  drawNavigation();
  for (const ship of game.ships) {
    if (ship.hp <= 0) continue;
    const [sx, sy] = w2s(ship.x, ship.y);
    if (sx < -100 || sx > W + 100 || sy < -150 || sy > H + 150) continue;
    ctx.textAlign = 'center'; ctx.font = '700 11px monospace';
    ctx.fillStyle = ship.team === 'us' ? '#83edcb' : '#ffad91';
    ctx.fillText(ship.team === 'us' ? 'HOME CARRIER' : 'PATROL', sx, sy - ship.length / 2 - 18);
    if (ship.team === 'jp') {
      ctx.fillStyle = '#172e3a'; rr(sx - 23, sy + 26, 46, 4, 2);
      ctx.fillStyle = '#ed876c'; rr(sx - 23, sy + 26, 46 * ship.hp / ship.maxHp, 4, 2);
    }
  }
  if (game.messageTime > 0) {
    ctx.textAlign = 'center'; ctx.font = '700 12px monospace';
    ctx.fillStyle = 'rgba(9,29,40,.85)'; rr(12, H - 150, W - 24, 35, 5);
    ctx.fillStyle = '#f2e8c9'; ctx.fillText(game.message, W / 2, H - 139, W - 42);
  }

  for (const ally of game.allies) {
    const [x, y] = w2s(ally.x, ally.y);
    ctx.textAlign = 'center'; ctx.font = '700 10px monospace'; ctx.fillStyle = '#86ebd1';
    ctx.fillText(ally.name, x, y + 28);
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

function drawNavigation() {
  const { W, H } = view, p = game.player;
  const mx = W - 150, my = 10, mw = 140, mh = 88;
  ctx.fillStyle = 'rgba(8,27,39,.85)'; rr(mx, my, mw, mh, 6);
  const all = [...game.territories, game.ships[0]];
  const minX = Math.min(...all.map(t => t.x)) - 450, maxX = Math.max(...all.map(t => t.x)) + 450;
  const minY = Math.min(...all.map(t => t.y)) - 450, maxY = Math.max(...all.map(t => t.y)) + 450;
  const project = t => [mx + 8 + clamp((t.x - minX) / (maxX - minX), 0, 1) * (mw - 16),
    my + 8 + clamp((t.y - minY) / (maxY - minY), 0, 1) * (mh - 16)];
  for (const t of game.territories) {
    const [x, y] = project(t);
    ctx.fillStyle = t.owner === 'us' ? '#6de4b3' : '#ef816b';
    ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill();
  }
  const [cx, cy] = project(game.ships[0]);
  ctx.fillStyle = '#6de4b3'; ctx.fillRect(cx - 3, cy - 5, 6, 10);
  const [px, py] = project(p);
  ctx.save(); ctx.translate(px, py); ctx.rotate(p.a); ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-3, -3); ctx.lineTo(-3, 3); ctx.closePath(); ctx.fill(); ctx.restore();
  const nearby = game.territories.find(t => Math.hypot(t.x - p.x, t.y - p.y) < CONFIG.conquest.captureRadius);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = '12px monospace'; ctx.fillStyle = '#f2e8c9';
  if (p.flight === 'landed') ctx.fillText(`Repairing ${Math.ceil(p.hp)} / ${CONFIG.player.hp} · TORP ${p.torpedoAmmo}/${CONFIG.torpedo.capacity}`, W / 2, 112, W - 24);
  else if (p.landingHint) ctx.fillText(p.landingHint, W / 2, 112, W - 24);
  else if (nearby) {
    const remaining = defenders(game, nearby);
    const label = nearby.owner === 'us' ? 'Secured' : remaining ? `${remaining} defenders remaining` : `Capturing · ${Math.ceil(CONFIG.conquest.captureSeconds - nearby.progress)}s`;
    ctx.fillText(`${nearby.name} · ${label}`, W / 2, 112, W - 24);
    if (nearby.progress > 0 && nearby.owner !== 'us') {
      ctx.fillStyle = '#153747'; rr(W / 2 - 80, 135, 160, 5, 2);
      ctx.fillStyle = '#77e8ba'; rr(W / 2 - 80, 135, 160 * nearby.progress / CONFIG.conquest.captureSeconds, 5, 2);
    }
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
    ctx.fillText(txt, W / 2, y, W - 30);
    y += size * 1.7;
  }
}

export function drawMenus() {
  document.getElementById('flight-controls').hidden = game.mode !== 'play';
  if (game.mode === 'play') {
    const action = carrierAction(game), button = document.getElementById('carrier-action');
    button.textContent = (isTouchDevice ? '' : 'L · ') + action.label;
    button.disabled = !action.enabled;
    button.hidden = game.player.flight !== 'landed';
    const torpedo = document.getElementById('torpedo-action');
    torpedo.hidden = game.player.flight !== 'flying';
    torpedo.disabled = game.player.torpedoCd > 0 || game.player.torpedoAmmo === 0;
    torpedo.textContent = game.player.torpedoAmmo === 0 ? '0 TORPEDO · REARM'
      : game.player.torpedoCd > 0 ? `${game.player.torpedoAmmo} TORPEDO · ${Math.ceil(game.player.torpedoCd)}s`
      : (isTouchDevice ? '' : 'T · ') + `TORPEDO ×${game.player.torpedoAmmo}`;
  }
  if (game.mode === 'title') {
    drawCenterText([
      ['PACIFIC SKIES', 42],
      ['· ISLAND CONQUEST ·', 18],
      ['Clear fighters & ships. Hold the islands.', 13],
      ['Line up with the carrier stern to land.', 13],
      ['', 8],
      [isTouchDevice ? 'LEFT THUMB STEERS — RIGHT THUMB FIRES' : 'WASD / ARROWS TO FLY — SPACE TO FIRE', 14],
      [isTouchDevice ? 'TORPEDO BUTTON — SINK SHIPS' : 'T — DROP TORPEDO', 12],
      [isTouchDevice ? 'TAP TO SCRAMBLE' : 'PRESS SPACE TO SCRAMBLE', 16],
    ]);
  } else if (game.mode === 'victory') {
    drawCenterText([
      ['PACIFIC SECURED', 32], ['ALL ISLANDS UNDER YOUR CONTROL', 13],
      ['SCORE ' + game.score, 22], ['', 8],
      [isTouchDevice ? 'TAP FOR A NEW CAMPAIGN' : 'SPACE FOR A NEW CAMPAIGN', 14],
    ]);
  } else if (game.mode === 'over') {
    drawCenterText([
      ['SHOT DOWN', 38],
      ['', 6],
      ['SCORE ' + game.score + '   ·   BEST ' + game.best, 18],
      ['SECTORS ' + game.territories.filter(t => t.owner === 'us').length + ' / ' + game.territories.length, 14],
      ['', 8],
      [isTouchDevice ? 'TAP TO FLY AGAIN' : 'PRESS SPACE TO FLY AGAIN', 15],
    ]);
  }
}
