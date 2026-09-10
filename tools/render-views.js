#!/usr/bin/env node
/*
 * Render top / side / front orthographic views of an aircraft GLB to a PNG
 * over a 1-metre grid, for checking proportions against a three-view drawing.
 *
 *   node tools/render-views.js F4U_Corsair [Mitsubishi_Zero ...]
 *
 * Output: tools/views/<name>.png. Uses the same headless Chromium setup as
 * the playtest (see CLAUDE.md for the env vars in the cloud container).
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'views');
const HALF = Number(process.env.AIRCRAFT_VIEW_HALF) || 7.5; // metres from centre to the edge of each view
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary' };

const PAGE = `<!doctype html><body style="margin:0"><canvas id="c" width="1200" height="1500"></canvas>
<script type="importmap">{"imports":{"three":"/vendor/three/three.module.min.js","three/addons/":"/vendor/three/addons/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const name = new URLSearchParams(location.search).get('model');
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, preserveDrawingBuffer: true });
renderer.setSize(1200, 1500, false);
renderer.setScissorTest(true);
const { scene } = await new GLTFLoader().loadAsync('/assets/aircraft/' + name + '.glb');
scene.background = new THREE.Color('#ffffff');
scene.add(new THREE.HemisphereLight('#ffffff', '#666666', 2.0));
const sun = new THREE.DirectionalLight('#ffffff', 2.0); sun.position.set(3, 10, -4); scene.add(sun);
const grid = new THREE.GridHelper(16, 16, 0xff0000, 0xbbbbbb);
const half = ${HALF};
function view(x, y, w, h, eye, up, gridRotation) {
  const cam = new THREE.OrthographicCamera(-half, half, half * h / w, -half * h / w, 0.1, 100);
  cam.position.copy(eye); cam.up.copy(up); cam.lookAt(0, 0, 0);
  const g = grid.clone(); g.rotation.set(...gridRotation); scene.add(g);
  renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h);
  renderer.render(scene, cam); scene.remove(g);
}
view(0, 750, 1200, 750, new THREE.Vector3(0, 50, 0), new THREE.Vector3(0, 0, -1), [0, 0, 0]);          // top, nose up
view(0, 375, 1200, 375, new THREE.Vector3(-50, 0, 0), new THREE.Vector3(0, 1, 0), [0, 0, Math.PI / 2]); // port side
view(0, 0, 1200, 375, new THREE.Vector3(0, 0, -50), new THREE.Vector3(0, 1, 0), [Math.PI / 2, 0, 0]);   // front
window.__done = true;
</script></body>`;

(async () => {
  const models = process.argv.slice(2);
  if (!models.length) { console.error('usage: node tools/render-views.js <model name> [...]'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/views.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); return; }
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1500 } });
  page.on('pageerror', e => console.error('page error:', e));
  for (const model of models) {
    await page.goto(`http://127.0.0.1:${server.address().port}/views.html?model=${encodeURIComponent(model)}`);
    await page.waitForFunction(() => window.__done, null, { timeout: 30000 });
    const out = path.join(OUT, `${model}.png`);
    await page.screenshot({ path: out });
    console.log(`wrote ${path.relative(ROOT, out)}`);
  }
  await browser.close();
  server.close();
})();
