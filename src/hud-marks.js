// Marks for the in-flight HUD, drawn on the 2D overlay as a plotting officer
// would draw them: grease pencil on the glass (rings, ticks, wind streaks) and
// small black placards for words. Everything carries a dark casing or halo so
// it holds over a bright runway and over dark water alike. No shadowBlur, no
// gradients; paths only.
import { ctx, view } from './canvas.js';
import { CONFIG } from './config.js';
import { TAU, clamp } from './util.js';

const HUD = CONFIG.hud;
export const INK = {
  case: 'rgba(6,16,22,.86)', plate: 'rgba(12,19,22,.88)', cream: '#f6ecc9', gold: '#ffd66b',
  wind: '#fff3c4', lume: '#aeeaba', amber: '#f5b944', red: '#ff6f52', teal: '#86dcc6', dim: 'rgba(246,236,201,.5)',
};
const FACE = '"Avenir Next Condensed","Roboto Condensed","Arial Narrow",system-ui,-apple-system,"Segoe UI",sans-serif';
export const font = (size, weight = 800) => `${weight} ${size}px ${FACE}`;

// --- text ------------------------------------------------------------------
const widths = new Map();
export function textWidth(str, size, weight = 800) {
  const key = size + '|' + weight + '|' + str;
  let w = widths.get(key);
  if (w === undefined) {
    if (widths.size > 160) widths.clear();
    ctx.font = font(size, weight); w = ctx.measureText(str).width; widths.set(key, w);
  }
  return w;
}
// Halo text: readable on any ground without a plate.
export function inkText(str, x, y, size, color, align = 'center', weight = 800) {
  ctx.font = font(size, weight); ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round'; ctx.lineWidth = 2.6; ctx.strokeStyle = INK.case; ctx.strokeText(str, x, y);
  ctx.fillStyle = color; ctx.fillText(str, x, y);
}

// --- label placement ---------------------------------------------------------
// Keep-out boxes: the player's ring, the lead pipper, touch controls and labels
// already placed this frame. Boxes are pooled; nothing is allocated per frame.
const boxes = [];
let used = 0;
export function resetKeepouts() { used = 0; }
export function keep(x, y, w, h) {
  const b = boxes[used] || (boxes[used] = { x: 0, y: 0, w: 0, h: 0 });
  b.x = x; b.y = y; b.w = w; b.h = h; used++;
}
export function blocked(x, y, w, h) {
  for (let i = 0; i < used; i++) { const b = boxes[i]; if (x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y) return true; }
  return false;
}
const TRY_ANGLE = [0, .55, -.55, 1.1, -1.1, 1.7, -1.7, 2.4, -2.4, Math.PI], TRY_DIST = [1, 1.6, 2.3];
const spot = { x: 0, y: 0 };
// Finds a free box of w×h pushed `dist` away from an anchor along `angle`,
// swinging round the anchor when the straight spot is taken. Reserves it.
export function placeLabel(w, h, ax, ay, angle, dist) {
  const { W, H } = view;
  let fx = 0, fy = 0, found = false;
  search: for (const scale of TRY_DIST) for (const swing of TRY_ANGLE) {
    const a = angle + swing, dx = Math.cos(a), dy = Math.sin(a);
    const reach = dist * scale + Math.abs(dx) * w / 2 + Math.abs(dy) * h / 2;
    const x = clamp(ax + dx * reach - w / 2, 8, W - w - 8), y = clamp(ay + dy * reach - h / 2, 8, H - h - 8);
    if (!found && scale === 1 && swing === 0) { fx = x; fy = y; }
    if (!blocked(x - 3, y - 3, w + 6, h + 6)) { fx = x; fy = y; found = true; break search; }
  }
  keep(fx, fy, w, h);
  spot.x = fx; spot.y = fy; return spot;
}
// Where a ray from (px,py) leaves the playfield's safe frame, stepped back
// toward the player until it is clear of the corner instruments.
const rim = { x: 0, y: 0, t: 0 };
export function edgePoint(px, py, angle, rightInset) {
  const { W, H } = view, m = HUD.edge.margin, dx = Math.cos(angle), dy = Math.sin(angle);
  const tx = dx > 0 ? (W - rightInset - px) / dx : dx < 0 ? (m - px) / dx : Infinity;
  const ty = dy > 0 ? (H - m - py) / dy : dy < 0 ? (m - py) / dy : Infinity;
  let t = Math.max(0, Math.min(tx, ty));
  for (let i = 0; i < 14 && t > 60 && blocked(px + dx * t - 17, py + dy * t - 17, 34, 34); i++) t -= 14;
  rim.x = px + dx * t; rim.y = py + dy * t; rim.t = t; return rim;
}

// --- placard -----------------------------------------------------------------
// A cockpit placard: black plate, thin engraved border, a coloured flag at the
// left, the action in cream and its number after a rule.
const PAD = 7, FLAG = 4;
export function placardWidth(label, sub, size) {
  return FLAG + PAD * 2 + textWidth(label, size) + (sub ? 11 + textWidth(sub, size, 700) : 0);
}
export const placardHeight = size => size + 10;
let hatch = null;
function hazard() {
  if (hatch) return hatch;
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const g = c.getContext('2d'); g.fillStyle = INK.red; g.fillRect(0, 0, 8, 8);
  g.strokeStyle = '#1a1210'; g.lineWidth = 2.6; g.beginPath();
  for (let i = -8; i <= 8; i += 8) { g.moveTo(i, 8); g.lineTo(i + 8, 0); }
  g.stroke(); hatch = ctx.createPattern(c, 'repeat'); return hatch;
}
export function placard(label, sub, x, y, size, accent, striped = false) {
  const w = placardWidth(label, sub, size), h = placardHeight(size), lw = textWidth(label, size);
  ctx.fillStyle = INK.plate; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = accent; ctx.lineWidth = 1; ctx.globalAlpha *= .75; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1); ctx.globalAlpha /= .75;
  ctx.fillStyle = striped ? hazard() : accent; ctx.fillRect(x, y, FLAG, h);
  ctx.font = font(size); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = INK.cream;
  ctx.fillText(label, x + FLAG + PAD, y + h / 2 + .5);
  if (sub) {
    const rx = x + FLAG + PAD + lw + 5.5;
    ctx.fillStyle = INK.dim; ctx.fillRect(rx, y + 4, 1, h - 8);
    ctx.font = font(size, 700); ctx.fillStyle = accent; ctx.fillText(sub, rx + 5.5, y + h / 2 + .5);
  }
  ctx.textBaseline = 'alphabetic';
}

// --- the rig -------------------------------------------------------------------
// Status worn by the aircraft itself. The ring turns with the heading and
// flattens in a bank. Aft: hull, five cells a side, draining from the wings
// toward the tail. Fore: gun heat growing outward from the nose; when the guns
// lock it becomes a hatched band with a cross on the nose.
function arcCells(from, to, anticlockwise, radius, cell, gap) {
  ctx.setLineDash([cell - gap, gap]); ctx.lineDashOffset = cell - gap / 2;
  ctx.beginPath(); ctx.arc(0, 0, radius, from, to, anticlockwise); ctx.stroke();
}
export function drawRig(sx, sy, heading, hull, heat, overheated, time, bank, grounded) {
  const R = HUD.rig, r = R.radius, half = R.hullHalfArc, cell = r * half / R.cells;
  const state = hull * 100 <= R.low ? 2 : hull * 100 <= R.worn ? 1 : 0;
  const colour = state === 2 ? INK.red : state === 1 ? INK.amber : INK.lume;
  const beat = .5 + .5 * Math.sin(time * R.pulse);
  ctx.save(); ctx.translate(sx, sy); ctx.rotate(heading); ctx.scale(1, 1 - R.bankSquash * Math.min(1, Math.abs(bank)));
  ctx.lineCap = 'butt';
  // casing, then the empty cells as a thin line, then the lit cells
  ctx.strokeStyle = INK.case; ctx.lineWidth = R.width + 3.5;
  ctx.beginPath(); ctx.arc(0, 0, r, Math.PI - half - .04, Math.PI + half + .04); ctx.stroke();
  ctx.strokeStyle = INK.dim; ctx.lineWidth = 1.5;
  arcCells(Math.PI, Math.PI + half, false, r, cell, R.cellGap); arcCells(Math.PI, Math.PI - half, true, r, cell, R.cellGap);
  const lit = half * clamp(hull, .03, 1);
  ctx.strokeStyle = colour; ctx.lineWidth = state === 2 ? R.width + beat * 1.5 : R.width;
  arcCells(Math.PI, Math.PI + lit, false, r, cell, R.cellGap); arcCells(Math.PI, Math.PI - lit, true, r, cell, R.cellGap);
  if (state === 2) {
    // critical: a serrated outer ring, so the state is a shape as well as a colour
    ctx.globalAlpha = .45 + .55 * beat; ctx.lineWidth = 4; ctx.setLineDash([2, 4.5]); ctx.lineDashOffset = 0;
    ctx.strokeStyle = INK.case; ctx.beginPath(); ctx.arc(0, 0, r + 7.5, Math.PI - half, Math.PI + half); ctx.stroke();
    ctx.strokeStyle = INK.red; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r + 7.5, Math.PI - half, Math.PI + half); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.setLineDash([]);
  if (!grounded && (heat > .04 || overheated)) {
    const hh = R.heatHalfArc, span = hh * clamp(heat, .08, 1);
    ctx.strokeStyle = INK.case; ctx.lineWidth = R.heatWidth + 3;
    ctx.beginPath(); ctx.arc(0, 0, r, -hh - .03, hh + .03); ctx.stroke();
    if (overheated) {
      ctx.globalAlpha = .55 + .45 * beat; ctx.strokeStyle = INK.red; ctx.lineWidth = R.heatWidth + 3; ctx.setLineDash([3, 2.5]);
      ctx.beginPath(); ctx.arc(0, 0, r, -span, span); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      // the lock: a cross over the nose
      const cx = r + 11, s = 4.5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = INK.case; ctx.lineWidth = 5.5; ctx.beginPath(); ctx.moveTo(cx - s, -s); ctx.lineTo(cx + s, s); ctx.moveTo(cx - s, s); ctx.lineTo(cx + s, -s); ctx.stroke();
      ctx.strokeStyle = INK.red; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(cx - s, -s); ctx.lineTo(cx + s, s); ctx.moveTo(cx - s, s); ctx.lineTo(cx + s, -s); ctx.stroke();
      ctx.lineCap = 'butt';
    } else {
      const hot = heat >= R.heatWarn;
      ctx.strokeStyle = hot ? INK.amber : INK.cream; ctx.lineWidth = R.heatWidth;
      ctx.beginPath(); ctx.arc(0, 0, r, -span, span); ctx.stroke();
      // limit stops: where the guns lock. Shown once the barrels are warm.
      ctx.strokeStyle = hot ? INK.red : INK.dim; ctx.lineWidth = 2;
      ctx.beginPath();
      for (const s of [-1, 1]) { ctx.moveTo(Math.cos(hh * s) * (r - 5), Math.sin(hh * s) * (r - 5)); ctx.lineTo(Math.cos(hh * s) * (r + 6), Math.sin(hh * s) * (r + 6)); }
      ctx.stroke();
    }
  }
  ctx.restore();
  // The figure appears only when it matters; the corner gauge has it always.
  if (state === 2) {
    const d = r + 19;
    inkText(Math.ceil(hull * 100) + '%', sx - Math.cos(heading) * d, sy - Math.sin(heading) * d + 4.5, 13, INK.red, 'center', 900);
  }
}

// --- guiding wind --------------------------------------------------------------
// Streaks of slipstream that blow past the aircraft toward the objective, each
// with its shadow on the ground beneath. They flow; the chevrons at their head
// hold the bearing between gusts.
function streaks(angle, time, inner, outer, count, alpha, fill, outline) {
  const Wd = HUD.wind, run = outer - inner;
  ctx.rotate(angle); ctx.fillStyle = fill; ctx.strokeStyle = INK.case; ctx.lineWidth = 1.2; ctx.lineJoin = 'round';
  for (let i = 0; i < count; i++) {
    const phase = (time * Wd.speed + i / count + (i % 2) * .13) % 1;
    const lane = (i - (count - 1) / 2) * Wd.lane, len = Math.min(Wd.length, run * .7);
    const head = inner + phase * (run + len * .4), tail = Math.max(inner, head - len), tip = Math.min(head, outer);
    if (tip - tail < 6) continue;
    // a dart: fine at the tail, full at the shoulder, pointed at the head
    const mid = (tail + tip) / 2, bend = ((i * 37) % 5 - 2) * 1.5, t = Wd.thickness * (.8 + (i % 3) * .2), end = lane + bend * .4, shoulder = tip - t * 2.6;
    ctx.globalAlpha = alpha * Math.min(1, Math.sin(Math.PI * phase) * 2.6 + .3);
    ctx.beginPath(); ctx.moveTo(tail, lane);
    ctx.quadraticCurveTo(mid, lane + bend - t * .5, shoulder, end - t); ctx.lineTo(tip, end); ctx.lineTo(shoulder, end + t);
    ctx.quadraticCurveTo(mid, lane + bend + t * .5, tail, lane); if (outline) ctx.stroke(); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
export function drawWind(px, py, angle, time, inner, outer, count, alpha) {
  ctx.save(); ctx.translate(px + 1.5, py + 2.5); streaks(angle, time, inner, outer, count, alpha * .7, INK.case, false); ctx.restore();
  ctx.save(); ctx.translate(px, py); streaks(angle, time, inner, outer, count, alpha, INK.wind, true); ctx.restore();
}
// Double chevron at the head of the wind.
export function drawChevrons(x, y, angle, colour, size = 6, alpha = 1) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = alpha;
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? colour : INK.case; ctx.lineWidth = pass ? 3 : 6.2;
    ctx.beginPath();
    ctx.moveTo(-size, -size); ctx.lineTo(0, 0); ctx.lineTo(-size, size);
    ctx.moveTo(-size + 7, -size); ctx.lineTo(7, 0); ctx.lineTo(-size + 7, size);
    ctx.stroke();
  }
  ctx.restore();
}

// --- objective site ------------------------------------------------------------
// Arrived: a plotted target ring with four ticks. Capturing: a stopwatch face
// that fills clockwise while wind circles it, showing the orbit to fly.
export function drawSiteMark(sx, sy, progress, time) {
  const S = HUD.site, r = S.ring;
  ctx.save(); ctx.translate(sx, sy); ctx.lineCap = 'butt';
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? INK.gold : INK.case; ctx.lineWidth = pass ? 2 : 5;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
    ctx.beginPath();
    if (progress >= 0) for (let i = 0; i < S.ticks; i++) { const a = i / S.ticks * TAU, c = Math.cos(a), s = Math.sin(a); ctx.moveTo(c * (r - 5), s * (r - 5)); ctx.lineTo(c * (r - 1), s * (r - 1)); }
    else for (let i = 0; i < 4; i++) { const a = i / 4 * TAU, c = Math.cos(a), s = Math.sin(a); ctx.moveTo(c * (r - 6), s * (r - 6)); ctx.lineTo(c * (r + 8), s * (r + 8)); }
    ctx.stroke();
  }
  if (progress >= 0) {
    const end = -Math.PI / 2 + TAU * clamp(progress, 0, 1);
    ctx.strokeStyle = INK.case; ctx.lineWidth = 9; ctx.beginPath(); ctx.arc(0, 0, r - 9, -Math.PI / 2 - .04, end + .04); ctx.stroke();
    ctx.strokeStyle = INK.gold; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, 0, r - 9, -Math.PI / 2, end); ctx.stroke();
    // sweep hand
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? INK.cream : INK.case; ctx.lineWidth = pass ? 2 : 4.5;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(end) * (r - 2), Math.sin(end) * (r - 2)); ctx.stroke();
    }
    // circling wind: three gusts chasing clockwise round the site
    const o = S.orbit, spin = time * S.orbitSpeed;
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? INK.cream : INK.case; ctx.lineWidth = pass ? 2.4 : 5;
      for (let i = 0; i < 3; i++) {
        const a = spin + i * TAU / 3, b = a + 1.15;
        ctx.beginPath(); ctx.arc(0, 0, o, a, b); ctx.stroke();
        const hx = Math.cos(b) * o, hy = Math.sin(b) * o, t = b + Math.PI / 2;
        ctx.beginPath(); ctx.moveTo(hx - Math.cos(t - .6) * 6, hy - Math.sin(t - .6) * 6); ctx.lineTo(hx, hy); ctx.lineTo(hx - Math.cos(t + .6) * 6, hy - Math.sin(t + .6) * 6); ctx.stroke();
      }
    }
  }
  ctx.restore();
}

// --- rim cues ------------------------------------------------------------------
// Secondary bearings ride the edge of the playfield, well away from the wind.
export function drawBaseCue(x, y, angle, alpha, bold) {
  // the chart symbol for an airfield (a ring crossed by its runway) and a tick toward it
  const c = Math.cos(angle), s = Math.sin(angle), r = bold ? 7 : 6;
  ctx.save(); ctx.translate(x, y); ctx.globalAlpha = alpha; ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? INK.teal : INK.case; ctx.lineWidth = pass ? (bold ? 2.4 : 1.8) : (bold ? 5.4 : 4.6);
    ctx.beginPath(); ctx.arc(-c * 8, -s * 8, r, 0, TAU); ctx.moveTo(-c * 8 - r - 3, -s * 8); ctx.lineTo(-c * 8 + r + 3, -s * 8);
    ctx.moveTo(c * 3 - s * 5, s * 3 + c * 5); ctx.lineTo(c * 8, s * 8); ctx.lineTo(c * 3 + s * 5, s * 3 - c * 5); ctx.stroke();
  }
  ctx.restore();
}
export function drawRaidCue(x, y, angle, time) {
  const beat = .5 + .5 * Math.sin(time * 9), s = 10 + beat * 2;
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.lineJoin = 'round';
  ctx.fillStyle = INK.red; ctx.strokeStyle = INK.case; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(-s * .7, -s * .85); ctx.lineTo(-s * .7, s * .85); ctx.closePath(); ctx.stroke(); ctx.fill();
  // two bars behind the head: reads as a warning without its colour
  ctx.lineCap = 'butt';
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? INK.red : INK.case; ctx.lineWidth = pass ? 3 : 6;
    ctx.beginPath(); ctx.moveTo(-s * .7 - 6, -s * .7); ctx.lineTo(-s * .7 - 6, s * .7); ctx.moveTo(-s * .7 - 12, -s * .5); ctx.lineTo(-s * .7 - 12, s * .5); ctx.stroke();
  }
  ctx.restore();
}
export function drawEnemyArrow(x, y, angle) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.lineJoin = 'round';
  ctx.fillStyle = INK.red; ctx.strokeStyle = INK.case; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-5, -5.5); ctx.lineTo(-5, 5.5); ctx.closePath(); ctx.stroke(); ctx.fill();
  ctx.restore();
}
// Small bar under a target: dark case, cream outline, coloured fill.
export function drawBar(x, y, w, fraction, colour) {
  ctx.fillStyle = INK.case; ctx.fillRect(x - 1.5, y - 1.5, w + 3, 7);
  ctx.fillStyle = colour; ctx.fillRect(x, y, w * clamp(fraction, 0, 1), 4);
}
