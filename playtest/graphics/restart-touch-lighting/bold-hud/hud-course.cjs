const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {createHash} = require('node:crypto');
const {chromium} = require('playwright');

const root = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3]);
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceHash = require(path.join(root,'playtest/graphics/source-hash.cjs'));
const profiles = [
  {name:'phone', width:852, height:393, quality:2},
  {name:'fallback', width:852, height:393, quality:4},
  {name:'short-landscape', width:640, height:360, quality:4},
  {name:'portrait', width:320, height:568, quality:4},
];
(async () => {
  fs.mkdirSync(out, {recursive:true});
  const server = http.createServer((req,res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader('Content-Type', {'.html':'text/html','.js':'text/javascript'}[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  const report = {sourceHash:sourceHash(root), suiteHash:sha(__filename), seed:1942, errors:[], results:[]};
  try {
    browser = await chromium.launch({args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
    report.browser = browser.version();
    for (const profile of profiles) {
      const page = await browser.newPage({viewport:{width:profile.width,height:profile.height},deviceScaleFactor:1,hasTouch:true,isMobile:true});
      page.on('pageerror', e => report.errors.push(String(e)));
      page.on('console', m => {if (m.type()==='error' && /shader|WebGL|GL_INVALID/i.test(m.text())) report.errors.push(m.text());});
      await page.goto('http://127.0.0.1:'+server.address().port+'/?quality='+profile.quality+'&manualFrames=1');
      await page.waitForFunction(() => window.__game?.rendering?.ready);
      await page.evaluate(async () => {
        const a = window.__game;
        a.setSeed(1942);
        a.startGame();
        const {game:g,graphics,view,CONFIG} = a;
        const carrier = g.ships[0];
        carrier.active = true;
        const x = carrier.x - 38, y = carrier.y + 102;
        g.cam = {x:carrier.x,y:carrier.y};
        g.time = 12;
        g.messageTime = 0;
        Object.assign(g.player, {x,y,a:-.65,flight:'flying',altitude:CONFIG.render.flightHeight,aircraft:'corsair'});
        g.waypoint = {x:x+920,y:y+220,name:'Enemy outpost',search:true};
        await graphics.prepare(g,view);
        a.render(0);
      });
      const states = [];
      for (const stage of ['brief','compact','flow','raid-fire','arrived']) {
        const state = await page.evaluate(stage => {
          const a = window.__game;
          const g = a.game, p = g.player;
          if (stage==='compact') g.time += 2.6;
          if (stage==='flow') g.time += .28;
          if (stage==='raid-fire') {
            g.enemies.push({x:p.x+130,y:p.y-55,a:1,hp:3,team:'jp',aircraft:'jp',turn:2,speed:140,
              flight:'flying',strike:true,strikeRole:'bomber',targetBaseId:'home-airfield'});
            a.fireTouch.active = true;
          }
          if (stage==='arrived') {
            a.fireTouch.active = false;
            g.enemies.length = 0;
            g.waypoint = {x:p.x+95,y:p.y+40,name:'Recovery field',returning:true};
          }
          a.render(0);
          const arrows = a.hudArrows();
          return {time:g.time, objective:arrows.find(e=>e.kind==='objective'),
            raid:arrows.find(e=>e.kind==='raid')?.label || null, firing:a.fireTouch.active};
        },stage);
        if (!state.objective || (stage==='arrived')!==state.objective.arrived ||
            (stage==='raid-fire')!==Boolean(state.raid)) throw Error('Unexpected route fixture '+JSON.stringify(state));
        const file = profile.name+'-'+stage+'.png';
        await page.screenshot({path:path.join(out,file)});
        states.push({stage,state,file,sha256:sha(path.join(out,file))});
      }
      report.results.push({profile,states});
      await page.close();
    }
  } catch (e) { report.errors.push(String(e)); }
  finally {
    await browser?.close();
    server.close();
    report.sourceHashAfter=sourceHash(root);
    if (report.sourceHashAfter!==report.sourceHash) report.errors.push('Runtime changed during capture');
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
    if (report.errors.length) { console.error(report.errors); process.exitCode=1; }
    else console.log('Captured course briefing, settled flow, raid, and arrival in all four profiles');
  }
})();
