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
 const {game,startGame,recoverPilot}=await namespace('src/state.js');
 const {setSeed}=await namespace('src/util.js');
 const {generateTheater,fleetRouteIsClear}=await namespace('src/theater.js');
 const {generate}=await namespace('src/expedition-geography.js');
 const counts=new Set();let smallestGap=Infinity;
 for(let seed=1;seed<=100;seed++){
  setSeed(seed);const world=generateTheater();counts.add(world.sectors.length);
  assert.ok(world.sectors.length>=4&&world.sectors.length<=7,`region count seed ${seed}`);
  const atlas=generate(world.geographySeed);
  assert.equal(world.terrain.length,atlas.islands.length,'game retains atlas landforms');
  for(const land of world.terrain){
   const original=atlas.islands[land.id];assert.equal(land.x,original.x);assert.equal(land.y,original.y);
   // The atlas retains large-scale geography; canonical physical coast detail
   // may add bounded coves between its anchors, never move those anchors.
   const coast=land.shoreline;assert.ok(coast.length<=256,'bounded coastline complexity');
   let cursor=-1;
   for(const anchor of original.coast){const i=coast.findIndex((p,index)=>index>cursor&&p[0]===anchor[0]&&p[1]===anchor[1]);assert.ok(i>cursor,'atlas anchors preserved in original order');cursor=i;}
   for(const p of coast){
    let closest=Infinity;
    for(let i=0;i<original.coast.length;i++){
     const a=original.coast[i],b=original.coast[(i+1)%original.coast.length],dx=b[0]-a[0],dy=b[1]-a[1];
     const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));
     closest=Math.min(closest,Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy));
    }
    assert.ok(closest<=18.000001,'fine shoreline stays within18 units of atlas coast');
   }
   for(const holding of world.territories.filter(t=>t.terrainId===land.id))assert.equal(JSON.stringify(holding.shoreline),JSON.stringify(coast.map(([x,y])=>[x+land.x-holding.x,y+land.y-holding.y])),'holdings and collisions share canonical coast');
  }
  for(const [a,b] of world.sectorLinks){const x=world.sectors[a],y=world.sectors[b],gap=Math.hypot(x.x-y.x,x.y-y.y);smallestGap=Math.min(smallestGap,gap);assert.ok(gap>6500,'regional crossings have meaningful scale');}
  for(const route of Object.values(world.fleetRoutes))assert.ok(fleetRouteIsClear(route,world.terrain),'whole fleet routes clear land');
  setSeed(seed);assert.equal(JSON.stringify(generateTheater()),JSON.stringify(world),'seed reproduces the entire operational theater');
 }
 assert.ok(counts.size>1,'seed corpus varies region count');
 console.log(`PASS 100 seeded game maps preserve atlas anchors and bounded coast detail, deterministic worlds, safe fleet routes; shortest regional link ${Math.round(smallestGap)} units`);
 setSeed(1942);startGame();
 const {selectSortie}=await namespace('src/bases.js');
 const home={x:game.player.x,y:game.player.y};
 const forward=game.bases.filter(b=>b.kind==='airfield'&&b.id!=='home-airfield').sort((a,b)=>Math.hypot(b.x-home.x,b.y-home.y)-Math.hypot(a.x-home.x,a.y-home.y))[0];
 assert.ok(forward,'generated expedition offers a forward airfield');
 const field=game.airfields.find(f=>f.id===forward.airfieldId);assert.ok(field);
 const holding=game.territories.find(t=>t.id===field.territory);assert.ok(holding);
 assert.equal(selectSortie(game,{baseId:forward.id,aircraft:'p38',loadout:'bombs'}),false,'enemy field cannot be selected');
 holding.owner='us';field.owner='us';field.hp=field.maxHp;forward.owner='us';forward.available=true;
 assert.equal(selectSortie(game,{baseId:forward.id,aircraft:'p38',loadout:'bombs'}),true);
 const destination={x:forward.x+1000,y:forward.y};
 assert.ok(Math.hypot(game.player.x-destination.x,game.player.y-destination.y)<Math.hypot(home.x-destination.x,home.y-destination.y)/2,'forward deployment meaningfully shortens the next flight');
 console.log('PASS captured forward airfield unlocks launch access and shortens next operation');
 const {aircraftUnlocked}=await namespace('src/aircraft-types.js');
 game.rank=2;game.score=100000;game.combatSorties=100;game.flightSeconds=10000;
 const qualificationBefore=aircraftUnlocked(game,'corsair');assert.equal(qualificationBefore,true);
 game.unlockedAircraft=['p38','dauntless','corsair'];game.intelligence.chartedRegions=[0,holding.sector];
 const report=game.sessionReport,war=game.territories,chart=JSON.stringify(game.intelligence);
 game.mode='recovery';game.player.hp=0;
 assert.equal(recoverPilot(forward.id),true);assert.equal(game.player.baseId,forward.id);
 assert.equal(game.territories,war);assert.equal(holding.owner,'us');assert.equal(game.sessionReport,report);
 assert.equal(JSON.stringify(game.intelligence),chart);assert.equal(aircraftUnlocked(game,'corsair'),true);
 assert.equal(JSON.stringify(game.unlockedAircraft),JSON.stringify(['p38','dauntless','corsair']));
 assert.ok(game.player.bombAmmo>0&&game.player.hp>0);
 console.log('PASS recovery at chosen forward field preserves conquered land, explored chart, session report and aircraft qualifications');

 setSeed(1942);startGame();
 const {updateStrikes}=await namespace('src/strikes.js');
 const homeBase=game.bases.find(b=>b.id==='home-airfield'),homeField=game.airfields.find(f=>f.id===homeBase.airfieldId);
 const source=game.airfields.find(f=>f.owner==='enemy');assert.ok(source);
 game.bases=[homeBase];game.ships=[];game.airfields=[homeField,source];game.enemies=[];game.player.flight='flying';
 game.territories=game.territories.filter(t=>t.id===homeField.territory||t.id===source.territory);
 game.territories.find(t=>t.id===homeField.territory).sector=0;
 const sourceHolding=game.territories.find(t=>t.id===source.territory);sourceHolding.sector=2;
 game.sectorLinks=[[0,1],[1,2]];source.launchTimer=0;game.strikeLaunchCooldown=0;
 updateStrikes(game,0);assert.equal(game.enemies.length,0,'distant source cannot skip the middle front');
 sourceHolding.sector=1;source.launchTimer=0;updateStrikes(game,0);
 assert.ok(game.enemies.length>0,'adjacent enemy source launches');
 assert.ok(game.enemies.every(e=>e.sourceId===source.id&&e.targetBaseId===homeBase.id),'attack has traceable source and target');
 game.enemies=[];game.strikeLaunchCooldown=0;source.launchTimer=0;source.hp=0;updateStrikes(game,0);assert.equal(game.enemies.length,0,'destroying source buys actual safety');
 console.log('PASS pressure respects regional adjacency; destroying launch source stops new raids');
})().catch(error=>{console.error(error);process.exitCode=1;});
