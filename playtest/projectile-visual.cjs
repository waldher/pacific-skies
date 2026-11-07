const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const context=vm.createContext({}),cache=new Map();
async function load(f){if(cache.has(f))return cache.get(f);const m=new vm.SourceTextModule(fs.readFileSync(f,'utf8'),{context,identifier:f});cache.set(f,m);return m;}
(async()=>{
 const m=await load(path.resolve(__dirname,'../src/projectile-visual.js'));await m.link((s,p)=>load(path.resolve(path.dirname(p.identifier),s)));await m.evaluate();
 const {aircraftRound,surfaceRound,updateRoundAltitude}=m.namespace;
 assert.equal(aircraftRound({}).renderAltitude,31);assert.equal(aircraftRound({altitude:15}).renderAltitude,14);
 const physics={x:10,y:20,vx:300,vy:-30,life:2,damage:9,fromShip:true};
 const b={...physics,...surfaceRound({x:0,y:0},{x:300,y:400,altitude:32},250,13)};
 assert.equal(b.renderAltitude,13);updateRoundAltitude(b,1);assert.equal(b.renderAltitude,22);
 updateRoundAltitude(b,1);assert.equal(b.renderAltitude,31);updateRoundAltitude(b,10);assert.equal(b.renderAltitude,31);
 for(const k of Object.keys(physics))assert.equal(b[k],physics[k],`visual interpolation modified gameplay field ${k}`);
 const airborne={...physics,...aircraftRound({altitude:28})};updateRoundAltitude(airborne,2);assert.equal(airborne.renderAltitude,27);
 const legacy={...physics};updateRoundAltitude(legacy,2);assert.deepEqual(legacy,physics);
 const zero=surfaceRound({x:0,y:0},{x:0,y:0},250,13);updateRoundAltitude(zero,.1);assert.ok(Number.isFinite(zero.renderAltitude));
 console.log('PASS render-only projectile heights: aircraft emission, AA interpolation/clamp, legacy fallback, zero range, gameplay fields untouched');
})().catch(e=>{console.error(e);process.exitCode=1});
