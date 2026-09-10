// Real state/save modules in a small VM: no renderer or browser storage dependency.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'), records=new Map();
const localStorage={getItem:k=>records.get(k)||null,setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)};
const context=vm.createContext({console,Math,localStorage}); const modules=new Map();
async function load(file) { if(modules.has(file))return modules.get(file); const m=new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{context,identifier:file}); modules.set(file,m);return m; }
const link=(name,parent)=>load(path.resolve(path.dirname(parent.identifier),name));
(async()=>{
 const state=await load(path.join(root,'src/state.js'));await state.link(link);await state.evaluate();
 const {game,startGame,recoverPilot,resumeCampaign}=state.namespace;
 const {updateFleets}=modules.get(path.join(root,'src/fleets.js')).namespace;
 const persist=modules.get(path.join(root,'src/persistence.js')).namespace;
 startGame();assert.equal(persist.hasSavedCampaign(),true);
 game.score=777;game.combatSorties=3;game.territories[1].owner='us';game.intelligence.sites[1]={id:1,x:12,y:13,seenAt:0};
 game.mode='recovery';game.player.hp=0;game.pilotLosses=1;
 const territories=game.territories,ships=game.ships,enemies=game.enemies;
 assert.equal(recoverPilot(),true);assert.equal(game.mode,'play');assert.equal(game.player.flight,'landed');
 assert.equal(game.score,777);assert.equal(game.combatSorties,3);assert.equal(game.territories,territories);
 assert.equal(game.ships,ships);assert.equal(game.enemies,enemies);assert.equal(game.intelligence.sites[1].x,12);
 game.player.flight='flying';game.player.x=1234;game.player.hp=47;persist.saveCampaign(game);
 game.player.x=0;game.score=0;assert.equal(resumeCampaign(),true);assert.equal(game.player.x,1234);assert.equal(game.player.hp,47);assert.equal(game.score,777);
 for(const fleet of new Set(game.ships.map(s=>s.fleet.id))) {
  const members=game.ships.filter(s=>s.fleet.id===fleet);assert.ok(members.every(s=>s.fleet===members[0].fleet));
 }
 updateFleets(game,.1);
 game.ships.find(s=>s.id==='enemy-carrier').hp=0;persist.saveCampaign(game);assert.equal(resumeCampaign(),true);
 assert.doesNotThrow(()=>updateFleets(game,.1));
 const survivingEscorts=game.ships.filter(s=>s.team==='jp' && s.kind==='destroyer');
 assert.ok(survivingEscorts.every(s=>s.hp>0 && Number.isFinite(s.x) && s.fleet===survivingEscorts[0].fleet));
 const validSave=records.get(persist.CAMPAIGN_SAVE_KEY);
 for (const mutate of [d=>d.player.aircraft='unknown',d=>d.terrain[0].shoreline=[null],d=>d.intelligence.sites={bad:null},d=>d.sectors=null,d=>d.sessionReport.owners=null]) {
  const malformed=JSON.parse(validSave);mutate(malformed.data);records.set(persist.CAMPAIGN_SAVE_KEY,JSON.stringify(malformed));assert.equal(persist.loadCampaign(),null);
 }
 game.mode='recovery';for(const b of game.bases)b.available=false;
 assert.equal(recoverPilot(),false);assert.equal(game.mode,'over');assert.equal(persist.hasSavedCampaign(),false);
 for(const raw of ['{','null',JSON.stringify({version:99,data:{}}),JSON.stringify({version:1,data:{mode:'play'}})]) {
 records.set(persist.CAMPAIGN_SAVE_KEY,raw);assert.equal(persist.loadCampaign(),null);
 }
 localStorage.setItem=()=>{throw new Error('quota')};assert.equal(persist.saveCampaign(game),false);
 console.log('PASS recovery preserves war, discovery and qualifications; exact resume; last-base loss; invalid saves; unavailable storage');
})().catch(e=>{console.error(e);process.exitCode=1});
