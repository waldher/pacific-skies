// Responsive text readouts; world markers and touch controls stay on canvas.
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
  const mw = Math.min(140, Math.max(100, W * .3)), mh = 84, mx = W - mw - 12, my = 12;
  ctx.fillStyle = 'rgba(8,27,39,.88)'; rr(mx, my, mw, mh, 10);
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
}

const el = id => document.getElementById(id);
const text = (id, value) => { const node = el(id); if (node.textContent !== value) node.textContent = value; };
let menuState = '';

export function drawMenus() {
  const playing = game.mode === 'play', p = game.player;
  el('flight-hud').hidden = !playing;
  el('flight-controls').hidden = !playing;
  el('menu').hidden = playing;
  if (playing) {
    text('score-value', game.score.toLocaleString());
    text('islands-value', `${game.territories.filter(t => t.owner === 'us').length} / ${game.territories.length}`);
    el('health-fill').style.width = `${clamp(p.hp / CONFIG.player.hp, 0, 1) * 100}%`;
    el('health-fill').style.background = p.hp > 35 ? '#82dfbc' : '#f18f7c';
    el('heat-fill').style.width = `${p.heat * 100}%`;
    el('heat-fill').style.background = p.overheated ? '#f18f7c' : '#e5b76f';
    const nearby = game.territories.find(t => Math.hypot(t.x - p.x, t.y - p.y) < CONFIG.conquest.captureRadius);
    let title = '', detail = '';
    if (p.flight === 'landed') { title = p.hp < CONFIG.player.hp ? 'Repairing' : 'Ready for takeoff'; detail = `Hull ${Math.ceil(p.hp)}% · Torpedoes ${p.torpedoAmmo}/${CONFIG.torpedo.capacity}`; }
    else if (p.landingHint) { title = 'Carrier approach'; detail = p.landingHint; }
    else if (nearby) {
      title = nearby.name;
      const remaining = defenders(game, nearby);
      detail = nearby.owner === 'us' ? 'Secured' : remaining ? `${remaining} defenders remaining` : `Securing island · ${Math.ceil(CONFIG.conquest.captureSeconds - nearby.progress)}s`;
    }
    el('objective').hidden = !title; text('objective-title', title); text('objective-detail', detail);
    el('capture-track').hidden = !nearby || nearby.progress <= 0 || nearby.owner === 'us' || p.flight !== 'flying';
    el('capture-fill').style.width = `${(nearby?.progress || 0) / CONFIG.conquest.captureSeconds * 100}%`;
    // Avoid repeating the deck status in a second panel.
    el('toast').hidden = game.messageTime <= 0 || p.flight === 'landed'; text('toast', game.message);
    const action = carrierAction(game), button = el('carrier-action');
    button.textContent = (isTouchDevice ? '' : 'L · ') + action.label;
    button.disabled = !action.enabled; button.hidden = p.flight !== 'landed';
    const torpedo = el('torpedo-action'); torpedo.hidden = p.flight !== 'flying';
    torpedo.disabled = p.torpedoCd > 0 || p.torpedoAmmo === 0;
    torpedo.textContent = p.torpedoAmmo === 0 ? 'Torpedoes 0/2'
      : p.torpedoCd > 0 ? `Torpedo ${p.torpedoAmmo}/2 · ${Math.ceil(p.torpedoCd)}s`
      : (isTouchDevice ? '' : 'T · ') + `Torpedo ${p.torpedoAmmo}/2`;
    return;
  }
  const key = `${game.mode}:${isTouchDevice}:${game.score}:${game.best}`;
  if (key === menuState) return;
  menuState = key;
  text('menu-kicker', 'Pacific theater · 1942');
  text('menu-title', game.mode === 'title' ? 'Pacific Skies' : game.mode === 'victory' ? 'Pacific secured' : 'Shot down');
  text('menu-summary', game.mode === 'title' ? 'Clear the defenders. Capture the islands. Return to your carrier to repair and rearm.' : `Score ${game.score.toLocaleString()} · Best ${game.best.toLocaleString()}`);
  const instructions = game.mode === 'title' ? (isTouchDevice
    ? ['Left thumb steers · Right thumb fires', 'Tap Torpedo to sink ships', 'Line up with the carrier deck to land']
    : ['WASD / Arrows to fly · Space to fire', 'T to drop a torpedo · L to take off', 'Line up with the carrier deck to land']) : [`${game.territories.filter(t => t.owner === 'us').length} of ${game.territories.length} islands secured`];
  el('menu-instructions').replaceChildren(...instructions.map(line => { const node = document.createElement('div'); node.textContent = line; return node; }));
  text('menu-start', isTouchDevice ? 'Tap to fly' : 'Press Space to fly');
}
