// Repeatable local balance experiment, using production flight, bullets and strike AI.
// Full default campaign: all enemies, allies, launch sites and conquest updates remain active.
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
  const mod = new vm.SourceTextModule(code, { context, identifier: file });
  cache.set(file, mod); return mod;
}
const link = (specifier, parent) => load(path.resolve(path.dirname(parent.identifier), specifier));
(async () => {
  const main=await load(path.join(root,'src/main.js'));await main.link(link);await main.evaluate();
  const api=context.window.__game, {game,keys}=api, rows=[];
  for(const seed of [17,42,93]) for(const observer of [false,true]) {
    api.setSeed(seed);api.startGame();game.strikeLaunchCooldown=0;
    if(observer) game.player.hp=1000000; // Explicit observer-only variant: prevent pilot death censoring base-loss time.
    game.player.flight='flying'; game.player.x=0;game.player.y=900;
    let time=0;
    for(;time<600 && game.mode==='play';time+=1/30) {
      for(const key of Object.keys(keys))keys[key]=false;
      const p=game.player, tx=Math.cos(time*.15)*250,ty=900+Math.sin(time*.15)*250;
      const diff=api.angDiff(p.a,Math.atan2(ty-p.y,tx-p.x));
      keys.ArrowLeft=diff<-.04;keys.ArrowRight=diff>.04;
      api.update(1/30);
    }
    rows.push({seed,variant:observer?'durable observer':'normal pilot',seconds:+time.toFixed(1),mode:game.mode,reason:game.endReason,playerHp:game.player.hp,homeHp:game.airfields[0].hp,homeOwner:game.airfields[0].owner,carrierHp:game.ships[0].hp,impacts:game.raidImpacts});
  }
  console.table(rows);
  fs.mkdirSync(path.join(__dirname,'shots'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'shots/campaign-balance.json'),JSON.stringify({scenario:'Full production simulation, default allies and launch sites, player flies home patrol without firing. Normal pilot ends on real defeat. Separately labeled durable observer starts with 1000000hp to measure siege duration without pilot-death censoring; no state intervention after setup.',rows},null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
