// Browser CPU-only equivalence: real module worker + OffscreenCanvas, no WebGL.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');const ROOT=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{
  if(req.url==='/test'){res.setHeader('Content-Type','text/html');res.end('<script type="importmap">{"imports":{"three":"/vendor/three/three.module.min.js"}}</script>');return;}
  const file=path.resolve(ROOT,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(file));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,args:['--disable-gpu']});
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/test`);
  const result=await page.evaluate(async()=>{
   const THREE=await import('/vendor/three/three.module.min.js');
   const {createLand,preloadTerrainMaterial,hasTerrainMaterial}=await import('/src/land.js');
   const {createLandWorker}=await import('/src/land-worker-client.js');
   const {generateTheater}=await import('/src/theater.js');const {setSeed}=await import('/src/util.js');
   const {createWorld}=await import('/src/world.js');
   await preloadTerrainMaterial();const client=createLandWorker(hasTerrainMaterial());await client.ready;
   if(client.stats.mode!=='worker')throw Error(JSON.stringify(client.stats));
   const shared={time:{value:0},wind:{value:new THREE.Vector2()},cloudSpeed:{value:0},cloudStrength:{value:0},surfMaterial:new THREE.ShaderMaterial()};
   const land=createLand(null,shared);setSeed(1942);const theater=generateTheater();
   const hash=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(b=>b.toString(16).padStart(2,'0')).join('');
   const results=[];
   for(const territory of [theater.terrain[0],theater.terrain[3],theater.terrain.at(-1)]){
    const context={sectors:theater.sectors,geographySeed:theater.geographySeed??0,holdings:theater.territories.filter(h=>h.terrainId===territory.id)};
    const sync=land.build(territory,context),payload=await client.build(territory,context),worker=land.hydrate(payload);
    const geometry=async group=>Promise.all(group.children.map(async m=>({position:m.position.toArray(),quaternion:m.quaternion.toArray(),attributes:await Promise.all(Object.entries(m.geometry.attributes).map(async([k,a])=>[k,a.itemSize,a.normalized,await hash(a.array)])),index:m.geometry.index?await hash(m.geometry.index.array):null})));
    const syncGeometry=await geometry(sync),workerGeometry=await geometry(worker);
    const source=sync.children.find(n=>n.material.uniforms?.albedoMap).material.uniforms.albedoMap.value.image;
    const pixels=source.getContext('2d').getImageData(0,0,source.width,source.height).data;
    const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
    const ctx=canvas.getContext('2d');ctx.translate(0,source.height);ctx.scale(1,-1);ctx.drawImage(payload.bitmap,0,0);
    const other=ctx.getImageData(0,0,source.width,source.height).data;
    ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(payload.bitmap,0,0);const unflipped=ctx.getImageData(0,0,source.width,source.height).data;
    const syncWire=await land.serialize(sync);ctx.setTransform(1,0,0,-1,0,source.height);ctx.drawImage(syncWire.bitmap,0,0);const control=ctx.getImageData(0,0,source.width,source.height).data;syncWire.bitmap.close();
    let controlDiff=0,unflippedDiff=0;for(let i=0;i<pixels.length;i++){if(control[i]!==pixels[i])controlDiff++;if(unflipped[i]!==pixels[i])unflippedDiff++;}
    let changedChannels=0,maxDifference=0;for(let i=0;i<pixels.length;i++){const d=Math.abs(pixels[i]-other[i]);if(d)changedChannels++;maxDifference=Math.max(maxDifference,d);}
    results.push({id:territory.id,controlDiff,unflippedDiff,geometryEqual:JSON.stringify(syncGeometry)===JSON.stringify(workerGeometry),trafficEqual:JSON.stringify(sync.userData)===JSON.stringify(worker.userData),changedChannels,maxDifference,textureHash:await hash(pixels),workerTextureHash:await hash(other),width:source.width,height:source.height});
    land.dispose(sync);land.dispose(worker);
   }
   // Drive production scheduler through a campaign change during its first build.
   const world=createWorld(new THREE.Scene()),view={W:852,H:393};
   const game={...theater,cam:{x:theater.terrain[0].x,y:theater.terrain[0].y},time:0};
   const abandoned=world.prepare(game,view).catch(()=>{});
   while (!world.workerStats.inFlight) await new Promise(r=>setTimeout(r,1));
   setSeed(90210);const next=generateTheater();Object.assign(game,next,{cam:{x:next.terrain[0].x,y:next.terrain[0].y}});
   await world.prepare(game,view);await abandoned;await world.settle();
   const staleBeforeCamera = world.workerStats.staleResults;
   const a=next.terrain[Math.floor(next.terrain.length/2)],b=next.terrain.reduce((best,t)=>Math.hypot(t.x-a.x,t.y-a.y)>Math.hypot(best.x-a.x,best.y-a.y)?t:best,next.terrain[0]);game.cam={x:a.x,y:a.y};world.update(game,view,1/60,1);
   game.cam={x:b.x,y:b.y};world.update(game,view,1/60,1);await world.prepare(game,view);await world.settle();
   const OriginalWorker=globalThis.Worker;globalThis.Worker=undefined;const fallback=createLandWorker(false);await fallback.ready;globalThis.Worker=OriginalWorker;
   const scheduler={cameraRejected:world.workerStats.staleResults>staleBeforeCamera,fallback:fallback.stats,ready:world.isReady(game,view),onlyCurrentTerrain:[...world.chunks.keys()].every(t=>next.terrain.includes(t)),stats:world.workerStats};
   return {results,scheduler,backend:'Chromium --disable-gpu; Canvas2D only, no WebGL context'};
  });
  console.log(JSON.stringify(result,null,2));
  for(const row of result.results){assert.ok(row.geometryEqual);assert.ok(row.trafficEqual);assert.equal(row.changedChannels,0,'worker bake pixel equality');}
  assert.ok(result.scheduler.ready&&result.scheduler.onlyCurrentTerrain);assert.equal(result.scheduler.stats.mode,'worker');assert.ok(result.scheduler.cameraRejected);assert.equal(result.scheduler.fallback.mode,'sync-fallback');
  console.log('PASS real worker geometry, traffic, texture pixels and stale-world scheduler');
 }finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
