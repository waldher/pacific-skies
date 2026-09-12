// Responsive text readouts; world markers and touch controls stay on canvas.
import { objectiveFor, flightPresentation, coursePhase } from './objectives.js';
import { ctx, view, w2s } from './canvas.js';
import { game } from './state.js';
import { hasSavedCampaign } from './persistence.js';
import { stick, fireTouch, isTouchDevice } from './input.js';
import { rr } from './sprites.js';
import { AIRCRAFT, aircraftUnlocked } from './aircraft-types.js';
import { aircraftPreviews } from './aircraft-previews.js';
import { availableBases, canUseAircraft, selectSortie } from './bases.js';
import { carrierAction } from './carrier.js';
import { sessionSummary } from './session-report.js';
import { CONFIG } from './config.js';
import { clamp, TAU } from './util.js';
import { installationKnown, shipObserved, enemyObserved, observedAt, flightSeconds } from './intelligence.js';
import { drawTheaterMap } from './operations.js';

export function drawHud() {
  const { W, H } = view, player = game.player;
  drawNavigation();
  for (const ship of [...game.ships, ...(game.convoys || [])]) {
    if (ship.hp <= 0 || ship.active === false || !shipObserved(game, ship)) continue;
    const [sx, sy] = w2s(ship.x, ship.y);
    if (sx < -100 || sx > W + 100 || sy < -150 || sy > H + 150) continue;
    ctx.textAlign = 'center'; ctx.font = '700 11px monospace';
    ctx.fillStyle = ship.team === 'us' ? '#83edcb' : '#ffad91';
    if(ship.team==='jp' && ship.kind==='carrier')ctx.fillText('CARRIER',sx,sy-ship.length/2-18);
    if(ship.kind==='transport')ctx.fillText('CONVOY',sx,sy-ship.length/2-18);
    if (ship.team === 'jp') {
      ctx.fillStyle = '#172e3a'; rr(sx - 23, sy + 26, 46, 4, 2);
      ctx.fillStyle = '#ed876c'; rr(sx - 23, sy + 26, 46 * ship.hp / ship.maxHp, 4, 2);
    }
  }
  for (const field of game.airfields || []) {
    const holding = game.territories.find(t => t.id === field.territory || t === field.territory);
    if (field.owner !== 'us' && (!holding || !observedAt(game, holding))) continue;
    const [sx, sy] = w2s(field.x, field.y);
    if (sx < -80 || sx > W + 80 || sy < -80 || sy > H + 80) continue;
    ctx.textAlign = 'center'; ctx.font = '700 10px system-ui';
    ctx.fillStyle = field.owner === 'us' ? '#82dfbc' : '#ffad91';
    if(field.owner!=='us')ctx.fillText(field.hp>0?'AIRFIELD':'DISABLED',sx,sy-62);
    if (field.hp > 0 && (field.owner !== 'us' || field.hp < field.maxHp)) {
      ctx.fillStyle = '#172e3a'; rr(sx - 23, sy - 55, 46, 4, 2);
      ctx.fillStyle = field.owner === 'us' ? '#82dfbc' : '#ed876c'; rr(sx - 23, sy - 55, 46 * field.hp / field.maxHp, 4, 2);
    }
  }
  for (const territory of game.territories.filter(t => t.role && t.role !== 'airfield' && (t.owner === 'us' || observedAt(game,t)))) {
    const [sx, sy] = w2s(territory.x, territory.y);
    if (sx < -80 || sx > W + 80 || sy < -80 || sy > H + 80) continue;
    ctx.textAlign = 'center'; ctx.font = '700 10px system-ui';
    ctx.fillStyle = territory.owner === 'us' ? '#82dfbc' : '#ffad91';
    ctx.fillText(roleNames[territory.role].toUpperCase(), sx, sy - 40);
    if (territory.maxIntegrity && territory.integrity > 0) {
      ctx.fillStyle = '#172e3a'; rr(sx - 23, sy - 33, 46, 4, 2);
      ctx.fillStyle = territory.owner === 'us' ? '#82dfbc' : '#ed876c';
      rr(sx - 23, sy - 33, 46 * territory.integrity / territory.maxIntegrity, 4, 2);
    }
  }
  // off-screen enemy arrows
  ctx.fillStyle = 'rgba(255,120,90,0.9)';
  for (const e of game.enemies) {
    if (!enemyObserved(game, e)) continue;
    const [sx, sy] = w2s(e.x, e.y);
    if (sx > -10 && sx < W + 10 && sy > -10 && sy < H + 10) {
      if (e.strikeRole && e.phase !== 'retreat') {
        ctx.font = '650 9px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffbd83';
        ctx.fillText(e.strikeRole === 'torpedo' ? 'TORPEDO' : e.strikeRole === 'bomber' ? 'BOMBER' : 'ESCORT', sx, sy + 24);
      }
      continue;
    }
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
  drawTheaterMap(ctx, game, {x:mx, y:my, w:mw, h:mh});
  ctx.textAlign='right'; ctx.font='600 9px system-ui'; ctx.fillStyle='#adc6ca'; ctx.fillText('MAP ↗', mx+mw-7,my+mh-5);
  drawCourseMarker();
}

// Direction while travelling; a stationary, unlabelled marker once close.
function drawCourseMarker() {
  if(game.mode!=='play' || game.player.flight!=='flying' || !game.waypoint)return;
  const {W,H}=view, target=game.waypoint, [sx,sy]=w2s(target.x,target.y);
  const phase=coursePhase(game);
  ctx.save();ctx.strokeStyle='#edce91';ctx.lineWidth=1.5;
  if(phase==='arrived') {
    ctx.globalAlpha=.55;
    ctx.beginPath();ctx.arc(sx,sy,18,0,TAU);ctx.stroke();
  } else {
    const [px,py]=w2s(game.player.x,game.player.y);
    const dx=sx-px,dy=sy-py,d=Math.hypot(dx,dy),radius=Math.min(W*.3,H*.2);
    const x=px+dx*Math.min(1,radius/(d||1)),y=py+dy*Math.min(1,radius/(d||1));
    ctx.translate(x,y);ctx.rotate(Math.atan2(dy,dx));
    ctx.beginPath();ctx.moveTo(-5,-5);ctx.lineTo(3,0);ctx.lineTo(-5,5);ctx.stroke();
  }
  ctx.restore();
}

const el = id => document.getElementById(id);
const text = (id, value) => { const node = el(id); if (node.textContent !== value) node.textContent = value; };
let menuState = '';
let sortieBound = false;
const aircraftIds = Object.keys(AIRCRAFT);
const roleNames = { airfield: 'Airfield', port: 'Port', radar: 'Radar station' };
const roleBenefits = { airfield: 'Landing, repair & defenses', port: 'Supplies fleet repairs', radar: 'Reveals installations & tracks fleets' };
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const icons = {
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
      if (kind === 'aircraft') {
        const img = document.createElement('img');
        img.src = aircraftPreviews[entry.id]; img.alt = ''; img.width = 256; img.height = 160;
        art.append(img);
      } else art.innerHTML = `<svg viewBox="0 0 96 80" aria-hidden="true">${icons[entry.icon]}</svg>`;
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
      const requested = card.dataset.choice === 'loadout' ? card.dataset.value : current.loadout;
      const loadouts = AIRCRAFT[aircraft].loadouts;
      const loadout = loadouts.includes(requested) ? requested : loadouts[0];
      selectSortie(game, { baseId, aircraft, loadout });
    });
    sortieBound = true;
  }
  const bases = availableBases(game), base = bases.find(b => b.id === p.baseId) || bases[0];
  const next = aircraftIds.find(id => !aircraftUnlocked(game, id));
  el('sortie-unlock').hidden = !next;
  if (next) {
    const type = AIRCRAFT[next], requirements = [];
    if ((game.combatSorties || 0) < (type.unlockSorties || 0)) requirements.push(`${game.combatSorties || 0}/${type.unlockSorties} combat sorties`);
    if (game.score < type.unlockScore) requirements.push(`${type.unlockScore.toLocaleString()} pts`);
    if (game.rank < type.minRank) requirements.push('rescue the carrier');
    text('sortie-unlock', `Next: ${type.shortName} · ${requirements.join(' + ')}`);
  }
  choiceCards(el('sortie-base'), bases.map(b => ({ id:b.id, name:b.name, icon:b.kind, detail:b.kind === 'carrier' ? 'Flight deck' : 'Runway' })), base?.id, 'base');
  choiceCards(el('sortie-aircraft'), aircraftIds.filter(a => base && canUseAircraft(game, base, a)).map(a => ({ id:a, name:AIRCRAFT[a].shortName, icon:a, detail:AIRCRAFT[a].role })), p.aircraft, 'aircraft');
  choiceCards(el('sortie-loadout'), AIRCRAFT[p.aircraft].loadouts.map(id => ({ id, icon:id, name:id === 'bombs' ? '2 bombs' : '2 torpedoes', detail:id === 'bombs' ? 'Ground targets' : 'Ship hunter' })), p.loadout, 'loadout');
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
    drawThreatStatus();
    text('score-value', game.score.toLocaleString());
    text('hull-value', `${Math.ceil(p.hp)}%`);
    el('hull-value').style.color = p.hp > 35 ? '#82dfbc' : '#f18f7c';
    if (el('island-pips').children.length !== game.territories.length) el('island-pips').replaceChildren(...game.territories.map(() => document.createElement('i')));
    text('campaign-label', `Campaign · ${game.territories.filter(t=>t.owner==='us').length}/${game.territories.length} secured`);
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
    const nearby = game.territories.find(t => installationKnown(game,t) && Math.hypot(t.x - p.x, t.y - p.y) < CONFIG.conquest.captureRadius);
    let {title,detail} = flightPresentation(game);
    if (nearby?.progress>0 && nearby.owner!=='us') { title='Capturing'; detail=''; }
    if (p.landingHint) { title='Approach'; detail=p.landingHint; }
    el('objective').hidden = !title || p.flight !== 'flying'; text('objective-title', title); text('objective-detail', detail); el('objective-detail').hidden=!detail;
    el('capture-track').hidden = !nearby || nearby.progress <= 0 || nearby.owner === 'us' || p.flight !== 'flying';
    el('capture-fill').style.width = `${(nearby?.progress || 0) / CONFIG.conquest.captureSeconds * 100}%`;
    // Avoid repeating the deck status in a second panel.
    el('toast').hidden = game.messageTime <= 0 || p.flight === 'landed' || /spotted|follow the gold|select it on the map/i.test(game.message); text('toast', game.message);
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
  drawSessionReport();
  const saved = game.mode === 'title' && hasSavedCampaign();
  const key = `${game.mode}:${isTouchDevice}:${game.score}:${game.best}:${saved}`;
  if (key === menuState) return;
  menuState = key;
  text('menu-kicker', 'Pacific theater · 1942');
  text('menu-title', game.mode === 'title' ? 'Pacific Skies' : game.mode === 'victory' ? 'Pacific secured' : game.mode === 'recovery' ? 'Aircraft lost' : game.endReason || 'Shot down');
  text('menu-summary', game.mode === 'title' ? 'Capture airfields and radar. Defeat the enemy fleet.' : game.mode === 'recovery' ? 'Aircraft lost. Your territory is safe.' : `Score ${game.score.toLocaleString()} · Best ${game.best.toLocaleString()}`);
  const instructions = game.mode === 'title' ? (isTouchDevice
    ? ['Left thumb steers · Right thumb fires', 'Bomb island defenses · Torpedo ships', 'Line up with a friendly runway to land']
    : ['WASD / Arrows to fly · Space to fire', 'T to drop ordnance · L to take off', 'Line up with a friendly runway to land']) : [`${game.territories.filter(t => t.owner === 'us').length} of ${game.territories.length} holdings secured`];
  el('menu-instructions').replaceChildren(...instructions.map(line => { const node = document.createElement('div'); node.textContent = line; return node; }));
  const action = game.mode === 'recovery' ? 'Return to base' : saved ? 'Continue expedition' : 'Begin expedition';
  text('menu-start', isTouchDevice ? action : `${action} · Space`);
  el('menu-new').hidden = !saved;
}

function drawSessionReport() {
  const node = el('session-report'), report = sessionSummary(game);
  node.hidden = game.mode === 'title' || !report;
  if (node.hidden) { node.open = false; return; }
  if (!node.dataset.bound) {
    for (const event of ['keydown', 'keyup', 'pointerdown']) node.addEventListener(event, e => e.stopPropagation());
    node.dataset.bound = 'true';
  }
  const rows = [['Campaign time', clock(report.elapsed)], ['Territory gained / lost', `${report.captured} / ${report.lost}`], ['Carriers lost', report.carrierLosses]];
  if (Number.isFinite(report.raids.intercepted)) rows.push(['Your raid interceptions', report.raids.intercepted]);
  if (Number.isFinite(report.raids.damage)) rows.push(['Raid damage sustained', Math.round(report.raids.damage)]);
  const signature = JSON.stringify(report);
  if (node.dataset.report === signature) return;
  node.dataset.report = signature;
  el('report-grid').replaceChildren(...rows.map(([label, value]) => {
    const cell = document.createElement('div'), name = document.createElement('span'), number = document.createElement('strong');
    name.textContent = label; number.textContent = value; cell.append(name, number); return cell;
  }));
  text('report-unlocks', report.unlocks.length ? report.unlocks.map(u => `${AIRCRAFT[u.aircraft]?.shortName || u.aircraft} at ${clock(u.time)}`).join(' · ') : 'No new aircraft unlocked this campaign.');
}

function raidTarget(id) {
  if (id?.startsWith('escort-')) return game.ships.find(s=>s.id===id.slice(7)&&s.team==='us');
  const base = (game.bases || []).find(b => b.id === id);
  return base?.ship || base?.airfield || (base?.shipId && game.ships.find(s => s.id === base.shipId))
    || (game.airfields || []).find(f => f.id === id)
    || game.ships.find(s => s.id === id || (id === 'fleet-carrier' && s.team === 'us' && s.kind === 'carrier'))
    || game.territories.find(t => `territory-${t.id}` === id);
}
function drawThreatStatus() {
  const threats = game.enemies.filter(e => e.hp > 0 && e.strike && enemyObserved(game,e) && e.phase !== 'retreat' && !e.rescue);
  el('threat-status').hidden = !threats.length;
  if (!threats.length) return;
  const first = threats.reduce((a, b) => Math.hypot(a.x - game.player.x, a.y - game.player.y) < Math.hypot(b.x - game.player.x, b.y - game.player.y) ? a : b);
  const target = raidTarget(first.targetBaseId), formation = threats.filter(e => e.targetBaseId === first.targetBaseId);
  const name = target?.name || (first.targetBaseId === 'home-airfield' ? 'Home airfield' : 'Friendly position');
  text('threat-title', `${formation.length} attackers → base`);
  text('threat-detail', 'Tap to defend');
  el('threat-status').onclick=()=>{if(target){game.waypoint={x:target.x,y:target.y,name,defend:true,auto:false};game.guidanceCleared=false;}};
}
