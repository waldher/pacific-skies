// Responsive text readouts; world markers and touch controls stay on canvas.
import { ctx, view, w2s } from './canvas.js';
import { game } from './state.js';
import { stick, fireTouch, isTouchDevice } from './input.js';
import { rr } from './sprites.js';
import { AIRCRAFT } from './aircraft-types.js';
import { availableBases, canUseAircraft, selectSortie } from './bases.js';
import { carrierAction } from './carrier.js';
import { defenders } from './campaign.js';
import { CONFIG } from './config.js';
import { clamp, TAU } from './util.js';

export function drawHud() {
  const { W, H } = view, player = game.player;
  drawNavigation();
  for (const ship of game.ships) {
    if (ship.hp <= 0 || ship.active === false) continue;
    const [sx, sy] = w2s(ship.x, ship.y);
    if (sx < -100 || sx > W + 100 || sy < -150 || sy > H + 150) continue;
    ctx.textAlign = 'center'; ctx.font = '700 11px monospace';
    ctx.fillStyle = ship.team === 'us' ? '#83edcb' : '#ffad91';
    ctx.fillText(ship.team === 'us' ? 'FRIENDLY CARRIER' : ship.kind === 'carrier' ? 'ENEMY CARRIER' : 'PATROL', sx, sy - ship.length / 2 - 18);
    if (ship.team === 'jp') {
      ctx.fillStyle = '#172e3a'; rr(sx - 23, sy + 26, 46, 4, 2);
      ctx.fillStyle = '#ed876c'; rr(sx - 23, sy + 26, 46 * ship.hp / ship.maxHp, 4, 2);
    }
  }
  for (const field of game.airfields || []) {
    const [sx, sy] = w2s(field.x, field.y);
    if (sx < -80 || sx > W + 80 || sy < -80 || sy > H + 80) continue;
    ctx.textAlign = 'center'; ctx.font = '700 10px system-ui';
    ctx.fillStyle = field.owner === 'us' ? '#82dfbc' : '#ffad91';
    ctx.fillText(field.owner === 'us' ? 'FRIENDLY AIRFIELD' : field.hp > 0 ? 'AIRFIELD · BOMB TARGET' : 'AIRFIELD DISABLED', sx, sy - 62);
    if (field.owner !== 'us' && field.hp > 0) {
      ctx.fillStyle = '#172e3a'; rr(sx - 23, sy - 55, 46, 4, 2);
      ctx.fillStyle = '#ed876c'; rr(sx - 23, sy - 55, 46 * field.hp / field.maxHp, 4, 2);
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

  }
}

function drawNavigation() {
  const { W, H } = view, p = game.player;
  const mw = Math.min(140, Math.max(100, W * .3)), mh = 84, mx = W - mw - 12, my = 12;
  ctx.fillStyle = 'rgba(8,27,39,.88)'; rr(mx, my, mw, mh, 10);
  const all = [...game.territories, ...game.ships.filter(s => s.hp > 0 && s.active !== false), p];
  const minX = Math.min(...all.map(t => t.x)) - 450, maxX = Math.max(...all.map(t => t.x)) + 450;
  const minY = Math.min(...all.map(t => t.y)) - 450, maxY = Math.max(...all.map(t => t.y)) + 450;
  const project = t => [mx + 8 + clamp((t.x - minX) / (maxX - minX), 0, 1) * (mw - 16),
    my + 8 + clamp((t.y - minY) / (maxY - minY), 0, 1) * (mh - 16)];
  for (const t of game.territories) {
    const [x, y] = project(t);
    ctx.fillStyle = t.owner === 'us' ? '#6de4b3' : '#ef816b';
    const hasAirfield = (game.airfields || []).some(f => f.territory === t.id);
    if (hasAirfield) {
      ctx.fillRect(x - 4, y - 4, 8, 8);
      ctx.fillStyle = '#f2eee1'; ctx.fillRect(x - .5, y - 3, 1, 6);
    } else { ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill(); }
  }
  for (const ship of game.ships.filter(s => s.hp > 0 && s.active !== false && s.kind === 'carrier')) {
    const [cx, cy] = project(ship); ctx.fillStyle = ship.team === 'us' ? '#6de4b3' : '#ef816b'; ctx.fillRect(cx - 3, cy - 5, 6, 10);
  }
  const [px, py] = project(p);
  ctx.save(); ctx.translate(px, py); ctx.rotate(p.a); ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-3, -3); ctx.lineTo(-3, 3); ctx.closePath(); ctx.fill(); ctx.restore();
}

const el = id => document.getElementById(id);
const text = (id, value) => { const node = el(id); if (node.textContent !== value) node.textContent = value; };
let menuState = '';
let sortieBound = false;
const aircraftIds = Object.keys(AIRCRAFT);
const icons = {
  p38: '<path d="M28 12h6v50l-3 9-3-9zm34 0h6v50l-3 9-3-9zM45 17h6l3 29-6 23-6-23z"/><path d="m12 35 30-5h12l30 5v6H12zm14 25h44v5H26z"/><path class="icon-line" d="M22 15h18m16 0h18"/>',
  corsair: '<path d="m45 10 6 0 4 26 29 9-1 7-22-3-8-5-2 18 12 7v5l-15-3-15 3v-5l12-7-2-18-8 5-22 3-1-7 29-9z"/><path class="icon-line" d="M35 16h26"/>',
  airfield: '<path d="M35 9h26v62H35z"/><path class="icon-cut" d="M47 14h2v9h-2zm0 16h2v9h-2zm0 16h2v9h-2zm0 16h2v5h-2z"/><path d="M14 23h13v13H14zm55 19h13v13H69z"/>',
  carrier: '<path d="m35 9 26 0 7 45-12 17H40L28 54z"/><path class="icon-cut" d="M46 17h3v42h-3z"/><path d="M64 25h10v20H64z"/>',
  bombs: '<path d="m41 12 7 5 7-5v16c13 17 13 31-7 42-20-11-20-25-7-42z"/><path class="icon-cut" d="M45 34h3v21h-3z"/>',
  torpedoes: '<path d="m48 8 8 13v39l8 10-16-5-16 5 8-10V21z"/><path class="icon-cut" d="M45 23h3v30h-3z"/>',
};
function choiceCards(node, entries, selected, kind) {
  const signature = JSON.stringify(entries);
  if (node.dataset.options !== signature) {
    node.replaceChildren(...entries.map(entry => {
      const card = document.createElement(entries.length > 1 ? 'button' : 'div');
      card.className = 'sortie-card'; card.dataset.value = entry.id;
      if (entries.length > 1) { card.type = 'button'; card.dataset.choice = kind; }
      const art = document.createElement('span'); art.className = 'sortie-art';
      art.innerHTML = `<svg viewBox="0 0 96 80" aria-hidden="true">${icons[entry.icon]}</svg>`;
      const copy = document.createElement('span'); copy.className = 'sortie-copy';
      const name = document.createElement('strong'); name.textContent = entry.name;
      const detail = document.createElement('small'); detail.textContent = entry.detail;
      copy.append(name, detail); card.append(art, copy); return card;
    }));
    node.dataset.options = signature;
  }
  for (const card of node.children) {
    const active = card.dataset.value === selected;
    card.classList.toggle('selected', active);
    if (card.tagName === 'BUTTON') card.setAttribute('aria-pressed', String(active));
  }
  node.classList.toggle('has-choices', entries.length > 1);
}
function drawSortie(p, playing) {
  const panel = el('sortie-panel');
  panel.hidden = !playing || p?.flight !== 'landed';
  if (panel.hidden) return;
  if (!sortieBound) {
    panel.addEventListener('keydown', e => e.stopPropagation());
    panel.addEventListener('keyup', e => e.stopPropagation());
    panel.addEventListener('pointerdown', e => e.stopPropagation());
    panel.addEventListener('click', event => {
      const card = event.target.closest('button[data-choice]');
      if (!card) return;
      const current = game.player;
      const baseId = card.dataset.choice === 'base' ? card.dataset.value : current.baseId;
      const base = availableBases(game).find(b => b.id === baseId);
      let aircraft = card.dataset.choice === 'aircraft' ? card.dataset.value : current.aircraft;
      if (!canUseAircraft(game, base, aircraft)) aircraft = aircraftIds.find(a => canUseAircraft(game, base, a));
      const loadout = aircraft === 'p38' ? 'bombs' : card.dataset.choice === 'loadout' ? card.dataset.value : current.loadout;
      selectSortie(game, { baseId, aircraft, loadout });
    });
    sortieBound = true;
  }
  const bases = availableBases(game), base = bases.find(b => b.id === p.baseId) || bases[0];
  choiceCards(el('sortie-base'), bases.map(b => ({ id:b.id, name:b.name, icon:b.kind, detail:b.kind === 'carrier' ? 'Flight deck' : 'Runway' })), base?.id, 'base');
  choiceCards(el('sortie-aircraft'), aircraftIds.filter(a => base && canUseAircraft(game, base, a)).map(a => ({ id:a, name:AIRCRAFT[a].shortName, icon:a, detail:AIRCRAFT[a].role })), p.aircraft, 'aircraft');
  choiceCards(el('sortie-loadout'), (p.aircraft === 'p38' ? ['bombs'] : ['bombs', 'torpedoes']).map(id => ({ id, icon:id, name:id === 'bombs' ? '2 bombs' : '2 torpedoes', detail:id === 'bombs' ? 'Airfields & ships' : 'Ship hunter' })), p.loadout, 'loadout');
}



export function drawMenus() {
  const playing = game.mode === 'play', p = game.player;
  drawSortie(p, playing);
  el('flight-hud').hidden = !playing;
  el('flight-controls').hidden = !playing;
  el('menu').hidden = playing;
  el('fire-indicator').hidden = !playing || !isTouchDevice || p?.flight !== 'flying';
  el('fire-indicator').dataset.firing = String(fireTouch.active);
  if (playing) {
    text('score-value', game.score.toLocaleString());
    text('hull-value', `${Math.ceil(p.hp)}%`);
    el('hull-value').style.color = p.hp > 35 ? '#82dfbc' : '#f18f7c';
    if (el('island-pips').children.length !== game.territories.length) el('island-pips').replaceChildren(...game.territories.map(() => document.createElement('i')));
    text('rank-value', ['Cadet', 'Lieutenant', 'Naval aviator'][Math.min(game.rank || 0, 2)]);
    text('rank-progress', game.rank < 1 ? ` · ${game.score}/${CONFIG.progression?.rescueScore || 600}` : '');
    const homeCarrier = game.ships.find(s => s.kind === 'carrier' && s.team === 'us' && s.hp > 0 && s.active !== false);
    const homeField = (game.airfields || []).find(f => f.id === 'home-airfield');
    const defendedBase = homeCarrier || homeField;
    el('carrier-status').hidden = !defendedBase;
    text('carrier-status', defendedBase ? `${homeCarrier ? 'Carrier hull' : 'Home airfield'} ${Math.max(0, Math.ceil(defendedBase.hp / defendedBase.maxHp * 100))}%` : '');
    el('carrier-status').style.color = defendedBase && defendedBase.hp < defendedBase.maxHp * .35 ? '#f18f7c' : '';
    Array.from(el('island-pips').children).forEach((pip, i) => { pip.style.background = game.territories[i]?.owner === 'us' ? '#82dfbc' : '#36505c'; });
    text('islands-value', `${game.territories.filter(t => t.owner === 'us').length} / ${game.territories.length}`);
    el('health-fill').style.width = `${clamp(p.hp / CONFIG.player.hp, 0, 1) * 100}%`;
    el('health-fill').style.background = p.hp > 35 ? '#82dfbc' : '#f18f7c';
    el('heat-fill').style.width = `${p.heat * 100}%`;
    el('heat-fill').style.background = p.overheated ? '#f18f7c' : '#e5b76f';
    const nearby = game.territories.find(t => Math.hypot(t.x - p.x, t.y - p.y) < CONFIG.conquest.captureRadius);
    let title = '', detail = '';
    if (p.flight === 'landed') { title = p.hp < CONFIG.player.hp ? 'Repairing' : 'Ready for takeoff'; detail = `Hull ${Math.ceil(p.hp)}% · ${p.loadout === 'bombs' ? 'Bombs ' + (p.bombAmmo || 0) : 'Torpedoes ' + (p.torpedoAmmo || 0)}`; }
    else if (p.landingHint) { title = 'Landing approach'; detail = p.landingHint; }
    else if (nearby) {
      title = nearby.name;
      const remaining = defenders(game, nearby);
      const field = (game.airfields || []).find(f => (f.territory === nearby.id || f.territory === nearby) && f.owner !== 'us' && f.hp > 0);
      detail = nearby.owner === 'us' ? 'Secured' : field ? 'Bomb the airfield to stop enemy launches' : remaining ? `${remaining} defenders remaining` : `Securing island · ${Math.ceil(CONFIG.conquest.captureSeconds - nearby.progress)}s`;
    }
    if (p.flight === 'flying' && !p.landingHint && game.rescue?.status === 'active' && (!nearby || nearby.owner === 'us')) {
      title = 'Carrier rescue';
      const intercepts = game.rescue.intercepts || 0, threats = game.enemies.some(e => e.rescue && e.hp > 0);
      detail = !game.rescue.launched ? 'Rendezvous with USS Resolute' : intercepts >= 2 && !threats ? 'Rendezvous with the carrier' : intercepts >= 2 ? 'Finish defending the carrier' : `Intercept attackers · ${intercepts}/2 required`;
    }
    else if (!title && game.rescue?.status === 'retry') { title = 'Rescue regrouping'; detail = 'Another rescue opportunity will follow'; }
    el('objective').hidden = !title; text('objective-title', title); text('objective-detail', detail);
    el('capture-track').hidden = !nearby || nearby.progress <= 0 || nearby.owner === 'us' || p.flight !== 'flying';
    el('capture-fill').style.width = `${(nearby?.progress || 0) / CONFIG.conquest.captureSeconds * 100}%`;
    // Avoid repeating the deck status in a second panel.
    el('toast').hidden = game.messageTime <= 0 || p.flight === 'landed'; text('toast', game.message);
    const action = carrierAction(game), button = el('carrier-action');
    button.textContent = (isTouchDevice ? '' : 'L · ') + action.label;
    button.disabled = !action.enabled; button.hidden = p.flight !== 'landed';
    const torpedo = el('torpedo-action'); torpedo.hidden = p.flight !== 'flying';
    const bombing = p.loadout === 'bombs', ammo = bombing ? p.bombAmmo : p.torpedoAmmo;
    const cooldown = bombing ? p.bombCd : p.torpedoCd, name = bombing ? 'Bomb' : 'Torpedo';
    const capacity = bombing ? (CONFIG.bomb?.capacity || 2) : CONFIG.torpedo.capacity;
    torpedo.disabled = cooldown > 0 || !ammo;
    torpedo.textContent = (isTouchDevice || cooldown > 0 || !ammo ? '' : 'T · ') + `${name} ${ammo || 0}/${capacity}` + (cooldown > 0 ? ` · ${Math.ceil(cooldown)}s` : '');
    return;
  }
  const key = `${game.mode}:${isTouchDevice}:${game.score}:${game.best}`;
  if (key === menuState) return;
  menuState = key;
  text('menu-kicker', 'Pacific theater · 1942');
  text('menu-title', game.mode === 'title' ? 'Pacific Skies' : game.mode === 'victory' ? 'Pacific secured' : game.endReason || 'Shot down');
  text('menu-summary', game.mode === 'title' ? 'Launch from your airfield. Capture islands, earn your wings, and rescue the fleet.' : `Score ${game.score.toLocaleString()} · Best ${game.best.toLocaleString()}`);
  const instructions = game.mode === 'title' ? (isTouchDevice
    ? ['Left thumb steers · Right thumb fires', 'Tap Bomb to strike airfields and ships', 'Line up with a friendly runway to land']
    : ['WASD / Arrows to fly · Space to fire', 'T to drop ordnance · L to take off', 'Line up with a friendly runway to land']) : [`${game.territories.filter(t => t.owner === 'us').length} of ${game.territories.length} islands secured`];
  el('menu-instructions').replaceChildren(...instructions.map(line => { const node = document.createElement('div'); node.textContent = line; return node; }));
  text('menu-start', isTouchDevice ? 'Tap to begin' : 'Press Space to begin');
}
