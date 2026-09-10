// Adapt the shared expedition geography into operational holdings and sea routes.
import { CONFIG } from './config.js';
import { rand, TAU } from './util.js';
import { generate } from './expedition-geography.js';
import { insidePolygon } from './surface.js';

function pointSegmentDistance(point, a, b) {
  const dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy;
  const t=length2?Math.max(0,Math.min(1,((point.x-a[0])*dx+(point.y-a[1])*dy)/length2)):0;
  return Math.hypot(point.x-a[0]-t*dx,point.y-a[1]-t*dy);
}

// An enclosing disk covers every ship, at every heading, including turn sweeps.
// Testing continuous segments against enclosing land disks proves the whole
// formation stays offshore; sampling only carrier waypoints would not do that.
export function fleetRouteClearance() {
  return Math.max(Math.hypot(CONFIG.carrier.length,CONFIG.carrier.width)/2,
    Math.hypot(CONFIG.fleet.escortAhead,CONFIG.fleet.escortLateral)
      +Math.hypot(CONFIG.ship.length,CONFIG.ship.width)/2)
    +CONFIG.theater.fleetCoastClearance;
}
export function fleetRouteIsClear(route, terrain, clearance=fleetRouteClearance()) {
  return route.every((a,i)=>terrain.every(t=>pointSegmentDistance(t,a,route[(i+1)%route.length])>t.extent+clearance));
}
function offshoreRoute(region, terrain) {
  const length=CONFIG.theater.fleetPatrolLength, clearance=fleetRouteClearance();
  // Search nearby waters first, then outside the region. This is intentionally
  // independent of holding placement: ships patrol water, not objective slots.
  for(let ring=0;ring<12;ring++) for(let step=0;step<32;step++) {
    const a=region.heading+step/32*TAU, distance=region.radius+clearance+ring*length*.4;
    const x=region.x+Math.cos(a)*distance,y=region.y+Math.sin(a)*distance;
    const points=[[-length/2,0],[length/2,0],[0,length*.4]].map(([u,v])=>[
      x-Math.sin(a)*u+Math.cos(a)*v,y+Math.cos(a)*u+Math.sin(a)*v]);
    if(fleetRouteIsClear(points,terrain,clearance))return points;
  }
  // A guaranteed offshore fallback beyond all terrain, not a best-effort unsafe route.
  const x=Math.max(...terrain.map(t=>t.x+t.extent))+clearance+length;
  return [[x,region.y],[x+length,region.y],[x+length/2,region.y+length/2]];
}
function portCoast(holding, land) {
  let closest=null;
  for(let i=0;i<land.shoreline.length;i++) {
    const [ax,ay]=land.shoreline[i],[bx,by]=land.shoreline[(i+1)%land.shoreline.length];
    const dx=bx-ax,dy=by-ay,length=Math.hypot(dx,dy);
    const t=Math.max(0,Math.min(1,((holding.x-land.x-ax)*dx+(holding.y-land.y-ay)*dy)/(length*length)));
    const x=ax+t*dx,y=ay+t*dy,distance=Math.hypot(x+land.x-holding.x,y+land.y-holding.y);
    // At a concave vertex one edge normal can point across the next headland.
    if(insidePolygon(x+dy/length*50,y-dx/length*50,land.shoreline))continue;
    if(!closest||distance<closest.distance)closest={x:x+land.x,y:y+land.y,a:Math.atan2(-dx,dy),distance};
  }
  return closest;
}
function fitsRunway(holding, land, angle) {
  return [-CONFIG.airfield.length/2,0,CONFIG.airfield.length/2].every(along=>
    [-CONFIG.airfield.width/2,CONFIG.airfield.width/2].every(side=>insidePolygon(
      holding.x-land.x+Math.cos(angle)*along-Math.sin(angle)*side,
      holding.y-land.y+Math.sin(angle)*along+Math.cos(angle)*side,land.shoreline)));
}

export function generateTheater() {
  const geography=generate(Math.floor(rand(0,4294967296)));
  const terrain=geography.islands.map(t=>({id:t.id,seed:geography.seed+t.id,x:t.x,y:t.y,
    radius:Math.max(t.rx,t.ry),extent:Math.max(...t.coast.map(p=>Math.hypot(...p))),
    kind:t.kind,a:t.a,sector:t.region,region:t.region,holdingId:null,holdingIds:[],shoreline:t.coast}));
  // Choose an existing island on the first passage for the forward runway.
  // Largest-island ranking alone can put it behind home, making capture useless.
  const firstDestination=geography.regions[1];
  const radarIsland=geography.holdings.find(h=>h.id===1).island;
  const forward=geography.islands.filter(t=>t.region===0&&t.id!==0&&t.id!==radarIsland
    &&fitsRunway(t,terrain[t.id],t.a+(t.ry>=t.rx?Math.PI/2:0)))
    .sort((a,b)=>Math.hypot(a.x-firstDestination.x,a.y-firstDestination.y)-Math.hypot(b.x-firstDestination.x,b.y-firstDestination.y))[0];
  const territories=geography.holdings.map(original=>{
    const h={...original};
    if(h.id===2&&forward)Object.assign(h,{x:forward.x,y:forward.y,island:forward.id});
    const physical=terrain[h.island], source=geography.islands[h.island];
    // The home archipelago supports a first reconnaissance sortie and a forward
    // runway before the first long passage. Its coastline remains exactly atlas-generated.
    let role=h.role==='home airfield'?'airfield':h.role==='seaplane station'?'radar':h.role;
    if(h.region===0&&h.id===1)role='radar';
    if(h.region===0&&h.id===2)role='airfield';
    let coast=null;
    if(role==='port') {
      coast=portCoast(h,physical);
      // The capture point and port buildings belong at the actual anchorage,
      // not an invisible point in the middle of a large island.
      h.x=coast.x-Math.cos(coast.a)*CONFIG.theater.portSetback;h.y=coast.y-Math.sin(coast.a)*CONFIG.theater.portSetback;
      if(!insidePolygon(h.x-physical.x,h.y-physical.y,physical.shoreline)) {
        h.x=(coast.x+physical.x)/2;h.y=(coast.y+physical.y)/2;
      }
    }
    const a=source.a+(source.ry>=source.rx?Math.PI/2:0);
    if(role==='airfield'&&!fitsRunway(h,physical,a))throw new Error('Generated airfield does not fit its shoreline');
    const radius=role==='airfield'?420:role==='port'?365:265;
    physical.holdingIds.push(h.id);physical.holdingId??=h.id;
    return {id:h.id,name:h.id===0?'HOME AIRFIELD':`${geography.regions[h.region].name} ${role}`.toUpperCase(),
      x:h.x,y:h.y,radius,role,portShore:coast?{x:coast.x-h.x,y:coast.y-h.y,a:coast.a}:null,sector:h.region,region:h.region,seed:physical.seed,a,terrainId:physical.id,
      // A holding footprint is expressed relative to its own origin, even when
      // multiple installations occupy one physical island.
      shoreline:physical.shoreline.map(([x,y])=>[x+physical.x-h.x,y+physical.y-h.y]),
      extent:physical.extent+Math.hypot(physical.x-h.x,physical.y-h.y),
      stronghold:!!geography.regions[h.region].stronghold,owner:h.id?'enemy':'us',activated:!h.id,
      progress:0,fighters:h.id===1?2:h.region===0?3:4};
  });
  const sectors=geography.regions.map(r=>({...r,neighbors:geography.links.filter(link=>link.includes(r.id)).map(link=>link.find(id=>id!==r.id))}));
  const fleetRoutes={us:offshoreRoute(sectors[0],terrain),jp:offshoreRoute(sectors.find(r=>r.stronghold),terrain)};
  const theaterBounds={...geography.bounds}, margin=fleetRouteClearance();
  for(const route of Object.values(fleetRoutes))for(const [x,y] of route) {
    theaterBounds.minX=Math.min(theaterBounds.minX,x-margin);theaterBounds.maxX=Math.max(theaterBounds.maxX,x+margin);
    theaterBounds.minY=Math.min(theaterBounds.minY,y-margin);theaterBounds.maxY=Math.max(theaterBounds.maxY,y+margin);
  }
  return {territories,terrain,sectors,sectorLinks:geography.links,regionLinks:geography.links,
    geographySeed:geography.seed,theaterBounds,fleetRoutes};
}
