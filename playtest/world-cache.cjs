// Real world streaming lifecycle with fake Three objects; no WebGL required.
// node --experimental-vm-modules playtest/world-cache.cjs
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),ctx=vm.createContext({console}),mods=new Map();
let builds=0;const disposed=new Set(),attached=new Set();
class Vector {set(){} normalize(){return this;}}
class Mesh {constructor(){this.position=new Vector();this.scale=new Vector();this.rotation={};}}
const three={Vector2:Vector,Vector3:Vector,Color:Vector,ShaderMaterial:class {constructor(o){Object.assign(this,o)}},Mesh,PlaneGeometry:class{}};
const fake={three, './config.js':{CONFIG:{render:{ocean:{wind:[0,0]},sunOffset:[1,1,1]}}},
 './noise.js':{noiseTexture:()=>null,NOISE_GLSL:''},
 './traffic.js':{createTraffic:()=>({update(){}})},
 './land.js':{createLand:()=>({build(){builds++;return {serial:builds,traverse(fn){fn({geometry:{attributes:{position:{array:{byteLength:2*1024*1024}}}}})}}},dispose(g){assert.ok(!disposed.has(g),'each group disposed once');assert.ok(!attached.has(g),'visible group never disposed');disposed.add(g)}})}};
async function load(file){if(mods.has(file))return mods.get(file);const m=new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{context:ctx,identifier:file});mods.set(file,m);return m;}
(async()=>{
 const m=await load(path.join(root,'src/world.js'));
 await m.link(async(name,parent)=>{if(fake[name]){const values=fake[name],keys=Object.keys(values);return new vm.SyntheticModule(keys,function(){for(const k of keys)this.setExport(k,values[k]);},{context:ctx});}return load(path.resolve(path.dirname(parent.identifier),name));});await m.evaluate();
 const world=m.namespace.createWorld({add:g=>attached.add(g),remove:g=>attached.delete(g)});
 const terrain=Array.from({length:12},(_,i)=>({id:i,x:i*10000,y:0,radius:100}));
 const game={terrain,territories:[],cam:{x:0,y:0},time:0,geographySeed:42};
 const visit=i=>{game.cam.x=i*10000;world.update(game,{W:800,H:400},1/60,1);};
 visit(0);const first=world.chunks.get(terrain[0]);visit(1);visit(0);
 assert.equal(builds,2,'return to recent island avoids bake/build');assert.equal(world.chunks.get(terrain[0]),first,'exact GPU resource identity retained');
 for(let cycle=0;cycle<3;cycle++)for(let i=0;i<12;i++){
  visit(i);const s=world.cacheStats;assert.ok(s.detachedBytes<=s.maxDetachedBytes);assert.ok(s.detachedCount<=4);assert.equal(world.chunkCount,1);
 }
 assert.ok(world.cacheStats.evictions>0,'long transit actually evicts');assert.ok(disposed.has(first),'old least-recently-used island disposed');
 const before=builds;game.geographySeed++;visit(11);assert.equal(builds,before+1,'new geography invalidates same-coordinate island');assert.equal(world.cacheStats.detachedCount,0);
 game.terrain=[];world.update(game,{W:800,H:400},0,1);
 assert.equal(world.chunkCount,0);assert.equal(world.cacheStats.estimatedResidentBytes,0);assert.equal(disposed.size,builds,'reset disposes every built group exactly once');
 const {DetachedLandCache}=mods.get(path.join(root,'src/world-cache.js')).namespace;
 const freed=[];const c=new DetachedLandCache(g=>freed.push(g),10,9);
 c.put('a','A',6);c.put('b','B',4);assert.equal(c.take('a'),'A');c.put('a','A',6);
 c.put('c','C',4);assert.deepEqual(freed,['B'],'recent reuse protects A; oldest B evicted by bytes');
 c.put('huge','H',11);assert.equal(c.bytes,0,'oversized detached item cannot exceed byte cap');assert.ok(freed.includes('H'));
 console.log(`PASS cached revisit, bounded 36-island transit, LRU disposal, seed reset and full release (${builds} builds)`);
})().catch(e=>{console.error(e);process.exitCode=1;});
