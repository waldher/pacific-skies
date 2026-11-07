// CPU-only canonical coast regressions, including 500 seeded campaigns.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),context=vm.createContext({console}),modules=new Map();
async function load(f){if(modules.has(f))return modules.get(f);const m=new vm.SourceTextModule(fs.readFileSync(f,'utf8'),{context,identifier:f});modules.set(f,m);return m;}
async function ns(f){const m=await load(path.join(root,f));if(m.status==='unlinked')await m.link((s,p)=>load(path.resolve(path.dirname(p.identifier),s)));if(m.status==='linked')await m.evaluate();return m.namespace;}
const distance=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
(async()=>{
 const{generateTheater,coastalHome}=await ns('src/theater.js'),{generate}=await ns('src/expedition-geography.js'),{setSeed}=await ns('src/util.js'),{islandOutline,onLand,insidePolygon}=await ns('src/surface.js'),{simpleCoast,refineCoast}=await ns('src/coast-refinement.js');
 const seeds=Number(process.argv[2]||500);
 let islands=0,maxVertices=0,maxDisplacement=0;
 for(let seed=1;seed<=seeds;seed++) {
  if(seed%100===0)console.log(`Checking campaign ${seed}/500`);
  setSeed(seed);const w=generateTheater(),atlas=generate(w.geographySeed),home=w.territories[0],coarse=atlas.islands[home.terrainId];
  const expected=coastalHome({...w.terrain[home.terrainId],shoreline:coarse.coast});assert.equal(home.x,expected.x);assert.equal(home.y,expected.y);assert.equal(home.a,expected.a);
  for(const t of w.terrain) {
   const original=atlas.islands[t.id].coast;islands++;maxVertices=Math.max(maxVertices,t.shoreline.length);assert.ok(t.shoreline.length<=256);assert.ok(simpleCoast(t.shoreline));assert.equal(islandOutline(t),t.shoreline);
   let edge=0;for(const p of t.shoreline){const next=original[(edge+1)%original.length];if(p[0]===next[0]&&p[1]===next[1])edge=(edge+1)%original.length;assert.ok(Math.hypot(...p)<=t.extent+1e-7);const d=distance(p,original[edge],original[(edge+1)%original.length]);maxDisplacement=Math.max(maxDisplacement,d);assert.ok(d<=18.000001);}
  }
  for(const h of w.territories) {
   const t=w.terrain[h.terrainId];assert.equal(h.shoreline.length,t.shoreline.length);
   if(h.role==='airfield')for(let along=-170;along<=170;along+=20)for(let side=-100;side<=100;side+=20){const x=h.x+Math.cos(h.a)*along-Math.sin(h.a)*side,y=h.y+Math.sin(h.a)*along+Math.cos(h.a)*side;const wasDry=insidePolygon(x-t.x,y-t.y,atlas.islands[t.id].coast);if(h.id===0||wasDry)assert.ok(onLand({x,y},[t]),`runway/apron seed${seed} holding${h.id}`);}
   if(h.portShore){const sx=h.x+h.portShore.x,sy=h.y+h.portShore.y;assert.ok(insidePolygon(h.x-t.x,h.y-t.y,t.shoreline));for(const d of[20,50,90])assert.ok(!onLand({x:sx+Math.cos(h.portShore.a)*d,y:sy+Math.sin(h.portShore.a)*d},[t]),`port access seed${seed}`);}
  }
 }
 setSeed(1942);const fixed=generateTheater().territories[0];assert.equal(fixed.x,1635.1159343712861);assert.equal(fixed.y,1112.3515476414532);assert.equal(fixed.a,.9005123873032034);
 const old={radius:10,extent:20,x:0,y:0,shoreline:[[-10,-10],[10,-10],[10,10],[-10,10]]},saved=JSON.stringify(old);assert.equal(islandOutline(old),old.shoreline);assert.ok(onLand({x:0,y:0},[old]));assert.equal(JSON.stringify(old),saved,'saved shoreline unmodified');
 const p=[[-100,-100],[100,-100],[100,100],[-100,100]];assert.equal(JSON.stringify(refineCoast(p,987)),JSON.stringify(refineCoast(p,987)));assert.ok(simpleCoast(refineCoast([...p].reverse(),987)));
 console.log(JSON.stringify({pass:true,seeds,islands,maxVertices,maxDisplacement,fixedHome:fixed.id}));
})().catch(e=>{console.error(e);process.exitCode=1;});
