#!/usr/bin/env node
// Diagnostic ablations only. Never use these altered scenes for acceptance,
// screenshot judging, or claims about physical-phone FPS.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),os=require('node:os');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const ROOT=path.resolve(process.env.GRAPHICS_PROFILE_ROOT||path.join(__dirname,'..'));
const OUT=path.resolve(process.env.GRAPHICS_PROFILE_OUT||path.join(__dirname,'shots/graphics-profile'));
const sourceHash=require('./graphics/source-hash.cjs'),samples=25;
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const server=http.createServer((req,res)=>{const file=path.resolve(ROOT,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 const report={protocol:'nonacceptance-frozen-render-ablations-v1',sourceHash:sourceHash(ROOT),commit:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT}).toString().trim(),helperHash:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),samples,profile:{name:'phone',width:852,height:393,quality:2},environment:{cpu:os.cpus()[0]?.model,node:process.version},interpretation:'Diagnostic render-only completed WebGL costs on host; frozen time/dt0. Hiding one component changes overdraw interactions, so differences are not additive. Aircraft-shadow case hides receiver meshes; Q2 already disables shadow maps. NOT acceptance evidence or phone FPS.',results:[],errors:[]};
 try{
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});report.browser=browser.version();
  for(const scene of ['fleet','stress']){
   const page=await browser.newPage({viewport:{width:852,height:393},deviceScaleFactor:1,hasTouch:true,isMobile:true});page.on('pageerror',e=>report.errors.push(String(e)));
   await page.goto(`http://127.0.0.1:${server.address().port}/?quality=2&manualFrames=1`);await page.waitForFunction(()=>window.__game?.rendering?.ready||window.__game?.rendering?.error);
   const result=await page.evaluate(async({scene,samples})=>{
    const api=window.__game,{game:g,graphics,view,CONFIG}=api;if(!graphics||!api.manualFrames)throw Error('Manual renderer required');
    api.setSeed(1942);api.startGame();g.time=12;g.messageTime=0;
    const ship=g.ships[0];ship.active=true;const x=ship.x,y=ship.y;g.cam={x,y};
    Object.assign(g.player,{x:x-75,y:y+65,a:-.65,flight:'flying',altitude:CONFIG.render.flightHeight,aircraft:'corsair'});
    if(scene==='stress'){
     for(let i=0;i<24;i++){const a=i*2.39996,r=60+(i%5)*30;g.enemies.push({x:x+Math.cos(a)*r,y:y+Math.sin(a)*r,a:a+1,hp:3,team:'jp',aircraft:'jp',turn:2,speed:140,flight:'flying'});}
     for(let i=0;i<180;i++){const a=i*2.39996,r=20+i%130;g.particles.push({x:x+Math.cos(a)*r,y:y+Math.sin(a)*r,vx:0,vy:0,life:.5,max:1,size:3+i%9,kind:i%3?'smoke':'fire'});}
    }
    await graphics.prepare(g,view);
    for(let i=0;i<12;i++)graphics.render(g,view,1/60,0,0);
    for(let i=0;i<30;i++){g.time=12+i/60;graphics.render(g,view,1/60,0,0);}
    g.time=12;for(const visual of graphics.aircraft.values())for(const prop of visual.propellers)prop.rotation.z=0;
    graphics.render(g,view,0,0,0);
    const renderer=graphics.renderer,gl=renderer.getContext(),pixel=new Uint8Array(4),ext=gl.getExtension('WEBGL_debug_renderer_info');
    const backend={vendor:gl.getParameter(gl.VENDOR),renderer:gl.getParameter(gl.RENDERER),unmaskedRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null};
    const groups={ocean:graphics.scene.children.filter(n=>n.isMesh&&n.material?.uniforms?.deepColor&&n.material?.uniforms?.detail),wakes:[...graphics.naval.ships.values()].map(v=>v.wake),particles:graphics.scene.children.filter(n=>n.isPoints&&n.geometry?.attributes?.ring),aircraftShadows:[...graphics.aircraft.values()].map(v=>v.shadow)};
    if(groups.ocean.length!==1||groups.particles.length!==1)throw Error('Ablation target identification failed');
    const textureMetadata=[];for(const [key,u]of Object.entries(groups.ocean[0].material.uniforms))if(u.value?.isTexture)textureMetadata.push({uniform:key,type:u.value.type,colorSpace:u.value.colorSpace,width:u.value.image?.width,height:u.value.image?.height,format:u.value.format});
    const original=renderer.render,drain=()=>gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
    let hidden=[];renderer.render=function(...args){const saved=hidden.map(n=>[n,n.visible]);for(const[n]of saved)n.visible=false;try{return original.apply(this,args);}finally{for(const[n,v]of saved)n.visible=v;}};
    const summarize=raw=>{const sorted=[...raw].sort((a,b)=>a-b);return{rawMs:raw,p50Ms:sorted[Math.floor(raw.length*.5)],p95Ms:sorted[Math.ceil(raw.length*.95)-1],meanMs:raw.reduce((a,b)=>a+b,0)/raw.length,maxMs:sorted.at(-1)}};
    const cases=[];
    try{
     for(const name of ['full','ocean','full-after-ocean','wakes','full-after-wakes','particles','full-after-particles','aircraftShadows','full-after-shadows']){
      hidden=groups[name]||[];const saved=hidden.map(n=>[n,n.visible]);
      for(let i=0;i<5;i++)graphics.render(g,view,0,0,0);drain();
      const completed=[],submission=[],gpuDrain=[],drawCounts=[],triangles=[];
      for(let i=0;i<samples;i++){const begin=performance.now();graphics.render(g,view,0,0,0);const sent=performance.now();drain();const done=performance.now();completed.push(done-begin);submission.push(sent-begin);gpuDrain.push(done-sent);drawCounts.push(renderer.info.render.calls);triangles.push(renderer.info.render.triangles);}
      if(saved.some(([n,v])=>n.visible!==v))throw Error('Visibility was not restored after '+name);
      cases.push({name,hiddenNodes:hidden.length,completed:summarize(completed),submission:summarize(submission),gpuDrain:summarize(gpuDrain),drawCounts,triangles});
     }
    }finally{renderer.render=original;hidden=[];}
    return{scene,backend,textureMetadata,targetCounts:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.length])),cases};
   },{scene,samples});report.results.push(result);
   for(const c of result.cases)console.log(`${scene}/${c.name}: p50 ${c.completed.p50Ms.toFixed(1)} p95 ${c.completed.p95Ms.toFixed(1)} ms; ${c.drawCounts[0]} draws`);
   await page.close();
  }
 }finally{await browser?.close();server.close();report.sourceHashAfter=sourceHash(ROOT);report.sourceChanged=report.sourceHashAfter!==report.sourceHash;fs.writeFileSync(path.join(OUT,'profile.json'),JSON.stringify(report,null,2)+'\n');}
 if(report.errors.length||report.sourceChanged)throw Error('Profile invalid: '+JSON.stringify(report.errors));
})().catch(e=>{console.error(e);process.exitCode=1;});
