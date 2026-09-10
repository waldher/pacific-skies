// Expedition integration regressions against real modules, without WebGL.
// Run: node --experimental-vm-modules playtest/expedition.cjs
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'), records=new Map();
const context=vm.createContext({console,Math,localStorage:{getItem:k=>records.get(k)||null,setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)}});
const modules=new Map();
async function load(file){if(modules.has(file))return modules.get(file);const m=new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{context,identifier:file});modules.set(file,m);return m;}
const link=(name,parent)=>load(path.resolve(path.dirname(parent.identifier),name));
async function namespace(file){const m=await load(path.join(root,file));if(m.status==='unlinked')await m.link(link);if(m.status==='linked')await m.evaluate();return m.namespace;}
(async()=>{
 const {generateTheater}=await namespace('src/theater.js');
 const {setSeed}=await namespace('src/util.js');
 const {insidePolygon}=await namespace('src/surface.js');
 let min=Infinity,max=0;
 for(let seed=1;seed<=500;seed++){
  setSeed(seed);const world=generateTheater(),home=world.territories[0],land=world.terrain[home.terrainId];
  const px=home.x-land.x,py=home.y-land.y;
  const distance=Math.min(...land.shoreline.map(([ax,ay],i)=>{
   const [bx,by]=land.shoreline[(i+1)%land.shoreline.length],dx=bx-ax,dy=by-ay;
   const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)));
   return Math.hypot(px-ax-t*dx,py-ay-t*dy);
  }));
  min=Math.min(min,distance);max=Math.max(max,distance);
  assert.ok(distance>=100&&distance<=116,`shore visible beside home seed ${seed}: ${distance}`);
  for(let along=-170;along<=170;along+=5)for(let side=-100;side<=100;side+=5)
   assert.ok(insidePolygon(px+Math.cos(home.a)*along-Math.sin(home.a)*side,py+Math.sin(home.a)*along+Math.cos(home.a)*side,land.shoreline),`runway and hangar apron entirely on land seed ${seed}`);
 }
 console.log(`PASS 500 coastal homes: full runway/apron inland, shore ${min.toFixed(1)}–${max.toFixed(1)} units away`);
})().catch(error=>{console.error(error);process.exitCode=1;});
