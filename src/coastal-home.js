import { coastalHome } from './theater.js';
import { CONFIG } from './config.js';
// Move legacy saved home facilities without changing the discovered world or ownership.
export function migrateCoastalHome(game) {
  const home=game.territories?.find(t=>t.id===0);
  if(!home || home.coastal)return;
  const land=game.terrain.find(t=>t.id===home.terrainId);
  if(!land)return;
  const next=coastalHome(land),old={x:home.x,y:home.y};
  Object.assign(home,{x:next.x,y:next.y,a:next.a,coastal:true,
    shoreline:land.shoreline.map(([x,y])=>[x+land.x-next.x,y+land.y-next.y]),
    extent:land.extent+Math.hypot(land.x-next.x,land.y-next.y)});
  const field=game.airfields.find(f=>f.territory===home.id),base=game.bases.find(b=>b.territory===home.id);
  for(const asset of [field,base])if(asset)Object.assign(asset,{x:next.x,y:next.y,a:next.a});
  const p=game.player;
  if(base && p.baseId===base.id && p.flight!=='flying'){
    Object.assign(p,{x:next.x,y:next.y,a:next.a,flight:'landed',flightTime:0,speed:0,
      parked:{x:next.x,y:next.y},parkedOffset:{along:0,lateral:0},altitude:CONFIG.airfield.deckHeight});
    delete p.arrival;delete p.departure;
  }
  if(game.waypoint && Math.hypot(game.waypoint.x-old.x,game.waypoint.y-old.y)<1)Object.assign(game.waypoint,{x:next.x,y:next.y});
  if(game.intelligence.sites[home.id])Object.assign(game.intelligence.sites[home.id],{x:next.x,y:next.y});
}
