// HUD, wave banner, off-screen arrows, touch controls, menus.
import { ctx, view, w2s } from './canvas.js';
import { game } from './state.js';
import { stick, fireTouch, isTouchDevice } from './input.js';
import { rr } from './sprites.js';
import { carrierAction } from './carrier.js';
import { defenders, getTarget } from './campaign.js';
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
    if (game.target === t.id) { ctx.strokeStyle = '#fff1bc'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.stroke(); }
  }
  const [cx, cy] = project(game.ships[0]);
  ctx.fillStyle = '#6de4b3'; ctx.fillRect(cx - 3, cy - 5, 6, 10);
  const [px, py] = project(p);
  ctx.save(); ctx.translate(px, py); ctx.rotate(p.a); ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-3, -3); ctx.lineTo(-3, 3); ctx.closePath(); ctx.fill(); ctx.restore();
  const target = getTarget(game);
  if (!target) return;
  const distance = Math.round(Math.hypot(target.x - p.x, target.y - p.y));
  const name = target.kind === 'carrier' ? 'HOME CARRIER' : target.name;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = '700 13px monospace';
  ctx.fillStyle = '#f2e8c9'; ctx.fillText(`${name} · ${distance} m`, W / 2, 111);
  let instruction;
  if (p.flight === 'landed') instruction = `Repairing ${Math.ceil(p.hp)} / ${CONFIG.player.hp} · L / TAKE OFF`;
  else if (p.flight !== 'flying') instruction = p.flight === 'approach' ? 'Assisted approach · L / ABORT' : p.flight === 'landing' ? 'Final approach' : 'Launching';
  else if (target.kind === 'carrier') instruction = distance <= CONFIG.carrier.callRadius ? 'L / LAND for repairs' : 'Return to carrier for repairs';
  else if (target.owner === 'us') instruction = 'Secured';
  else if (!target.activated) instruction = 'Fly to this island to engage its defenders';
  else if (defenders(game, target)) instruction = `${game.enemies.filter(e => e.territory === target.id && e.hp > 0).length} fighters · ${game.ships.filter(s => s.territory === target.id && s.hp > 0).length} patrol ships remaining`;
  else instruction = distance < CONFIG.conquest.captureRadius ? `Capturing · ${Math.ceil(CONFIG.conquest.captureSeconds - target.progress)}s` : 'Defenses cleared · enter the ring';
  ctx.font = '12px monospace'; ctx.fillText(instruction, W / 2, 132, W - 24);
  if (target.progress > 0 && target.owner !== 'us') {
    ctx.fillStyle = '#153747'; rr(W / 2 - 80, 151, 160, 5, 2);
    ctx.fillStyle = '#77e8ba'; rr(W / 2 - 80, 151, 160 * target.progress / CONFIG.conquest.captureSeconds, 5, 2);
  }
  const [sx, sy] = w2s(target.x, target.y);
  if (sx < 35 || sx > W - 35 || sy < 170 || sy > H - 40) {
    const dx = sx - W / 2, dy = sy - H / 2;
    const factor = Math.min((W / 2 - 32) / Math.max(.001, Math.abs(dx)), (H / 2 - 170) / Math.max(.001, Math.abs(dy)));
    ctx.save(); ctx.translate(W / 2 + dx * Math.max(.1, factor), H / 2 + dy * Math.max(.1, factor));
    ctx.rotate(Math.atan2(dy, dx)); ctx.fillStyle = target.kind === 'carrier' ? '#70edc4' : '#ffe192';
    ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(-7, -7); ctx.lineTo(-3, 0); ctx.lineTo(-7, 7); ctx.closePath(); ctx.fill(); ctx.restore();
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
    document.getElementById('target-action').textContent = isTouchDevice ? 'NEXT TARGET' : 'TAB · TARGET';
  }
  if (game.mode === 'title') {
    drawCenterText([
      ['PACIFIC SKIES', 42],
      ['· ISLAND CONQUEST ·', 18],
      ['Clear fighters & ships. Hold the islands.', 13],
      ['Land on your carrier to repair.', 13],
      ['', 8],
      [isTouchDevice ? 'LEFT THUMB STEERS — RIGHT THUMB FIRES' : 'WASD / ARROWS TO FLY — SPACE TO FIRE', 14],
      ['', 8],
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
