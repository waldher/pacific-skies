// Focused functional checks after awaiting the explicit scenery-loading lifecycle.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),ROOT=path.resolve(__dirname,'..');
async function tapSettledCard(page, selector) {
  const card = page.locator(selector);
  await card.scrollIntoViewIfNeeded();
  await card.evaluate(element => new Promise(resolve => {
    let last = '', stable = 0;
    function frame() {
      const r = element.getBoundingClientRect(), panel = element.closest('#sortie-panel');
      const sample = [r.x,r.y,r.width,r.height,panel.scrollTop,panel.scrollLeft].join(',');
      stable = sample === last ? stable + 1 : 0; last = sample;
      if (stable >= 2) resolve(); else requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }));
  await card.evaluate(element => {
    window.__sortieTapObserved = false;
    element.addEventListener('click', () => { window.__sortieTapObserved = true; }, { once:true });
  });
  await card.tap();
  await page.waitForFunction(() => window.__sortieTapObserved === true);
}
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.resolve(ROOT,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:852,height:393}}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/?quality=4`);await page.waitForFunction(()=>window.__game?.rendering?.ready);
  await page.setViewportSize({width:390,height:844});
  const ready=async p=>p.waitForFunction(()=>{const a=window.__game;return a.game.mode==='play'&&a.graphics.world.isReady(a.game,a.view)&&document.getElementById('loading').hidden&&a.graphics.aircraft.has(a.game.player);});
  await page.evaluate(()=>{window.__game.startGame();Object.assign(window.__game.game.player,{flight:'flying',aircraft:'corsair',loadout:'torpedoes'});});await ready(page);
  const touch=await page.context().newCDPSession(page),steering={x:75,y:700,id:1};
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[steering]});steering.x=110;
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[steering]});
  const box=await page.locator('#torpedo-action').boundingBox(),trigger={x:box.x+box.width/2,y:box.y+box.height/2,id:2};
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[steering,trigger]});
  const state=()=>page.evaluate(()=>({ammo:window.__game.game.player.torpedoAmmo,stick:{...window.__game.stick},loading:!document.getElementById('loading').hidden}));
  const down=await state();await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[trigger]});const up=await state();
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();
  await page.evaluate(()=>window.__game.startGame());await ready(page);
  const restart=await page.evaluate(()=>({aircraft:window.__game.graphics.aircraft.size,expected:1+window.__game.game.allies.length}));
  const mobile=await browser.newPage({viewport:{width:320,height:568},hasTouch:true,isMobile:true});
  await mobile.goto(`http://127.0.0.1:${server.address().port}/?quality=4`);await mobile.waitForFunction(()=>window.__game?.rendering?.ready);
  await mobile.evaluate(()=>{const a=window.__game;a.startGame();const g=a.game;g.score=a.CONFIG.progression.aircraftUnlocks.p51;g.combatSorties=a.CONFIG.progression.aircraftSorties.p51;g.rank=2;g.rescue.status='complete';g.ships[0].active=true;g.bases.find(b=>b.kind==='carrier').available=true;});await ready(mobile);
  const cards=await mobile.locator('#sortie-aircraft button').evaluateAll(cards=>cards.map(c=>({text:c.innerText,width:c.clientWidth,scroll:c.scrollWidth,children:[...c.querySelectorAll('strong,small')].map(e=>({text:e.innerText,width:e.clientWidth,scroll:e.scrollWidth}))})));
  await mobile.evaluate(()=>{window.tapEvents=[];for(const type of ['pointerdown','pointerup','click'])document.addEventListener(type,e=>window.tapEvents.push({type,value:e.target.closest('[data-value]')?.dataset.value,time:performance.now(),loading:!document.getElementById('loading').hidden}),true);});
  const scrollChecks=[];
  for(const [width,height] of [[320,568],[844,390]]){
   await mobile.setViewportSize({width,height});await ready(mobile);await mobile.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const selector='#sortie-aircraft button[data-value="p51"]';
   const before=await mobile.evaluate(()=>({aircraft:window.__game.game.player.aircraft,scroll:document.getElementById('sortie-panel').scrollTop}));
   await tapSettledCard(mobile,selector);
   const immediate=await mobile.evaluate(()=>({aircraft:window.__game.game.player.aircraft,events:window.tapEvents.slice(-3),scroll:document.getElementById('sortie-panel').scrollTop}));
   await mobile.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const settled=await mobile.evaluate(()=>({aircraft:window.__game.game.player.aircraft,events:window.tapEvents.slice(-3),scroll:document.getElementById('sortie-panel').scrollTop}));
   scrollChecks.push({width,before,immediate,settled});
   await tapSettledCard(mobile,'#sortie-base button[data-value="fleet-carrier"]');
   await tapSettledCard(mobile,'#sortie-base button[data-value="home-airfield"]');await ready(mobile);
  }
  console.log(JSON.stringify({down,up,restart,cards,scrollChecks,errors},null,2));
  for(const check of scrollChecks)assert.equal(check.immediate.aircraft,'p51');
  assert.equal(down.ammo,1);assert.ok(down.stick.active&&down.stick.dx>20);assert.ok(up.stick.active&&up.ammo===1);assert.equal(restart.aircraft,restart.expected);assert.ok(cards.length===5&&cards.every(c=>c.scroll<=c.width));assert.equal(errors.length,0);
  console.log('PASS async-ready touch contacts, restart cleanup and narrow card labels');
 }finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
