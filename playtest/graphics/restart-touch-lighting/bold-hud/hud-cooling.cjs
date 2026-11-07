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
      const visible = await page.evaluate(async () => {
        const a=window.__game;
        a.setSeed(1942);
        a.startGame();
        const {game:g,graphics,view,CONFIG}=a;
        g.time=12;
        g.messageTime=0;
        const carrier=g.ships[0];
        carrier.active=true;
        g.cam={x:carrier.x,y:carrier.y};
        Object.assign(g.player,{x:carrier.x-45,y:carrier.y+82,a:-.65,flight:'flying',altitude:CONFIG.render.flightHeight,aircraft:'corsair',hp:27,heat:.94,overheated:true});
        for (let i=0;i<8;i++) {
          const angle=i*2.39996;
          const r=52+(i%4)*24;
          g.enemies.push({x:g.player.x+Math.cos(angle)*r,y:g.player.y+Math.sin(angle)*r,a:angle+1,hp:3,team:'jp',aircraft:'jp',turn:2,speed:140,flight:'flying'});
        }
        a.fireTouch.active=true;
        await graphics.prepare(g,view);
        a.render(0);
        return {hull:document.querySelector('#hull-value').textContent,ordnance:document.querySelector('#torpedo-action').textContent, mapVisible:!document.querySelector('#map-open').hidden};
      });
      const file=profile.name+'.png';
      await page.screenshot({path:path.join(out,file)});
      await page.evaluate(() => {
        window.hudTapTrace=[];
        for (const type of ['pointerdown','pointerup','click']) document.addEventListener(type, event => {
          window.hudTapTrace.push([type,event.target.id,event.clientX,event.clientY]);
        }, true);
      });
      await page.locator('#map-open').tap();
      const chartOpened = await page.locator('#operations-panel').isVisible();
      if (!chartOpened) report.errors.push(profile.name+' chart tap failed: '+JSON.stringify(await page.evaluate(()=>window.hudTapTrace)));
      if (visible.hull!=='27%' || !visible.mapVisible || !visible.ordnance) throw Error(profile.name+' missing basic HUD');
      report.results.push({profile,visible,chartOpened,file,sha256:sha(path.join(out,file))});
      if (!chartOpened) throw Error('Cannot verify cooling behind an unexpected chart state');
      await page.locator('#operations-close').tap();
      const transitions = await page.evaluate(() => {
        const a = window.__game;
        const p = a.game.player;
        a.game.enemies.length = 0;
        const read = () => ({
          overheated:p.overheated,
          label:document.querySelector('#fire-label').textContent,
          hint:document.querySelector('#fire-hint').textContent,
          heat:document.querySelector('#heat-label').textContent,
          firing:document.querySelector('#fire-indicator').dataset.firing,
        });
        const locked = read();
        Object.assign(p, {overheated:false, heat:.99, fireCd:0});
        a.fireTouch.active = true;
        a.update(1/60);
        a.render(0);
        const shotLocksGuns = read();
        a.fireTouch.active = false;
        p.heat = a.CONFIG.player.heatRecoverAt + .001;
        a.update(1/60);
        a.render(0);
        const cooled = read();
        return {locked,shotLocksGuns,cooled};
      });
      for (const state of [transitions.locked, transitions.shotLocksGuns]) {
        if (!state.overheated || state.label !== 'GUNS HOT' || state.hint !== 'COOLING' ||
            state.heat !== 'GUNS COOLING' || state.firing !== 'false') throw Error('Missing gun lockout: ' + JSON.stringify(transitions));
      }
      if (transitions.cooled.overheated || transitions.cooled.label !== 'FIRE' ||
          transitions.cooled.hint !== 'HOLD RIGHT' || transitions.cooled.heat !== 'HEAT') {
        throw Error('Fire instruction did not return: ' + JSON.stringify(transitions));
      }
      report.results.at(-1).transitions = transitions;
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
    else console.log('Captured urgent HUD states and verified chart tap in all four profiles');
  }
})();
