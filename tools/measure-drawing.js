#!/usr/bin/env node
/*
 * Measure an aircraft three-view drawing (SVG or PNG) by scanning its silhouette.
 *
 *   node tools/measure-drawing.js tools/reference/F4U-1_three-view.svg --span 12.5 \
 *        --top 0,600,1320,2198 --side 0,0,1320,600 --front 1320,600,2000,2198
 *
 * --span    real wingspan in metres; sets the scale from the plan view's
 *           tip-to-tip extent.
 * --width   pixel width the drawing is rendered at (default 2000). All
 *           rectangles below are in that pixel space.
 * --top     rectangle (x0,y0,x1,y1) containing the plan view, drawn
 *           nose-left with the span vertical. Required.
 * --side    rectangle containing the side view, nose-left. Optional.
 * --front   rectangle containing the front view, span vertical. Optional.
 * --step    sample spacing in pixels (default 40).
 *
 * Prints, in metres aft of the spinner tip / from the centreline: the
 * leading and trailing edge at each span station, the silhouette width at
 * each fuselage station, and the height profiles from the side and front
 * views. Panel lines, landing gear and the antenna wire are part of the
 * silhouette, so read the numbers with the drawing open; they guide a spec
 * table for tools/build-aircraft.mjs rather than replace one.
 *
 * This is how tools/reference/F4U-1.md was produced. Needs the same
 * headless Chromium as the playtest.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--') && !/^[\d,]+$/.test(a));
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const rect = s => (s ? s.split(',').map(Number) : null);
const span = Number(opt('--span', 0));
const width = Number(opt('--width', 2000));
const top = rect(opt('--top')), side = rect(opt('--side')), front = rect(opt('--front'));
const step = Number(opt('--step', 40));
if (!file || !span || !top) {
  console.error('usage: node tools/measure-drawing.js <drawing.svg|png> --span <m> --top x0,y0,x1,y1 [--side ...] [--front ...] [--width px] [--step px]');
  process.exit(1);
}
const MIME = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' };
const dataUrl = `data:${MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'};base64,${fs.readFileSync(file).toString('base64')}`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: width } });
  await page.setContent(`<body style="margin:0"><img src="${dataUrl}" style="width:${width}px;display:block"></body>`);
  const data = await page.evaluate(async ({ top, side, front }) => {
    const img = document.querySelector('img');
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, img.width, img.height);
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data, W = canvas.width, H = canvas.height;
    const ink = (x, y) => px[(y * W + x) * 4] < 140;
    const scan = ([x0, y0, x1, y1]) => {
      x1 = Math.min(x1, W); y1 = Math.min(y1, H);
      const rows = [], cols = [];
      for (let y = y0; y < y1; y++) { let lo = -1, hi = -1; for (let x = x0; x < x1; x++) if (ink(x, y)) { if (lo < 0) lo = x; hi = x; } rows.push([lo, hi]); }
      for (let x = x0; x < x1; x++) { let lo = -1, hi = -1; for (let y = y0; y < y1; y++) if (ink(x, y)) { if (lo < 0) lo = y; hi = y; } cols.push([lo, hi]); }
      return { rows, cols, x0, y0 };
    };
    return { size: [W, H], top: scan(top), side: side ? scan(side) : null, front: front ? scan(front) : null };
  }, { top, side, front });
  await browser.close();

  // Plan view. Column/row arrays are relative to the rectangle origin; the
  // values stored in them are absolute pixel coordinates.
  const t = data.top;
  const inked = t.cols.map((c, i) => [i, c]).filter(([, c]) => c[0] >= 0);
  const tipTop = Math.min(...inked.map(([, c]) => c[0])), tipBottom = Math.max(...inked.map(([, c]) => c[1]));
  const scale = span / (tipBottom - tipTop);
  const nose = Math.min(...inked.map(([i]) => i)), tail = Math.max(...inked.map(([i]) => i));
  // Centreline from the fuselage just behind the nose rather than the tip
  // midpoint: pitot tubes and drawing offsets skew the tips.
  const noseCols = t.cols.slice(nose + 10, nose + 40).filter(c => c[0] >= 0);
  const centre = noseCols.reduce((s, c) => s + (c[0] + c[1]) / 2, 0) / noseCols.length;
  const m = px => (px * scale).toFixed(2);
  console.log(`rendered ${data.size[0]}x${data.size[1]} px; scale ${scale.toFixed(5)} m/px; span rows ${tipTop}-${tipBottom}; `
    + `nose column ${nose + t.x0}; length ${m(tail - nose)} m`);
  console.log('\n# plan view: span station -> leading edge, trailing edge (m aft of spinner tip)');
  for (let y = Math.round(centre); y < tipBottom; y += step) {
    const [lo, hi] = t.rows[y - t.y0]; if (lo < 0) continue;
    console.log(`  y=${m(y - centre).padStart(5)}  le=${m(lo - t.x0 - nose).padStart(5)}  te=${m(hi - t.x0 - nose).padStart(5)}  extent=${m(hi - lo)}`);
  }
  console.log('\n# plan view: fuselage station -> silhouette half-widths (port, starboard)');
  for (let x = nose; x <= tail; x += step) {
    const [lo, hi] = t.cols[x]; if (lo < 0) continue;
    console.log(`  x=${m(x - nose).padStart(5)}  ${m(centre - lo).padStart(6)}  ${m(hi - centre).padStart(6)}`);
  }
  if (data.side) {
    const s = data.side;
    const noseS = s.cols.findIndex(c => c[0] >= 0);
    const axisCols = s.cols.slice(noseS + 5, noseS + 25).filter(c => c[0] >= 0);
    const axis = axisCols.reduce((a, c) => a + (c[0] + c[1]) / 2, 0) / axisCols.length;
    console.log('\n# side view: fuselage station -> top, bottom of silhouette (m above the spinner axis)');
    for (let x = noseS; x < s.cols.length; x += step) {
      const [lo, hi] = s.cols[x]; if (lo < 0) continue;
      console.log(`  x=${m(x - noseS).padStart(5)}  top=${m(axis - lo).padStart(6)}  bottom=${m(axis - hi).padStart(6)}`);
    }
  }
  if (data.front) {
    const f = data.front;
    console.log('\n# front view: span station -> lowest, highest ink (m from the rectangle\'s left edge; subtract the hub height)');
    for (let y = Math.round(centre); y < f.y0 + f.rows.length; y += step) {
      const [lo, hi] = f.rows[y - f.y0] || [-1, -1]; if (lo < 0) continue;
      console.log(`  y=${m(y - centre).padStart(5)}  low=${m(lo - f.x0).padStart(5)}  high=${m(hi - f.x0)}`);
    }
  }
})();
