// Repeatable local balance experiment, using production flight, bullets and strike AI.
// This isolates one launch site and one base; it is not a campaign-solving AI.
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const element = { getContext: () => ({ setTransform() {} }), style: {}, addEventListener() {} };
const context = vm.createContext({ console, performance, Math, navigator: { maxTouchPoints: 0 },
  document: { getElementById: () => element }, requestAnimationFrame() {},
  window: { innerWidth: 900, innerHeight: 600, addEventListener() {} } });
const cache = new Map();
async function load(file) {
  if (cache.has(file)) return cache.get(file);
  let code = file.endsWith('/src/renderer.js') ? 'export async function createRenderer(){return {diagnostics:{ready:true}}}'
    : file.endsWith('/src/aircraft-previews.js') ? 'export const aircraftPreviews={}; export function renderAircraftPreviews(){}'
    : fs.readFileSync(file, 'utf8');
  if (file.endsWith('/src/main.js')) code = code.replace("updateAirWar(dt);", "").replace("updateEnemies(dt);", "").replace("if (game.mode === 'play') updateCampaign(game, dt, spawnDefenders);", "");
  const mod = new vm.SourceTextModule(code, { context, identifier: file });
  cache.set(file, mod); return mod;
}
const link = (specifier, parent) => load(path.resolve(path.dirname(parent.identifier), specifier));
(async () => {
  const main = await load(path.join(root,'src/main.js')); await main.link(link); await main.evaluate();
  const api = context.window.__game, {game, CONFIG, keys} = api;
  const rows = [];
  for (const seed of [17, 42, 93]) for (const kind of ['airfield','carrier']) for (const strategy of ['ignore','intercept','defenses']) {
    if(kind==='carrier' && strategy==='defenses') continue; // No carrier defense upgrade exists yet.
    api.setSeed(seed); api.startGame();game.strikeLaunchCooldown=0;
    game.allies = []; game.raidTimer = Infinity;
    game.territories.forEach(t => { t.activated = true; t.fighters = 0; t.established = CONFIG.conquest.establishSeconds; });
    game.airfields.forEach(f => f.hp = 0);
    const base = game.bases.find(b => b.kind === 'airfield');
    const field = game.airfields.find(f => f.id === (base.airfieldId ?? base.id));
    Object.assign(field,{hp:CONFIG.airfield.homeHp,maxHp:CONFIG.airfield.homeHp,x:0,y:0,owner:'us'});
    game.bases = [base]; game.ships = [];
    let asset = field;
    if (kind === 'carrier') {
      asset = {id:'balance-carrier',x:0,y:0,a:0,hp:CONFIG.progression.rescueHp,maxHp:CONFIG.progression.rescueHp,team:'us',kind:'carrier',active:true,fireCd:0,length:240,width:68};
      game.ships=[asset]; game.bases=[{id:'balance-deck',kind:'carrier',shipId:asset.id,owner:'us',available:true}];
      field.hp=0;game.territories.forEach(t=>t.owner='enemy');
    }
    game.bases[0].defenseLevel = strategy === 'defenses' ? 1 : 0;
    // Same launch geometry and schedule for each strategy; no teleporting after setup.
    const source = {id:'balance-source',owner:'enemy',hp:40,x:2000,y:0,launchTimer:15};
    game.airfields.push(source);
    let scheduleSeed=seed;
    const nextInterval=()=> {scheduleSeed=(1664525*scheduleSeed+1013904223)>>>0;return CONFIG.strike.intervalMin+(CONFIG.strike.intervalMax-CONFIG.strike.intervalMin)*scheduleSeed/4294967296;};
    game.player.x=0;game.player.y=900;game.player.a=0;game.player.flight='flying';game.player.baseId=null;
    let firstLoss = null, closest = Infinity, checkpoint180 = null;
    for (let frame=0;frame<420*30;frame++) {
      for (const key of Object.keys(keys)) keys[key]=false;
      const p = game.player;
      const targets=game.enemies.filter(e=>e.strike && e.phase==='attack' && e.hp>0 && e.strikeRole!=='escort');
      targets.sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y));
      const target = strategy==='intercept' ? targets[0] : null;
      let tx=0,ty=900;
      if(target) {
        const distance=Math.hypot(target.x-p.x,target.y-p.y),lead=distance/CONFIG.player.bulletSpeed;
        tx=target.x+Math.cos(target.a)*target.speed*lead;ty=target.y+Math.sin(target.a)*target.speed*lead;
        closest=Math.min(closest,distance);
        keys.Space=distance<650;
      } else { tx=Math.cos(game.time*.2)*250;ty=900+Math.sin(game.time*.2)*250; }
      const diff=api.angDiff(p.a,Math.atan2(ty-p.y,tx-p.x));
      keys.ArrowLeft=diff<-.04;keys.ArrowRight=diff>.04;
      keys.ArrowUp=!!target;
      const timerBefore=source.launchTimer;
      api.update(1/30);
      if(source.launchTimer>timerBefore) source.launchTimer=nextInterval();
      if(frame===180*30-1) checkpoint180={baseHp:Math.round(asset.hp),playerHp:Math.round(game.player.hp),impacts:game.raidImpacts||0};
      if(asset.hp<=0 || game.mode!=='play') {firstLoss=+(frame/30).toFixed(1);break;}
    }
    rows.push({seed,kind,strategy,baseHp:Math.round(asset.hp),playerHp:Math.round(game.player.hp),lossSeconds:firstLoss,outcome:asset.hp<=0?'base lost':game.player.hp<=0?'pilot lost':'survived',checkpoint180,
      impacts:game.raidImpacts||0,intercepts:game.raidIntercepts||0,score:game.score,closestEnemy:Number.isFinite(closest)?Math.round(closest):null});
  }
  console.table(rows);
  const out=path.join(__dirname,'shots');fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'balance.json'),JSON.stringify({limitations:'Isolated base-defense scenarios; ambient fighter AI and campaign updates disabled; no renderer, landing, conquest or human skill model. Bots use normal turn/speed/guns and have perfect awareness. Base loss or player death ends scenario.',rows},null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
