#!/usr/bin/env node
// A separate advancing simulation sequence. These timings include update + HUD
// + 3D render + GPU completion; they are still NOT interactive hardware FPS.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..');
const OUT=path.resolve(process.env.GRAPHICS_MOTION_OUT||path.join(__dirname,'shots/graphics-motion'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const TICKS=[0,6,12,24,36,60,90,120,180];
const SCENES=['fleet','coast'];
const PROFILES=[{name:'phone',width:852,height:393,quality:2},{name:'fallback',width:852,height:393,quality:4}];
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const server=http.createServer((req,res)=>{
  const file=path.resolve(ROOT,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
  if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript'})[path.extname(file)]||'application/octet-stream');
  res.end(fs.readFileSync(file));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const report={schema:2,protocol:'motion-v3-fleet-and-coastal-real-simulation',suiteHash:hash(fs.readFileSync(__filename)),sourceHash:require('./graphics/source-hash.cjs')(ROOT),commit:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT}).toString().trim(),dirty:!!execFileSync('git',['status','--porcelain'],{cwd:ROOT}).toString().trim(),seed:1942,dt:1/60,durationSeconds:3,scenes:SCENES,expectedResults:4,expectedFrames:36,coastalFixture:'Player starts over the home runway, heading opposite home.a along its shore; identical held-fire/right-turn timeline makes a real seaward turn. Normal gameplay camera follows without repositioning during capture.',timing:'Simulation update + world/HUD submission + WebGL completion cost; excludes deferred DOM/layout/Canvas2D presentation, compositor and thermal model; NOT phone FPS',environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length},events:[{tick:6,event:'actual damagePlayer(8) hit flash + small explosion'},{tick:60,event:'actual large explosion'},{tick:1,event:'Space held through tick 120; right turn ticks 30–90'}],results:[],errors:[]};
 let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});report.browser=browser.version();
  for(const scene of SCENES)for(const profile of PROFILES){
   const page=await browser.newPage({viewport:{width:profile.width,height:profile.height},deviceScaleFactor:1,hasTouch:true,isMobile:true});
   page.on('pageerror',e=>report.errors.push(String(e)));
   page.on('console',message=>{if(message.type()==='error'&&/WebGL|shader|GL_INVALID|GL_OUT_OF_MEMORY|GL_CONTEXT_LOST|ERROR:\s*\d+:\d+/i.test(message.text()))report.errors.push(message.text());});
   await page.goto(`http://127.0.0.1:${server.address().port}/?quality=${profile.quality}&manualFrames=1`);
   await page.waitForFunction(()=>window.__game?.rendering?.ready||window.__game?.rendering?.error);
   const backend=await page.evaluate(async scene=>{
    const a=window.__game,{game:g,graphics,view,CONFIG}=a;
    if(!graphics||!a.manualFrames)throw Error('Manual renderer unavailable');
    a.setSeed(1942);a.startGame();
    const ship=g.ships[0];ship.active=true;
    Object.assign(g.player,{x:ship.x-200,y:ship.y+120,a:-.4,flight:'flying',altitude:CONFIG.render.flightHeight,aircraft:'corsair',hp:35});
    g.cam={x:ship.x,y:ship.y};g.messageTime=0;
    let coast = null;
    if(scene==='coast') {
      const home=g.airfields.find(f=>f.id==='home-airfield');
      const holding=g.territories.find(t=>t.role==='airfield'&&t.owner==='us') || g.territories[0];
      const terrain=g.terrain.find(t=>t.id===holding.terrainId) || g.terrain.find(t=>Math.hypot(home.x-t.x,home.y-t.y)<(t.extent??t.radius));
      if(!home||!terrain?.shoreline)throw Error('Coastal fixture requires actual home shoreline');
      Object.assign(g.player,{x:home.x,y:home.y,a:home.a+Math.PI});
      g.cam={x:home.x,y:home.y};
      coast={home:{x:home.x,y:home.y,heading:home.a},terrainId:terrain.id,shore:terrain.shoreline.map(([x,y])=>[x+terrain.x,y+terrain.y])};
    }
    await graphics.prepare(g,view);
    // Warm renderer only. The actual gameplay clock is still t=0.
    for(let i=0;i<12;i++)graphics.render(g,view,0,0,0);
    a.render(0);
    window.__motion={scene,coast,tick:0,rawMs:[],particles:await import('/src/particles.js'),player:await import('/src/player.js')};
    const gl=graphics.renderer.getContext(),pixel=new Uint8Array(4),ext=gl.getExtension('WEBGL_debug_renderer_info');
    gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
    return {vendor:gl.getParameter(gl.VENDOR),renderer:gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),unmaskedVendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):null,unmaskedRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null};
   },scene);
   const frames=[];
   for(const tick of TICKS){
    const state=await page.evaluate(target=>{
     const a=window.__game,m=window.__motion,g=a.game,gl=a.graphics.renderer.getContext(),pixel=new Uint8Array(4);
     while(m.tick<target){
      m.tick++;
      a.keys.Space=m.tick<=120;a.keys.ArrowRight=m.tick>=30&&m.tick<=90;
      if(m.tick===6){m.player.damagePlayer(8);m.particles.explosion(g.player.x+50,g.player.y-30,false);}
      if(m.tick===60)m.particles.explosion(g.player.x+65,g.player.y-20,true);
      const start=performance.now();
      a.update(1/60);a.render(1/60);
      gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
      m.rawMs.push(performance.now()-start);
     }
     // Actual physical shoreline visibility, not a camera override. Clip each
     // world-ground segment against the current ground-plane viewport.
     let coastalEvidence=null;
     if(m.coast){
      let nearest=Infinity,visibleSegments=0;
      for(let i=0;i<m.coast.shore.length;i++){
       const [ax,ay]=m.coast.shore[i],[bx,by]=m.coast.shore[(i+1)%m.coast.shore.length],dx=bx-ax,dy=by-ay;
       const f=Math.max(0,Math.min(1,((g.cam.x-ax)*dx+(g.cam.y-ay)*dy)/(dx*dx+dy*dy||1)));
       nearest=Math.min(nearest,Math.hypot(ax+dx*f-g.cam.x,ay+dy*f-g.cam.y));
       const sx=ax-g.cam.x,sy=ay-g.cam.y;let lo=0,hi=1,visible=true;
       for(const [p,q]of [[-dx,sx+a.view.W/2],[dx,a.view.W/2-sx],[-dy,sy+a.view.H/2],[dy,a.view.H/2-sy]]){
        if(p===0){if(q<0)visible=false;continue;}const r=q/p;if(p<0)lo=Math.max(lo,r);else hi=Math.min(hi,r);
       }
       if(visible&&lo<=hi)visibleSegments++;
      }
      coastalEvidence={terrainId:m.coast.terrainId,home:m.coast.home,nearestShoreDistance:nearest,visibleShoreSegments:visibleSegments,shoreInGroundViewport:visibleSegments>0};
     }
     return {scene:m.scene,coastalEvidence,tick:m.tick,timeSeconds:m.tick/60,camera:{...g.cam},player:{x:g.player.x,y:g.player.y,hp:g.player.hp,hitFlash:g.player.hitFlash,heading:g.player.a},particles:g.particles.length,particleKinds:Object.fromEntries(['smoke','fire','ring'].map(k=>[k,g.particles.filter(p=>p.kind===k).length])),movingShips:g.ships.filter(s=>s.fleet?.moving).length,mode:g.mode};
    },tick);
    const file=`${scene}-${profile.name}-${String(tick).padStart(3,'0')}.png`;
    await page.screenshot({path:path.join(OUT,file)});
    frames.push({...state,file,sha256:hash(fs.readFileSync(path.join(OUT,file)))});
   }
   const timing=await page.evaluate(()=>{
    const rawMs=window.__motion.rawMs,sorted=[...rawMs].sort((a,b)=>a-b);
    return {rawMs,meanMs:rawMs.reduce((s,x)=>s+x,0)/rawMs.length,p50Ms:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],maxMs:sorted.at(-1)};
   });
   report.results.push({scene,label:`${scene} · ${profile.name}`,profile,backend,frames,fullFrameCost:timing});
   if(scene==='coast'&&frames.some(f=>!f.coastalEvidence.shoreInGroundViewport))report.errors.push(`${profile.name}/coast: shoreline left the actual camera viewport`);
   console.log(`${scene}/${profile.name}: ${frames.length} motion frames, full-frame p95 cost ${timing.p95Ms.toFixed(2)} ms`);
   await page.close();
  }
  const embedded=report.results.map(r=>({scene:r.scene,label:r.label,profile:r.profile,frames:r.frames.map(f=>({...f,image:'data:image/png;base64,'+fs.readFileSync(path.join(OUT,f.file)).toString('base64')}))}));
  const html=`<!doctype html><html><meta charset="utf-8"><title>Pacific Skies motion evidence</title><style>body{background:#101820;color:#e7edf1;font:16px system-ui;max-width:900px;margin:24px auto;padding:0 16px}img{width:100%;image-rendering:auto}button,select,input{margin:8px;padding:8px}#caption{white-space:pre-wrap}</style><h1>Advancing simulation evidence</h1><p>Three seconds of actual gameplay updates for fleet combat and coastal flight, each at both phone profiles. Coastal flight uses the normal player-follow camera; shoreline visibility is recorded for every sample. Sparse sampled frames, not a 60 FPS recording. Playback interpolates no missing frames. Timing includes simulation, HUD submission, renderer and WebGL completion. Deferred DOM/layout/Canvas2D presentation and compositor costs are excluded; this does not measure device FPS.</p><select id="profile"></select><button id="prev">Previous</button><button id="play">Play / pause</button><button id="next">Next</button><input id="frame" type="range" min="0" max="8" value="0"><img id="shot" alt="Game motion sample"><p id="caption"></p><script>const data=${JSON.stringify(embedded)},select=document.getElementById('profile'),slider=document.getElementById('frame');data.forEach((x,i)=>{const o=document.createElement('option');o.value=i;o.textContent=x.label;select.append(o)});let active=false,timer;function render(){const x=data[+select.value].frames[+slider.value];document.getElementById('shot').src=x.image;document.getElementById('caption').textContent='t='+x.timeSeconds.toFixed(2)+' s · tick '+x.tick+' · hull '+x.player.hp+' · particles '+x.particles+' · moving ships '+x.movingShips+' · Camera '+JSON.stringify(x.camera)+(x.coastalEvidence?' · visible shoreline segments '+x.coastalEvidence.visibleShoreSegments:'')}function schedule(){clearTimeout(timer);if(!active)return;const frames=data[+select.value].frames,index=+slider.value;const delay=index<frames.length-1?(frames[index+1].timeSeconds-frames[index].timeSeconds)*1000:600;timer=setTimeout(()=>{slider.value=(index+1)%frames.length;render();schedule()},delay)}slider.oninput=()=>{active=false;clearTimeout(timer);render()};select.onchange=render;document.getElementById('prev').onclick=()=>{slider.value=Math.max(0,+slider.value-1);render()};document.getElementById('next').onclick=()=>{slider.value=Math.min(8,+slider.value+1);render()};document.getElementById('play').onclick=()=>{active=!active;schedule()};render();</script></html>`;
  fs.writeFileSync(path.join(OUT,'motion.html'),html);
  report.artifact={file:'motion.html',sha256:hash(Buffer.from(html)),contains:'36 embedded PNGs: fleet and coastal sequences, nine timestamps each, both phone profiles'};
 }finally{
  if(browser)await browser.close();server.close();report.sourceHashAfter=require('./graphics/source-hash.cjs')(ROOT);report.sourceChangedDuringRun=report.sourceHashAfter!==report.sourceHash;fs.writeFileSync(path.join(OUT,'motion.json'),JSON.stringify(report,null,2)+'\n');
 }
 if(report.errors.length||report.results.length!==4||report.results.some(r=>r.frames.length!==9)||report.sourceChangedDuringRun)throw Error('Motion capture failed: '+report.errors.join('; '));
})();
