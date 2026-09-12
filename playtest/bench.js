#!/usr/bin/env node
/*
 * Render cost benchmark. Boots the game headless on SwiftShader (software
 * rasterization), pins each quality level, and times graphics.render() over
 * a fixed island-heavy view. Software rendering makes fragment-shader cost
 * show up directly as milliseconds, so this is a fair relative measure of
 * fill-rate load — the thing a cheap tablet GPU is bound by — even though the
 * absolute numbers are nothing like real hardware.
 *
 * Usage: node playtest/bench.js [--frames 40] [--width 1333 --height 800 --dpr 1.5]
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const argVal = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const FRAMES = Number(argVal('--frames', 40));
const WIDTH = Number(argVal('--width', 1333)), HEIGHT = Number(argVal('--height', 800)), DPR = Number(argVal('--dpr', 1.5));
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };

(async () => {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/pacific-skies(?=\/)/, '');
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DPR, hasTouch: true, isMobile: true });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/pacific-skies/?quality=1`);
  await page.waitForFunction(() => window.__game?.rendering?.ready || window.__game?.rendering?.error, null, { timeout: 60000 });
  await page.evaluate(() => { window.__game.setSeed(1942); window.__game.startGame(); });
  await page.waitForTimeout(300);
  const results = await page.evaluate(async frames => {
    const { graphics, game, view, CONFIG } = window.__game;
    const out = [];
    const raf = () => new Promise(r => requestAnimationFrame(r));
    const pixel = new Uint8Array(4);
    for (let level = 0; level < CONFIG.render.quality.levels.length; level++) {
      graphics.quality.set(level);
      // Warm up: shader compiles and chunk builds land here, not in the timing.
      for (let i = 0; i < 6; i++) { graphics.render(game, view, 1 / 60, 0, 0); await raf(); }
      let total = 0, worst = 0;
      for (let i = 0; i < frames; i++) {
        game.time += 1 / 60;
        const t0 = performance.now();
        graphics.render(game, view, 1 / 60, 0, 0);
        { const gl = graphics.renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); }
        const ms = performance.now() - t0;
        total += ms; worst = Math.max(worst, ms);
        await raf();
      }
      out.push({ level, pixelRatio: graphics.diagnostics.pixelRatio, ms: +(total / frames).toFixed(2), worst: +worst.toFixed(1),
        drawCalls: graphics.diagnostics.drawCalls, triangles: graphics.diagnostics.triangles, chunks: graphics.diagnostics.chunks });
    }
    return out;
  }, FRAMES);
  console.log(`view ${WIDTH}x${HEIGHT} @${DPR} · ${FRAMES} frames per level · SwiftShader ms/frame`);
  for (const r of results) console.log(`level ${r.level}  ratio ${r.pixelRatio}  avg ${r.ms} ms  worst ${r.worst} ms  draws ${r.drawCalls}  tris ${r.triangles}  chunks ${r.chunks}`);
  if (errors.length) { console.log('errors:', errors); process.exitCode = 1; }
  await browser.close(); server.close();
})();
