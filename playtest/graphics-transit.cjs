#!/usr/bin/env node
// Cold startup and island lifecycle probe. Teleports intentionally exercise the
// worst-case synchronous build/upload path, not normal flight speed or phone FPS.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..');
const OUT=path.resolve(process.env.GRAPHICS_TRANSIT_OUT||path.join(__dirname,'shots/graphics-transit'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const sourceHash=require('./graphics/source-hash.cjs');
const PROFILES=[{name:'phone',width:852,height:393,quality:2},{name:'fallback',width:852,height:393,quality:4}];
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const server=http.createServer((req,res)=>{
  const file=path.resolve(ROOT,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
  if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const report={schema:1,protocol:'cold-island-transit-v1',suiteHash:hash(fs.readFileSync(__filename)),sourceHash:sourceHash(ROOT),seed:1942,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT}).toString().trim(),dirty:!!execFileSync('git',['status','--porcelain'],{cwd:ROOT}).toString().trim(),timing:'Main-thread render submission/build + WebGL completion on SwiftShader; cold teleport probe, NOT phone FPS',environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length},results:[],errors:[]};
 let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});report.browser=browser.version();
  for(const profile of PROFILES){
   const page=await browser.newPage({viewport:{width:profile.width,height:profile.height},deviceScaleFactor:1,hasTouch:true,isMobile:true});
   page.on('pageerror',e=>report.errors.push(String(e)));
   const bootStart=performance.now();
   await page.goto(`http://127.0.0.1:${server.address().port}/?quality=${profile.quality}&manualFrames=1`);
   await page.waitForFunction(()=>window.__game?.rendering?.ready||window.__game?.rendering?.error);
   const bootWallMs=performance.now()-bootStart;
   const result=await page.evaluate(()=>{
    const api=window.__game,{game:g,graphics,view,CONFIG}=api;
    if(!graphics||!api.manualFrames)throw Error('Manual renderer unavailable');
    const gl=graphics.renderer.getContext(),pixel=new Uint8Array(4),ext=gl.getExtension('WEBGL_debug_renderer_info');
    const backend={vendor:gl.getParameter(gl.VENDOR),renderer:gl.getParameter(gl.RENDERER),unmaskedVendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):null,unmaskedRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null};
    const drain=()=>gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
    drain();api.setSeed(1942);
    const start=performance.now();api.startGame();const startGameMs=performance.now()-start;
    const home={id:'home',name:'home airfield',x:g.player.x,y:g.player.y};
    const terrain=(g.terrain||g.territories).map(t=>({id:t.id,name:t.name||String(t.id),x:t.x,y:t.y,radius:t.radius,extent:t.extent??t.radius}));
    // Greedy farthest-point coverage across actual terrain, not synthetic islands.
    const selected=[home],available=[...terrain];
    for(let i=0;i<6&&available.length;i++){
     available.sort((a,b)=>Math.min(...selected.map(p=>Math.hypot(b.x-p.x,b.y-p.y)))-Math.min(...selected.map(p=>Math.hypot(a.x-p.x,a.y-p.y))));
     const t=available.shift();if(selected.every(p=>Math.hypot(t.x-p.x,t.y-p.y)>1))selected.push(t);
    }
    const empty={id:'empty',name:'outside all terrain',x:1e7,y:1e7};
    const visits=[];
    function memory(){
     const textures=new Set(),geometries=new Set(),sizes=[];
     for(const group of graphics.world.chunks.values())group.traverse(n=>{
      if(!n.isMesh)return;
      if(n.geometry)geometries.add(n.geometry);
      for(const m of Array.isArray(n.material)?n.material:[n.material]){
       for(const t of [m.map,m.uniforms?.albedoMap?.value])if(t?.isTexture)textures.add(t);
      }
     });
     for(const t of textures){const image=t.image||{};sizes.push({width:image.width||0,height:image.height||0,mipmaps:!!t.generateMipmaps,estimatedRGBA8Bytes:(image.width||0)*(image.height||0)*4*(t.generateMipmaps?4/3:1)});}
     let landBufferBytes=0;for(const geom of geometries){for(const a of Object.values(geom.attributes))landBufferBytes+=a.array.byteLength;landBufferBytes+=geom.index?.array.byteLength||0;}
     return {cache:graphics.world.cacheStats??null,chunks:graphics.world.chunkCount,textures:graphics.renderer.info.memory.textures,geometries:graphics.renderer.info.memory.geometries,programs:graphics.renderer.info.programs?.length??null,landTextureCount:textures.size,landTextureSizes:sizes,landTextureEstimatedRGBA8Bytes:sizes.reduce((n,s)=>n+s.estimatedRGBA8Bytes,0),landBufferBytes,jsHeapUsedBytes:performance.memory?.usedJSHeapSize??null};
    }
    function visit(site,label){
     drain();const previous=[...graphics.world.chunks.keys()].map(t=>t.id);
     g.cam={x:site.x,y:site.y};Object.assign(g.player,{x:site.x-75,y:site.y+65,a:-.65,flight:'flying',altitude:CONFIG.render.flightHeight});
     const begin=performance.now();graphics.render(g,view,0,0,0);const submitted=performance.now();drain();const completed=performance.now();
     const current=[...graphics.world.chunks.keys()].map(t=>t.id);
     const warm=[];
     for(let i=0;i<3;i++){const t=performance.now();graphics.render(g,view,0,0,0);drain();warm.push(performance.now()-t);}
     visits.push({label,site,loadedChunkIds:current,addedChunkIds:current.filter(id=>!previous.includes(id)),removedChunkIds:previous.filter(id=>!current.includes(id)),submissionMs:submitted-begin,gpuDrainMs:completed-submitted,completedRenderMs:completed-begin,warmCompletedMs:warm,memory:memory()});
    }
    visit(home,'startup-first-render');visit(empty,'empty-baseline');visit(home,'immediate-cached-revisit');visit(empty,'empty-after-immediate-revisit');
    for(let cycle=1;cycle<=2;cycle++){
     for(const site of selected)visit(site,`cycle-${cycle}-${site.id}`);
     visit(empty,`empty-after-cycle-${cycle}`);
    }
    visit(home,'home-final-revisit');visit(empty,'empty-final');
    const clears=visits.filter(v=>v.site.id==='empty');
    const initial=clears[0].memory,final=clears.at(-1).memory;
    const monotonicTextureGrowth=clears.slice(1).every((v,i)=>v.memory.textures>clears[i].memory.textures);
    const lifecycle={cacheBounded:visits.every(v=>!v.memory.cache||(v.memory.cache.detachedBytes<=v.memory.cache.maxDetachedBytes&&v.memory.cache.detachedCount<=4)),allEmptyViewsDetachLand:clears.every(v=>v.memory.chunks===0&&v.memory.landTextureCount===0),initialClearMemory:initial,finalClearMemory:final,textureDeltaAfterCycles:final.textures-initial.textures,geometryDeltaAfterCycles:final.geometries-initial.geometries,monotonicTextureGrowth,interpretation:'Empty views detach land; bounded cached groups intentionally retain textures and geometry. Cache estimates include CPU and GPU copies, unlike active landTextureEstimatedRGBA8Bytes. Active working set, driver overhead and temporary builder allocations are not capped by the detached cache budget. JS heap is approximate and GC is uncontrolled.'};
    g.terrain=[];g.territories=[];visit(empty,'campaign-reset-release');lifecycle.resetMemory=visits.at(-1).memory;lifecycle.resetReleasesAllLand=!lifecycle.resetMemory.cache||lifecycle.resetMemory.cache.estimatedResidentBytes===0;
    return {backend,startGameMs,selectedSites:selected,terrainCount:terrain.length,visits,lifecycle};
   });
   report.results.push({profile,bootWallMs,...result});
   console.log(`${profile.name}: startGame ${result.startGameMs.toFixed(1)}ms, cold first render ${result.visits[0].completedRenderMs.toFixed(1)}ms, worst visit ${Math.max(...result.visits.map(v=>v.completedRenderMs)).toFixed(1)}ms, final clear textures delta ${result.lifecycle.textureDeltaAfterCycles}`);
   await page.close();
  }
 }finally{
  if(browser)await browser.close();server.close();report.sourceHashAfter=sourceHash(ROOT);report.sourceChangedDuringRun=report.sourceHashAfter!==report.sourceHash;fs.writeFileSync(path.join(OUT,'transit.json'),JSON.stringify(report,null,2)+'\n');
 }
 if(report.errors.length||report.results.length!==2||report.sourceChangedDuringRun)throw Error('Transit probe incomplete or source changed: '+report.errors.join('; '));
})();
