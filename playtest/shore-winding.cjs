// CPU-only regression: exercise the exact geometry helper used by the worker.
// Run: node --experimental-vm-modules --no-warnings playtest/shore-winding.cjs
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),context=vm.createContext({console}),modules=new Map();
async function load(file){if(modules.has(file))return modules.get(file);const m=new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{context,identifier:file});modules.set(file,m);return m;}
async function namespace(file){const m=await load(path.join(root,file));if(m.status==='unlinked')await m.link((s,p)=>load(path.resolve(path.dirname(p.identifier),s)));if(m.status==='linked')await m.evaluate();return m.namespace;}
const area=ring=>Math.abs(ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+p[0]*q[1]-q[0]*p[1];},0)/2);
function inspect(g){const p=g.attributes.position.array,index=g.index.array;let total=0;for(let i=0;i<index.length;i+=3){const a=index[i]*3,b=index[i+1]*3,c=index[i+2]*3;const ny=(p[b+2]-p[a+2])*(p[c]-p[a])-(p[b]-p[a])*(p[c+2]-p[a+2]);assert.ok(ny>0,`front-facing upward triangle: ${ny}`);total+=ny/2;}return{triangles:index.length/3,total};}
(async()=>{
 const {bandGeometry}=await namespace('src/land.js');
 const shapes={convex:[[-2,-2],[2,-2],[2,2],[-2,2]],concave:[[-3,-2],[3,-2],[3,2],[1,2],[0,.2],[-1,2],[-3,2]],duplicate:[[-2,-2],[2,-2],[2,-2],[2,2],[-2,2]]};
 for(const[name,shape]of Object.entries(shapes))for(const reverse of[false,true]){
  const points=reverse?[...shape].reverse():shape,rings=[.8,1,1.2].map(f=>points.map(([x,y])=>[x*f,y*f]));
  const g=bandGeometry(rings,[0,()=>.75,0]),result=inspect(g);
  assert.ok(Math.abs(result.total-(area(rings[2])-area(rings[0])))<1e-5,`${name}: no missing/duplicate band coverage`);
  const expected=(shape.length-(name==='duplicate'?1:0))*4;assert.equal(result.triangles,expected);
  assert.equal(g.attributes.fade.array[points.length],.75,'functional fade remains intact');g.dispose();
 }
 const collapsed=bandGeometry([shapes.convex,shapes.convex],[0,1]);assert.equal(collapsed.index.count,0);collapsed.dispose();
 assert.throws(()=>bandGeometry([shapes.convex,[[NaN,0],[1,0],[1,1],[0,1]]],[0,1]),/finite rings/);
 assert.throws(()=>bandGeometry([shapes.convex,[[0,0],[1,1],[0,1]]],[0,1]),/equal finite rings/);
 // Real home geometry, including the actual concave 48-vertex outline.
 const {generateTheater}=await namespace('src/theater.js'),{setSeed}=await namespace('src/util.js'),{islandOutline}=await namespace('src/surface.js');
 setSeed(1942);const theater=generateTheater(),home=theater.territories[0],t=theater.terrain.find(t=>t.id===home.terrainId),shore=islandOutline(t);
 const {insetShore,offsetShore}=await namespace('src/land.js');
 const surf=bandGeometry([insetShore(shore,3),shore,offsetShore(shore,-14)],[0,1,0]);const result=inspect(surf);assert.equal(result.triangles,shore.length*4);surf.dispose();
 console.log(`PASS shore bands: CW/CCW convex and concave coverage, duplicate/collapsed edges, invalid rings, fades and ${result.triangles} upward real-home surf triangles`);
})().catch(e=>{console.error(e);process.exitCode=1;});
