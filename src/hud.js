// Responsive text readouts; world markers and touch controls stay on canvas.
import { objectiveFor, flightPresentation, coursePhase } from './objectives.js';
import { ctx, view, w2s } from './canvas.js';
import { game } from './state.js';
import { hasSavedCampaign } from './persistence.js';
import { stick, fireTouch, isTouchDevice, keys } from './input.js';
import { rr } from './sprites.js';
import { AIRCRAFT, aircraftUnlocked } from './aircraft-types.js';
import { aircraftPreviews } from './aircraft-previews.js';
import { availableBases, canUseAircraft, selectSortie, resolveBase } from './bases.js';
import { carrierAction } from './carrier.js';
import { sessionSummary } from './session-report.js';
import { CONFIG } from './config.js';
import { clamp, angDiff, TAU } from './util.js';
import { installationKnown, shipObserved, enemyObserved, observedAt, flightSeconds } from './intelligence.js';
import { drawTheaterMap } from './operations.js';
import { pilotMarkerBounds, visualHeight } from './projection.js';
import { wingLabelBaseline } from './hud-labels.js';
const aircraftHeight = entity => visualHeight(entity, CONFIG.render.flightHeight);
const baseHeight = base => base.kind === 'carrier' ? CONFIG.carrier.deckHeight : CONFIG.airfield.deckHeight;

export function drawHud() {
  const { W, H } = view, player = game.player;
  const navigationPanels = drawNavigation();
  drawPilotMarker(player, navigationPanels);
  for (const ship of [...game.ships, ...(game.convoys || [])]) {
    if (ship.hp <= 0 || ship.active === false || !shipObserved(game, ship)) continue;
    const [sx, sy] = w2s(ship.x, ship.y, ship.kind === 'transport' ? 10 : 11.5);
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
    const [sx, sy] = w2s(field.x, field.y, CONFIG.airfield.deckHeight);
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
    const [sx, sy] = w2s(territory.x, territory.y, 8.5);
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
  // Wingmen wear their call signs; a lead pipper marks where to shoot the nearest fighter.
  for (const f of game.allies) {
    if ((f.role ?? 'wing') !== 'wing' || f.hp <= 0 || !f.name) continue;
    const [sx, sy] = w2s(f.x, f.y, aircraftHeight(f));
    if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue;
    ctx.textAlign = 'center'; ctx.font = '600 9px system-ui'; ctx.fillStyle = '#9fe6cf';
    const name = f.name + (f.kills >= CONFIG.airWar.wing.veteranKills ? ' ★' : '');
    const baseline = wingLabelBaseline(sx, sy, ctx.measureText(name), view, navigationPanels);
    if (baseline !== null) ctx.fillText(name, sx, baseline);
  }
  if (player.flight === 'flying') {
    let mark = null, best = 650;
    for (const e of game.enemies) {
      if (e.hp <= 0 || !enemyObserved(game, e)) continue;
      const d = Math.hypot(e.x - player.x, e.y - player.y);
      if (d < best && Math.abs(angDiff(player.a, Math.atan2(e.y - player.y, e.x - player.x))) < 1.1) { best = d; mark = e; }
    }
    if (mark) {
      const t = best / CONFIG.player.bulletSpeed, v = mark.v ?? mark.speed;
      const [lx, ly] = w2s(mark.x + Math.cos(mark.a) * v * t, mark.y + Math.sin(mark.a) * v * t, aircraftHeight(mark));
      if (!panelAt(lx, ly, navigationPanels, 9)) {
        // Weapon cue has an open cross, distinct from the pilot frame and course.
        ctx.beginPath();
        ctx.moveTo(lx - 7, ly); ctx.lineTo(lx - 3, ly);
        ctx.moveTo(lx + 3, ly); ctx.lineTo(lx + 7, ly);
        ctx.moveTo(lx, ly - 7); ctx.lineTo(lx, ly - 3);
        ctx.moveTo(lx, ly + 3); ctx.lineTo(lx, ly + 7);
        ctx.strokeStyle = '#111b20'; ctx.lineWidth = 3; ctx.stroke();
        ctx.strokeStyle = '#ffda91'; ctx.lineWidth = 1.3; ctx.stroke();
      }
    }
  }
  // off-screen enemy arrows
  ctx.fillStyle = 'rgba(255,120,90,0.9)';
  for (const e of game.enemies) {
    if (!enemyObserved(game, e)) continue;
    const [sx, sy] = w2s(e.x, e.y, aircraftHeight(e));
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

const statsPanel = { x:12, y:12, w:176, h:44 };
const firing = () => Boolean(keys.Space || fireTouch.active);

function boxClear(x, y, w, h, panels) {
  return x >= 4 && y >= 4 && x + w <= view.W - 4 && y + h <= view.H - 4 &&
    !panels.some(p => p && x < p.x + p.w + 3 && x + w > p.x - 3 &&
      y < p.y + p.h + 3 && y + h > p.y - 3);
}

function panelAt(x, y, panels, pad = 0) {
  return panels.some(p => p && x >= p.x - pad && x <= p.x + p.w + pad &&
    y >= p.y - pad && y <= p.y + p.h + pad);
}

function drawPilotMarker(player, panels) {
  if (game.mode !== 'play') return;
  const bounds = pilotMarkerBounds(player);
  if (!bounds) return;
  const [x, centerY] = w2s(player.x, player.y, aircraftHeight(player));
  // Screen-upright corners identify the pilot even at zero hull or maximum heat.
  // The left spine is the integrated hull meter; its four cells empty top-down.
  const left = x + bounds.left - 7;
  const right = x + bounds.right + 7;
  const y = centerY + bounds.centerY;
  const status = clamp(player.hp / CONFIG.player.hp, 0, 1);
  const heat = clamp(player.heat || 0, 0, 1);
  const activeHeat = player.flight === 'flying' && (heat > .04 || player.overheated || firing());
  ctx.save();
  ctx.lineCap = 'butt';
  let leftBracket = null, rightBracket = null;
  for (const [edge, side] of [[left, -1], [right, 1]]) {
    if (edge < 10 || edge > view.W - 10 || y < 14 || y > view.H - 14 ||
        panelAt(edge, y, panels, 12)) continue;
    const spine = edge + side * 5;
    if (side === -1) leftBracket = spine; else rightBracket = spine;
    const top = y - 9, bottom = y + 9;
    ctx.beginPath();
    ctx.moveTo(edge, top); ctx.lineTo(spine, top); ctx.lineTo(spine, bottom); ctx.lineTo(edge, bottom);
    ctx.strokeStyle = '#09191f'; ctx.lineWidth = 5; ctx.stroke();
    ctx.strokeStyle = '#c5d9d7'; ctx.lineWidth = 1.4; ctx.stroke();
    if (side === -1) {
      for (let i = 0; i < 4; i++) {
        const cell = clamp(status * 4 - i, 0, 1);
        const base = bottom - 1 - i * 4;
        ctx.fillStyle = '#59716e'; ctx.fillRect(spine - 1.5, base - 3, 3, 3);
        ctx.fillStyle = status <= .35 ? '#ff9a82' : '#a2eadb';
        if (cell > 0) ctx.fillRect(spine - 1.5, base - 3 * cell, 3, 3 * cell);
      }
    } else if (activeHeat) {
      ctx.fillStyle = '#09191f'; ctx.fillRect(spine + 3, top - 1, 4, 20);
      ctx.fillStyle = player.overheated ? '#ff9a82' : '#ebbe78';
      ctx.fillRect(spine + 4, bottom - 18 * heat, 2, 18 * heat);
      if (player.overheated) ctx.fillRect(spine + 4, top - 4, 2, 2);
    }
  }
  if (player.flight === 'flying' && status < .85) {
    const labelW = 33, labelH = 23, labelY = Math.round(y - labelH / 2);
    // Add the exact hull readout only when damaged, outside the projected wing.
    // Swap sides when a panel or edge blocks the label, keeping the pilot frame.
    const labelLeft = leftBracket === null ? null : Math.round(leftBracket - labelW - 6);
    const labelRight = rightBracket === null ? null : Math.round(rightBracket + (activeHeat ? 11 : 6));
    for (const [labelX, spine] of [[labelLeft, leftBracket], [labelRight, rightBracket]]) {
      if (labelX === null || !boxClear(labelX, labelY, labelW, labelH, panels)) continue;
      const tint = status <= .35 ? '#ffad98' : '#c3f2e4';
      ctx.fillStyle = '#101e24'; ctx.fillRect(labelX, labelY, labelW, labelH);
      ctx.strokeStyle = tint; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(spine, y); ctx.lineTo(labelX < spine ? labelX + labelW : labelX, y);
      ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillStyle = tint; ctx.font = '700 8px monospace';
      ctx.fillText('HULL', labelX + labelW / 2, labelY + 9);
      ctx.font = '750 11px system-ui';
      ctx.fillText(`${Math.ceil(status * 100)}%`, labelX + labelW / 2, labelY + 20);
      break;
    }
  }
  ctx.restore();
}

function drawNavigation() {
  const { W, H } = view;
  const mw = Math.min(140, Math.max(100, W * .3)), mh = 84, mx = W - mw - 12, my = 12;
  ctx.fillStyle = '#101e24'; rr(mx, my, mw, mh, 3);
  ctx.strokeStyle = '#617579'; ctx.lineWidth = 1; ctx.strokeRect(mx + .5, my + .5, mw - 1, mh - 1);
  drawTheaterMap(ctx, game, {x:mx, y:my, w:mw, h:mh});
  ctx.textAlign='right'; ctx.font='600 9px system-ui'; ctx.fillStyle='#adc6ca'; ctx.fillText('MAP ↗', mx+mw-7,my+mh-5);
  const map = { x: mx, y: my, w: mw, h: mh };
  const reserved = [map, statsPanel];
  if (game.player.flight === 'flying' && game.mode === 'play') {
    reserved.push({ x:W - 130, y:H - 231, w:112, h:56 });
    if (isTouchDevice) reserved.push({ x:W - 130, y:H - 112, w:112, h:56 });
  }
  const notice = flightNotice(game.player);
  if (notice) {
    // The centered toast can wrap on a narrow viewport. Reserve its line box
    // conservatively without forcing a DOM layout read on each frame.
    ctx.save(); ctx.font = '500 12px system-ui';
    const maxW = Math.max(40, W - 32), advance = ctx.measureText(notice).width;
    const toastW = Math.min(maxW, Math.ceil(advance + 32));
    const lines = Math.ceil(advance / Math.max(12, toastW - 32));
    const toastH = 20 + 18 * Math.max(1, lines);
    reserved.push({ x:(W - toastW) / 2, y:H - (H <= 450 ? 14 : 124) - toastH, w:toastW, h:toastH });
    ctx.restore();
  }
  return [...reserved, ...drawArrows(map, reserved)];
}

// Gold is the assigned course, teal the nearest recovery point, red a detected raid.
const ARROWS = { objective: '#edce91', base: '#82dfbc', raid: '#ff8a6b' };
export function hudArrows(game) {
  const p = game.player, arrows = [];
  if (!p || game.mode !== 'play' || p.flight !== 'flying') return arrows;
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  if (game.waypoint) {
    const { title, detail } = flightPresentation(game);
    const site = game.territories.find(t => t.id === game.waypoint.siteId);
    const targetShip = game.ships.find(s => s.id === game.waypoint.shipId);
    const height = targetShip ? 11.5 : site ? 8.5 : 0;
    const progress = site && site.owner !== 'us' && site.progress > 0 ? site.progress / CONFIG.conquest.captureSeconds : 0;
    arrows.push({ kind: 'objective', height, x: game.waypoint.x, y: game.waypoint.y, label: title.toUpperCase(), sub: detail, arrived: coursePhase(game) === 'arrived', progress, arrival: title === 'Return to base' ? 'RECOVERY' : title === 'Circle to capture' ? 'CAPTURE' : 'OBJECTIVE' });
  }
  const bases = availableBases(game).map(b => resolveBase(game, b.id)).filter(Boolean).sort((a, b) => near(p, a) - near(p, b));
  const base = bases[0];
  if (base && !(game.waypoint && near(game.waypoint, base) < 1)) arrows.push({ kind: 'base', height: baseHeight(base), x: base.x, y: base.y, label: 'NEAREST BASE', sub: `${base.kind === 'carrier' ? 'carrier · ' : ''}${flightSeconds(game, base)}s` });
  const raiders = game.enemies.filter(e => e.strike && e.hp > 0 && e.phase !== 'retreat' && !e.rescue && enemyObserved(game, e));
  if (raiders.length) {
    const first = raiders.reduce((a, b) => near(p, a) < near(p, b) ? a : b);
    const formation = raiders.filter(e => e.targetBaseId === first.targetBaseId), target = raidTarget(first.targetBaseId);
    arrows.push({ kind: 'raid', height: aircraftHeight(first), x: first.x, y: first.y, label: `RAID ×${formation.length}`, sub: (target?.name || 'friendly base').toUpperCase() });
  }
  return arrows;
}
function drawArrows(map, reserved) {
  const { W, H } = view;
  const arrows = hudArrows(game);
  const main = arrows.find(a => a.kind === 'objective') || arrows.find(a => a.kind === 'base') || arrows[0];
  if (!main) return [];
  const secondary = arrows.filter(a => a !== main && (!firing() || a.kind === 'raid'));
  const gapStart = statsPanel.x + statsPanel.w + 10, gapEnd = map.x - 10;
  const gap = gapEnd - gapStart;
  const compact = gap < 224;
  const top = compact ? map.y + map.h + 10 : map.y;
  const height = secondary.length ? 52 : 34;
  let width = compact ? Math.min(294, W - 28) : Math.min(294, gap);
  let left = compact ? Math.round((W - width) / 2)
    : Math.round(clamp((W - width) / 2, gapStart, gapEnd - width));
  if (compact && !boxClear(left, top, width, height, reserved)) {
    const rightColumn = reserved.find(p => p.x === W - 130 &&
      p.y < top + height + 3 && p.y + p.h > top - 3);
    if (rightColumn) {
      left = 14;
      width = Math.min(width, rightColumn.x - left - 7);
    }
  }
  const panel = { x:left, y:top, w:width, h:height };
  const [px, py] = w2s(game.player.x, game.player.y, aircraftHeight(game.player));
  const [sx, sy] = w2s(main.x, main.y, main.height);
  const dx = sx - px, dy = sy - py;
  const angle = Math.atan2(dy, dx);
  const color = ARROWS[main.kind];
  ctx.save();
  if (main.arrived) {
    // Arrival is a specific contact marker. An active capture alone has progress.
    if (sx > 30 && sx < W - 30 && sy > 30 && sy < H - 30 &&
        !panelAt(sx, sy, [...reserved, panel], 27)) {
      ctx.strokeStyle = '#101b22'; ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(sx - 15, sy - 7); ctx.lineTo(sx - 21, sy); ctx.lineTo(sx - 15, sy + 7);
      ctx.moveTo(sx + 15, sy - 7); ctx.lineTo(sx + 21, sy); ctx.lineTo(sx + 15, sy + 7);
      ctx.stroke(); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.font = '700 8px monospace'; ctx.textAlign = 'center';
      ctx.strokeStyle = '#0d191f'; ctx.lineWidth = 3; ctx.strokeText(main.arrival, sx, sy + 21);
      ctx.fillStyle = color; ctx.fillText(main.arrival, sx, sy + 21);
      if (main.arrival === 'CAPTURE') {
        ctx.fillStyle = '#213339'; ctx.fillRect(sx - 18, sy + 25, 36, 3);
        ctx.fillStyle = color; ctx.fillRect(sx - 18, sy + 25, 36 * clamp(main.progress, 0, 1), 3);
      }
    }
  } else {
    // Follow the air current to the course. Keep its tail clear of the pilot.
    const d = Math.hypot(dx, dy), reach = Math.min(104, d);
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const tail = Math.max(40, reach - 45);
    const x = px + ux * reach, y = py + uy * reach;
    const fromX = px + ux * tail, fromY = py + uy * tail;
    const length = reach - tail;
    if (length >= 16 && boxClear(Math.min(x, fromX) - 8, Math.min(y, fromY) - 8,
        Math.abs(x - fromX) + 16, Math.abs(y - fromY) + 16, [...reserved, panel])) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
      ctx.strokeStyle = '#142022'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(-8, -4); ctx.lineTo(0, 0); ctx.lineTo(-8, 4); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
      // The strokes increase in weight toward the tip so direction survives
      // at a glance, including when the main stroke crosses pale surf.
      const traces = [[-length, 2.5, -.56 * length, 1.5], [-.73 * length, -3, -10, -1]];
      ctx.fillStyle = color;
      traces.forEach(([x0, y0, x1, y1], i) => {
        ctx.globalAlpha = i ? .82 : .46;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2, y0, x1, y1);
        ctx.lineTo(x1, y1 + (i ? 1.9 : 1.25)); ctx.closePath(); ctx.fill();
      });
      ctx.restore();
    }
  }

  // One compact instrument strip. Secondary reports never add another world arrow.
  ctx.fillStyle = '#101e24'; rr(left, top, width, panel.h, 3);
  ctx.fillStyle = color; ctx.fillRect(left, top, 3, 34);
  ctx.textAlign = 'left'; ctx.font = '700 8px monospace';
  ctx.fillText(main.arrived ? 'ON STATION' : 'ACTIVE COURSE', left + 12, top + 12);
  ctx.font = '750 11px system-ui'; ctx.fillStyle = '#f2eee1';
  ctx.fillText(main.label + (main.sub ? '  ·  ' + main.sub : ''), left + 12, top + 27, width - 34);
  ctx.save(); ctx.translate(left + width - 15, top + 17); ctx.rotate(angle);
  ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(3, 0); ctx.lineTo(-4, 4);
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
  if (secondary.length) {
    ctx.fillStyle = '#39484a'; ctx.fillRect(left + 12, top + 34, width - 24, 1);
    ctx.font = '650 8px system-ui';
    const span = (width - 24) / secondary.length;
    secondary.forEach((report, i) => {
      ctx.fillStyle = ARROWS[report.kind];
      ctx.fillText(report.label + (report.sub ? '  ·  ' + report.sub : ''), left + 12 + span * i, top + 46, span - 5);
    });
  }
  ctx.restore();
  return [panel];
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



function flightNotice(player) {
  if (!player || game.mode !== 'play') return '';
  if (player.flight === 'flying' && player.landingHint) return player.landingHint;
  return game.messageTime > 0 && player.flight !== 'landed' &&
    !/spotted|follow the gold|select it on the map/i.test(game.message) ? game.message : '';
}

export function drawMenus() {
  const playing = game.mode === 'play', p = game.player;
  drawSortie(p, playing);
  el('flight-hud').hidden = !playing;
  el('flight-controls').hidden = !playing;
  el('menu').hidden = playing;
  el('fire-indicator').hidden = !playing || !isTouchDevice || p?.flight !== 'flying';
  const cooling = Boolean(playing && p.flight === 'flying' && p.overheated);
  const fireIndicator = el('fire-indicator');
  fireIndicator.dataset.cooling = String(cooling);
  fireIndicator.dataset.firing = String(fireTouch.active && !cooling);
  text('fire-label', cooling ? 'GUNS HOT' : 'FIRE');
  text('fire-hint', cooling ? 'COOLING' : 'HOLD RIGHT');
  if (playing) {
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
    text('heat-label', cooling ? 'GUNS COOLING' : 'HEAT');
    el('heat-fill').style.width = `${p.heat * 100}%`;
    el('heat-fill').style.background = p.overheated ? '#f18f7c' : '#e5b76f';
    // One line at the bottom: the landing hint while lining up, otherwise the latest message
    // (not deck status, which the landed panel already shows).
    const notice = flightNotice(p);
    el('toast').hidden = !notice; text('toast', notice);
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
  if (report.wing) rows.push(['Wingman kills / lost', `${report.wing.kills} / ${report.wing.lost}`]);
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
