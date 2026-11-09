#!/usr/bin/env node
// Fixed seeded scenes at phone size, captured with the whole HUD, then timed.
// The game is loaded with ?manualFrames so no RAF loop competes: the picture
// is a pure function of the source tree. Scene fixtures for the five graphics
// scenes match codex/graphics-hill-climb's playtest/graphics.cjs so captures
// from the two climbs can sit in the same judging packet.
//
//   CLIMB_OUT=dir  CLIMB_SET=graphics|hud|all  CLIMB_ONLY=phone-coast,hud-fight  CLIMB_SAMPLES=60
//   node playtest/climb/capture.cjs
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.resolve(process.env.CLIMB_OUT || path.join(ROOT, 'playtest/shots/climb'));
const SET = process.env.CLIMB_SET || 'all', SAMPLES = Number(process.env.CLIMB_SAMPLES || 60);
const PHONE = { width: 852, height: 393 }, PORTRAIT = { width: 393, height: 852 };
const GRAPHICS = ['airfield', 'coast', 'fleet', 'dogfight', 'stress'].flatMap(scene => [
  { name: `phone-${scene}`, scene, quality: 2, view: PHONE, set: 'graphics' },
  { name: `fallback-${scene}`, scene, quality: 4, view: PHONE, set: 'graphics' }]);
const HUD = [
  ['hud-transit', PHONE], ['hud-fight', PHONE], ['hud-critical', PHONE], ['hud-capture', PHONE],
  ['hud-raid', PHONE], ['hud-landed', PHONE], ['hud-fight', PORTRAIT], ['hud-transit', PORTRAIT],
].map(([scene, view]) => ({ name: scene + (view === PORTRAIT ? '-portrait' : ''), scene, quality: 2, view, set: 'hud' }));
const ONLY = process.env.CLIMB_ONLY?.split(',');
const SHOTS = [...GRAPHICS, ...HUD].filter(s => ONLY ? ONLY.includes(s.name) : SET === 'all' || s.set === SET);

// Runs in the page. Everything is placed by hand; simulation stays frozen.
async function stage({ scene }) {
  const api = window.__game, { game: g, graphics, view, CONFIG } = api;
  api.setSeed(1942); api.startGame();
  api.update(0);                                   // lets guidance pick its first objective
  g.time = 12; g.messageTime = 0;
  const home = g.airfields.find(f => f.id === 'home-airfield');
  let x = home.x, y = home.y;
  if (scene === 'coast' || scene === 'hud-transit') { x += 310; y += 180; }
  const overWater = ['fleet', 'dogfight', 'stress', 'hud-fight', 'hud-critical', 'hud-raid'].includes(scene);
  if (overWater) { const ship = g.ships[0]; ship.active = true; x = ship.x; y = ship.y; }
  g.cam = { x, y };
  const p = g.player;
  Object.assign(p, { x: x - 75, y: y + 65, a: -.65, flight: 'flying', altitude: CONFIG.render.flightHeight, aircraft: 'corsair' });
  const ring = (count, hp = 3) => { for (let i = 0; i < count; i++) { const a = i * 2.39996, r = 60 + (i % 5) * 30;
    g.enemies.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, a: a + 1, hp, team: 'jp', aircraft: 'jp', turn: 2, speed: 140, flight: 'flying' }); } };
  const burst = count => { for (let i = 0; i < count; i++) { const a = i * 2.39996, r = 20 + i % 130;
    g.particles.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: 0, vy: 0, life: .5, max: 1, size: 3 + i % 9, kind: i % 3 ? 'smoke' : 'fire' }); } };
  const tracers = () => { for (let i = 0; i < 5; i++) { const d = 40 + i * 34;
    g.bullets.push({ x: p.x + Math.cos(p.a) * d, y: p.y + Math.sin(p.a) * d, vx: Math.cos(p.a) * 860, vy: Math.sin(p.a) * 860, life: .5 }); }
    const e = g.enemies[1]; if (e) for (let i = 0; i < 3; i++) { const d = 30 + i * 40;
      g.ebullets.push({ x: e.x + Math.cos(e.a) * d, y: e.y + Math.sin(e.a) * d, vx: Math.cos(e.a) * 660, vy: Math.sin(e.a) * 660, life: .6 }); } };
  if (scene === 'dogfight') { ring(6); burst(24); }
  if (scene === 'stress') { ring(24); burst(180); }
  if (scene === 'hud-fight') { ring(6); burst(24); tracers(); p.hp = 62; p.heat = .6;
    g.allies.push({ x: p.x - 60, y: p.y + 50, a: p.a, hp: 40, team: 'us', aircraft: 'corsair', role: 'wing', name: 'Hawk', kills: 3, turn: 2.8, speed: 250, flight: 'flying' }); }
  if (scene === 'hud-critical') { ring(10); burst(60); tracers(); p.hp = 18; p.heat = .95; p.overheated = true; p.bombAmmo = 0; }
  if (scene === 'hud-raid') { p.hp = 80; p.heat = .2;
    for (let i = 0; i < 3; i++) g.enemies.push({ x: x + 900 + i * 40, y: y - 500 + i * 30, a: 2.6, hp: 3, team: 'jp', aircraft: 'jp', turn: 1.7, speed: 205, flight: 'flying',
      strike: true, strikeRole: i ? 'bomber' : 'escort', phase: 'attack', targetBaseId: 'home-airfield' }); }
  if (scene === 'hud-capture') {
    const site = g.territories.filter(t => t.owner !== 'us').sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y))[0];
    x = site.x; y = site.y; g.cam = { x: x + 40, y: y + 20 };
    Object.assign(p, { x: x + 120, y: y + 60, a: 2.2, hp: 74, heat: .1 });
    for (let i = 0; i < 6; i++) api.update(1 / 60);  // intelligence sees the site
    g.enemies.length = 0; g.ebullets.length = 0; g.bullets.length = 0;
    const field = g.airfields.find(f => f.territory === site.id); if (field) field.hp = 0;
    site.activated = true; site.progress = CONFIG.conquest.captureSeconds * .6;
    g.waypoint = { x: site.x, y: site.y, name: site.name, siteId: site.id, role: site.role, owner: site.owner, auto: true };
    Object.assign(p, { x: x + 120, y: y + 60, a: 2.2 }); g.cam = { x: x + 40, y: y + 20 }; g.time = 12; g.messageTime = 0; g.shake = 0;
  }
  if (scene === 'hud-landed') { api.startGame(); api.update(0); g.time = 12; g.messageTime = 0; }
  if (graphics.prepare) await graphics.prepare(g, view);
  for (let i = 0; i < 12; i++) graphics.render(g, view, 1 / 60, 0, 0);
  for (let i = 0; i < 30; i++) { g.time = 12 + i / 60; graphics.render(g, view, 1 / 60, 0, 0); }
  g.time = 12;
  for (const v of graphics.aircraft.values()) for (const prop of v.propellers) prop.rotation.z = 0;
  api.render(0);
  return { drawCalls: graphics.diagnostics.drawCalls, triangles: graphics.diagnostics.triangles };
}
function timing(samples) {
  const { game: g, graphics, view } = window.__game;
  const gl = graphics.renderer.getContext(), pixel = new Uint8Array(4), ms = [];
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  for (let i = 0; i < samples; i++) {
    g.time = 12 + i / 60;
    const start = performance.now();
    graphics.render(g, view, 1 / 60, 0, 0);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    ms.push(performance.now() - start);
  }
  ms.sort((a, b) => a - b);
  return { p50: ms[Math.floor(ms.length * .5)], p95: ms[Math.ceil(ms.length * .95) - 1] };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
  const server = http.createServer((req, res) => {
    const file = path.resolve(ROOT, '.' + new URL(req.url, 'http://x').pathname.replace(/\/$/, '/index.html'));
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const report = { samples: SAMPLES, timing: 'SwiftShader ms per render; relative fill cost, not phone FPS', shots: [], errors: [] };
  try {
    for (const shot of SHOTS) {
      const page = await browser.newPage({ viewport: shot.view, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
      page.on('pageerror', e => report.errors.push(`${shot.name}: ${e}`));
      page.on('console', m => { if (m.type() === 'error' && /THREE|GL_|Shader|WebGL/.test(m.text())) report.errors.push(`${shot.name}: ${m.text()}`); });
      await page.goto(`http://127.0.0.1:${server.address().port}/?quality=${shot.quality}&manualFrames=1`);
      await page.waitForFunction(() => window.__game?.rendering?.ready || window.__game?.rendering?.error);
      const info = await page.evaluate(stage, { scene: shot.scene });
      await page.screenshot({ path: path.join(OUT, shot.name + '.png') });
      const t = shot.set === 'graphics' ? await page.evaluate(timing, SAMPLES) : {};
      report.shots.push({ name: shot.name, ...info, ...t });
      console.log(shot.name.padEnd(24), t.p95 ? `p50 ${t.p50.toFixed(1)}  p95 ${t.p95.toFixed(1)} ms  ` : ''.padEnd(28), `${info.drawCalls} draws ${info.triangles} tris`);
      await page.close();
    }
  } finally { await browser.close(); server.close(); fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1) + '\n'); }
  if (report.errors.length) { console.error(report.errors.join('\n')); process.exit(1); }
})();
