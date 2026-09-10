const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),records=new Map(),context=vm.createContext({console,Math,localStorage:{getItem:k=>records.get(k)||null,setItem:(k,v)=>records.set(k,v)}}),cache=new Map();
async function load(f){if(cache.has(f))return cache.get(f);const m=new vm.SourceTextModule(fs.readFileSync(f,'utf8'),{context,identifier:f});cache.set(f,m);return m;}const link=(s,p)=>load(path.resolve(path.dirname(p.identifier),s));
async function ns(f){const m=await load(path.join(root,f));if(m.status==='unlinked')await m.link(link);if(m.status==='linked')await m.evaluate();return m.namespace;}
(async()=>{
 const {game,startGame}=await ns('src/state.js'),{updateIntelligence}=await ns('src/intelligence.js'),{objectiveFor,updateGuidance,coursePhase,flightPresentation}=await ns('src/objectives.js'),persist=await ns('src/persistence.js');
 startGame();assert.ok(game.waypoint);assert.ok(['Find the enemy outpost','Capture radar','Bomb the runway'].includes(objectiveFor(game).title));
 const field=game.airfields.find(f=>f.owner==='enemy'),site=game.territories.find(t=>t.id===field.territory);
 Object.assign(game.player,{x:site.x,y:site.y,flight:'flying'});site.activated=true;updateIntelligence(game);
 game.waypoint={x:site.x,y:site.y,name:site.name,siteId:site.id,auto:true};assert.equal(objectiveFor(game).title,'Bomb the runway');
 field.hp=0;game.enemies=[{x:site.x,y:site.y,territory:site.id,hp:2}];assert.equal(objectiveFor(game).title,'Shoot down the defenders');
 game.enemies=[];assert.equal(objectiveFor(game).title,'Circle to capture');site.owner='us';field.owner='us';updateIntelligence(game);updateGuidance(game);assert.notEqual(game.waypoint?.siteId,site.id);
 game.waypoint={x:99,y:88,name:'Chosen',auto:false};game.player.hp=10;updateGuidance(game);assert.equal(game.waypoint.name,'Chosen');
 game.waypoint=null;game.guidanceCleared=true;game.player.hp=10;game.player.bombAmmo=0;updateGuidance(game);assert.equal(game.waypoint,null);assert.equal(objectiveFor(game).target,null);
 startGame();game.score=987;const home=game.territories[0],land=game.terrain.find(t=>t.id===home.terrainId);delete home.coastal;
 Object.assign(home,{x:land.x,y:land.y,shoreline:land.shoreline});const base=game.bases.find(b=>b.id==='home-airfield'),hf=game.airfields.find(f=>f.id===base.airfieldId);
 Object.assign(base,{x:land.x,y:land.y});Object.assign(hf,{x:land.x,y:land.y});Object.assign(game.player,{x:land.x,y:land.y,parked:{x:land.x,y:land.y}});
 assert.ok(persist.saveCampaign(game));const restored=persist.loadCampaign();assert.ok(restored.territories[0].coastal);assert.equal(restored.score,987);assert.equal(restored.player.x,restored.bases[0].x);assert.ok(Math.hypot(restored.player.x-land.x,restored.player.y-land.y)>100);assert.equal(restored.terrain[0].x,land.x);
 game.waypoint={x:game.player.x,y:game.player.y,name:'Arrival',siteId:999};
 assert.equal(coursePhase(game),'arrived');assert.equal(flightPresentation(game).detail,'');
 game.waypoint.x=game.player.x+600;assert.equal(coursePhase(game),'arrived');
 game.waypoint.x=game.player.x+701;assert.equal(coursePhase(game),'travel');
 game.waypoint.x=game.player.x+600;assert.equal(coursePhase(game),'travel');
 game.waypoint.x=game.player.x+499;assert.equal(coursePhase(game),'arrived');
 console.log('PASS stable arrival state and quiet flight presentation');
 console.log('PASS actionable objective phases, completion, manual courses, clear course and legacy coastal-save migration');
})().catch(e=>{console.error(e);process.exitCode=1});
