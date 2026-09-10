// Deterministic geometry corpus independent of browser/rendering availability.
import assert from 'node:assert/strict';
import { generateTheater, fleetRouteIsClear } from '../src/theater.js';
import { generate } from '../src/expedition-geography.js';
import { createFleets, updateFleets } from '../src/fleets.js';
import { onLand, insidePolygon } from '../src/surface.js';
import { setSeed } from '../src/util.js';
import { CONFIG } from '../src/config.js';

const regionCounts=new Set(), landCounts=[], holdingCounts=[];
for(let seed=0;seed<500;seed++) {
  setSeed(seed);const theater=generateTheater();
  setSeed(seed);assert.deepEqual(generateTheater(),theater,`seed ${seed} reproduces campaign geometry`);
  const atlas=generate(theater.geographySeed);
  assert.equal(theater.terrain.length,atlas.islands.length);
  for(const land of theater.terrain) {
    const original=atlas.islands[land.id];
    assert.equal(land.x,original.x);assert.equal(land.y,original.y);
    assert.deepEqual(land.shoreline,original.coast,'game and approved atlas use identical coastlines');
    if(seed<100)for(const i of [0,12,24,36])for(const scale of [.99999,1.00001]) {
      const [x,y]=land.shoreline[i].map(v=>v*scale);
      assert.equal(onLand({x:land.x+x,y:land.y+y},[land]),insidePolygon(x,y,land.shoreline),'broadphase preserves classification at coastline');
    }
  }
  const home=theater.territories[0];
  assert.equal(home.owner,'us');assert.equal(home.role,'airfield');assert.equal(home.id,0);
  assert.ok(theater.territories.some(t=>t.id!==0&&t.sector===home.sector&&t.role==='airfield'));
  assert.ok(theater.territories.some(t=>t.sector===home.sector&&t.role==='radar'));
  const destination=theater.sectors[1],forward=theater.territories[2];
  assert.ok(Math.hypot(forward.x-destination.x,forward.y-destination.y)<Math.hypot(home.x-destination.x,home.y-destination.y),'first forward base shortens the first passage');
  for(const t of theater.territories) {
    const land=theater.terrain[t.terrainId];
    assert.ok(onLand(t,[land]),`holding ${t.id} lies on physical land for seed ${seed}`);
    // Translation must preserve the full physical footprint for a second
    // installation sharing a landmass, rather than duplicating a shifted coast.
    for(let i=0;i<land.shoreline.length;i++) {
      assert.ok(Math.abs(t.x+t.shoreline[i][0]-land.x-land.shoreline[i][0])<1e-7);
      assert.ok(Math.abs(t.y+t.shoreline[i][1]-land.y-land.shoreline[i][1])<1e-7);
    }
    if(t.role==='airfield') for(let along=-CONFIG.airfield.length/2;along<=CONFIG.airfield.length/2;along+=10)
      for(const side of [-CONFIG.airfield.width/2,CONFIG.airfield.width/2])
        assert.ok(onLand({x:t.x+Math.cos(t.a)*along-Math.sin(t.a)*side,
          y:t.y+Math.sin(t.a)*along+Math.cos(t.a)*side},[land]),`runway edge fits seed ${seed}`);
    if(t.role==='port') {
      const p=t.portShore;
      assert.ok(!onLand({x:t.x+p.x+Math.cos(p.a)*50,y:t.y+p.y+Math.sin(p.a)*50},theater.terrain),`pier extends into water seed ${seed}`);
    }
  }
  assert.ok(Object.values(theater.fleetRoutes).every(route=>fleetRouteIsClear(route,theater.terrain)));
  if(seed<12) {
    const ships=createFleets(theater);ships[0].active=true;
    const game={ships,player:{x:1e8,y:1e8,a:0,flight:'flying'}};
    // More than two complete circuits, including heading lag at every corner.
    for(let step=0;step<1400;step++) {
      updateFleets(game,1);
      for(const s of ships) {
        const nearbyLand=theater.terrain.filter(t=>Math.hypot(t.x-s.x,t.y-s.y)<t.extent+Math.hypot(s.length,s.width)/2);
        for(const along of [-s.length/2,0,s.length/2])for(const side of [-s.width/2,s.width/2])
        assert.ok(!onLand({x:s.x+Math.cos(s.a)*along-Math.sin(s.a)*side,
          y:s.y+Math.sin(s.a)*along+Math.cos(s.a)*side},nearbyLand),`moving fleet hull clear seed ${seed}`);
      }
    }
  }
  regionCounts.add(theater.sectors.length);landCounts.push(theater.terrain.length);holdingCounts.push(theater.territories.length);
}
assert.ok(regionCounts.size>1,'region count changes across seeds');
console.log(`PASS 500 deterministic atlas/game maps; runway edges, shared footprints, ports and continuous fleet clearance. Twelve fleet simulations cover complete patrol circuits.`);
console.log(JSON.stringify({regions:[...regionCounts].sort(),landforms:[Math.min(...landCounts),Math.max(...landCounts)],holdings:[Math.min(...holdingCounts),Math.max(...holdingCounts)]}));
