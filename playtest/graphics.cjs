#!/usr/bin/env node
// Fixed scenes, full-frame captures, completed-GPU timing. No automatic RAF loop.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const out = path.resolve(process.env.GRAPHICS_OUT || path.join(__dirname, 'shots/graphics'));
const samples = Number(process.env.GRAPHICS_SAMPLES || 60);
if (!Number.isInteger(samples) || samples < 10) throw new Error('GRAPHICS_SAMPLES must be >= 10');
const scenes = ['airfield', 'coast', 'fleet', 'dogfight', 'stress'];
const profiles = [
  { name: 'phone', width: 852, height: 393, quality: 2 },
  { name: 'fallback', width: 852, height: 393, quality: 4 },
];
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    const file = path.resolve(ROOT, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript' })[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  let browser;
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const report = { schema: 3, protocol: 'graphics-v3-prepared-fixed-42-step-capture', visualRenderSteps: 42, environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), concurrentWorkloads: 'Operator must run matched pairs sequentially without competing browser/test workloads' }, sourceHash: require('./graphics/source-hash.cjs')(ROOT), suiteHash: hash(fs.readFileSync(__filename)), commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT}).toString().trim(), dirty: !!execFileSync('git', ['status', '--porcelain'], {cwd: ROOT}).toString().trim(), seed: 1942, samples, timing: 'SwiftShader completed GPU render cost; NOT phone FPS', results: [], errors: [] };
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
    report.browser = browser.version();
    for (const profile of profiles) for (const scene of scenes) {
      const page = await browser.newPage({viewport: {width:profile.width,height:profile.height}, deviceScaleFactor:1, hasTouch:true, isMobile:true});
      page.on('pageerror', e => report.errors.push(String(e)));
      page.on('console', m => { if (m.type()==='error' && /THREE.WebGLProgram|GL_INVALID|VALIDATE_STATUS|Shader Error|WebGL.*(?:error|Error)/.test(m.text())) report.errors.push(m.text()); });
      await page.goto(`http://127.0.0.1:${server.address().port}/?quality=${profile.quality}&manualFrames=1`);
      await page.waitForFunction(() => window.__game?.rendering?.ready || window.__game?.rendering?.error);
      const result = await page.evaluate(async ({scene, samples}) => {
        const api = window.__game, {game:g, graphics, view, CONFIG} = api;
        if (!graphics || !api.manualFrames) throw new Error('Manual renderer unavailable');
        api.setSeed(1942); api.startGame();
        g.time = 12; g.messageTime = 0;
        const home = g.airfields.find(f=>f.id==='home-airfield');
        let x=home.x,y=home.y;
        if (scene==='coast') { x+=310; y+=180; }
        if (['fleet','dogfight','stress'].includes(scene)) {
          const ship=g.ships[0]; ship.active=true; x=ship.x; y=ship.y;
        }
        g.cam={x,y};
        Object.assign(g.player,{x:x-75,y:y+65,a:-.65,flight:'flying',altitude:CONFIG.render.flightHeight,aircraft:'corsair'});
        if (scene==='dogfight' || scene==='stress') {
          const count=scene==='stress'?24:6;
          for(let i=0;i<count;i++) {
            const a=i*2.39996, r=60+(i%5)*30;
            g.enemies.push({x:x+Math.cos(a)*r,y:y+Math.sin(a)*r,a:a+1, hp:3,team:'jp',aircraft:'jp',turn:2,speed:140,flight:'flying'});
          }
          for(let i=0;i<(scene==='stress'?180:24);i++) {
            const a=i*2.39996,r=20+i%130;
            g.particles.push({x:x+Math.cos(a)*r,y:y+Math.sin(a)*r,vx:0,vy:0,life:.5,max:1,size:3+i%9,kind:i%3?'smoke':'fire'});
          }
        }
        // Await real worker construction and first GPU upload; never score missing terrain.
        await graphics.prepare(g, view);
        // Fixed visual fixture matches the original 30-sample capture exactly.
        // Timing sample count must never alter traffic positions in judged images.
        for(let i=0;i<12;i++) graphics.render(g,view,1/60,0,0);
        for(let i=0;i<30;i++) { g.time=12+i/60; graphics.render(g,view,1/60,0,0); }
        g.time=12;
        for(const v of graphics.aircraft.values()) for(const p of v.propellers) p.rotation.z=0;
        api.render(0);
        const gl=graphics.renderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info');
        const backend={ vendor:gl.getParameter(gl.VENDOR), renderer:gl.getParameter(gl.RENDERER), version:gl.getParameter(gl.VERSION), shadingLanguage:gl.getParameter(gl.SHADING_LANGUAGE_VERSION), unmaskedVendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):null, unmaskedRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null };
        return {camera:{...g.cam},backend,userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemoryGiB:navigator.deviceMemory??null,...graphics.diagnostics,geometries:graphics.renderer.info.memory.geometries,textures:graphics.renderer.info.memory.textures};
      }, {scene,samples});
      const file=`${profile.name}-${scene}.png`;
      await page.screenshot({path:path.join(out,file)});
      // Capture first, then benchmark the same scene. Nothing can contaminate the
      // judged image, and the explicit readback drains ALL pending warmup draws.
      const timing = await page.evaluate(samples => {
        const {game:g,graphics,view}=window.__game;
        const gl=graphics.renderer.getContext(),pixel=new Uint8Array(4),rawMs=[];
        gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
        for(let i=0;i<samples;i++) {
          g.time=12+i/60;
          const start=performance.now();
          graphics.render(g,view,1/60,0,0);
          gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
          rawMs.push(performance.now()-start);
        }
        const sorted=[...rawMs].sort((a,b)=>a-b);
        return {rawMs,meanMs:rawMs.reduce((a,b)=>a+b,0)/rawMs.length,p50Ms:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],maxMs:sorted.at(-1)};
      }, samples);
      Object.assign(result,timing);
      report.results.push({profile,scene,...result,screenshot:file,sha256:hash(fs.readFileSync(path.join(out,file)))});
      console.log(`${profile.name}/${scene}: p95 ${result.p95Ms.toFixed(1)} ms, ${result.drawCalls} draws`);
      await page.close();
    }
  } finally {
    if(browser) await browser.close();
    server.close();
    report.sourceHashAfter = require('./graphics/source-hash.cjs')(ROOT);
    report.sourceChangedDuringRun = report.sourceHashAfter !== report.sourceHash;
    if (report.sourceChangedDuringRun) report.errors.push('Runtime changed during capture');
    fs.writeFileSync(path.join(out,'report.json'), JSON.stringify(report,null,2)+'\n');
  }
  if(report.errors.length || report.results.length!==scenes.length*profiles.length) throw new Error('Capture failed: '+report.errors.join('; '));
})();
