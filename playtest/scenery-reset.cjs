// Focused live-RAF regression: reset/teleport while terrain preparation is pending.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),ROOT=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.resolve(ROOT,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:852,height:393}}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/?quality=4`);await page.waitForFunction(()=>window.__game?.rendering?.ready);
  await page.evaluate(()=>{window.__game.setSeed(1942);window.__game.startGame();});
  await page.waitForFunction(()=>window.__game.graphics.world.workerStats.inFlight);
  await page.evaluate(()=>{window.__game.setSeed(90210);window.__game.startGame();});
  let resumed=false;
  try{await page.waitForFunction(()=>window.__game.game.time>.15&&document.getElementById('loading').hidden,null,{timeout:15000});resumed=true;}catch{}
  const reset=await page.evaluate(()=>({time:window.__game.game.time,loading:document.getElementById('loading-text').textContent,stats:window.__game.graphics.world.workerStats}));
  if(resumed){
   await page.evaluate(()=>{const {game:g}=window.__game,t=g.territories.find(t=>t.owner==='enemy');g.player.flight='flying';g.player.x=t.x+300;g.player.y=t.y+100;g.cam={x:g.player.x,y:g.player.y};g.enemies=[];});
   await page.waitForFunction(()=>window.__game.game.enemies.length>0,null,{timeout:15000});
   await page.waitForFunction(()=>document.getElementById('loading').hidden);
  }
  console.log(JSON.stringify({resumed,reset,errors},null,2));assert.ok(resumed,'live RAF resumes after campaign supersedes an active terrain build');assert.equal(errors.length,0);
  console.log('PASS scenery reset resumes simulation and enemy territory teleport spawns defenders');
 }finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
