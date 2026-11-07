// Validate visual effects lifecycle without WebGL/audio or gameplay changes.
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const game={particles:[],shake:0},ctx=vm.createContext({console,Math});
 const source=new vm.SourceTextModule(fs.readFileSync('src/particles.js','utf8'),{context:ctx});
 const deps={ './config.js':{CONFIG:{render:{flightHeight:32}}}, './state.js':{game}, './util.js':{TAU:Math.PI*2,rand:(a,b)=>(a+b)/2}, './audio.js':{sfxBoom:()=>{}} };
 await source.link(spec=>{const obj=deps[spec];return new vm.SyntheticModule(Object.keys(obj),function(){for(const [k,v] of Object.entries(obj))this.setExport(k,v)},{context:ctx});});
 await source.evaluate();const {splash,explosion,updateParticles}=source.namespace;
 splash(12,34);assert.equal(game.particles.length,1);assert.equal(game.particles[0].kind,'splash');assert.equal(game.particles[0].altitude,1.5);
 updateParticles(1);assert.equal(game.particles.length,0);
 explosion(0,0,false,11);const small=Math.max(...game.particles.filter(p=>p.kind==='fire').map(p=>p.size));
 assert.ok(game.particles.every(p=>p.altitude===11));game.particles=[];
 explosion(0,0,true,32);const large=Math.max(...game.particles.filter(p=>p.kind==='fire').map(p=>p.size));assert.ok(large>=small*2,'large impact has a distinctly larger hot core');
 for(let i=0;i<120;i++)updateParticles(1/60);
 assert.equal(game.particles.length,0,'all fire/rings/smoke expire');
 for(let i=0;i<20;i++)explosion(0,0,true);updateParticles(.01);
 assert.ok(game.particles.length<=400,'effect budget stays bounded');
 assert.ok(game.particles.every(p=>['x','y','vx','vy','size','life','altitude'].every(k=>Number.isFinite(p[k]))));
 console.log('PASS particle visuals: water-only splash, surface altitude, distinct large core, expiration and budget');
})();
