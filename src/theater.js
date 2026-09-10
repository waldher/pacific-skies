// A charted theater: strategic holdings sit in chains of independent landforms.
import { CONFIG } from './config.js';
import { rand, TAU } from './util.js';

export function generateTheater() {
  const C = CONFIG.theater || {}, scale = C.scale ?? 1, jitter = C.positionJitter ?? 110;
  const sectors = [
    { id: 'home', name: 'Coral Approaches', x: 0, y: -550 },
    { id: 'contested', name: 'Windward Archipelagos', x: 0, y: -2900 },
    { id: 'stronghold', name: 'Ember Anchorage', x: 0, y: -5300 },
  ];
  const specs = [
    ['HOME ISLAND', 0, 0, 410, 'airfield', 'home', 'long'],
    ['CORAL WATCH', 450, -1250, 265, 'radar', 'home', 'crescent'],
    ['JADE RUNWAY', -1300, -2350, 420, 'airfield', 'contested', 'long'],
    ['PALM HARBOR', 1450, -2350, 365, 'port', 'contested', 'crescent'],
    ['NORTH REEF', -1550, -3750, 255, 'radar', 'contested', 'crescent'],
    ['TURTLE FIELD', 1550, -3850, 410, 'airfield', 'contested', 'long'],
    ['EMBER ANCHORAGE', -700, -5150, 390, 'port', 'stronghold', 'crescent'],
    ['EMBER COMMAND', 650, -5450, 465, 'airfield', 'stronghold', 'long'],
  ];
  // Coherent regional bends change the approach routes, rather than jittering
  // each objective independently into another set of points.
  const westBend=rand(-280,220), eastBend=rand(-220,240), northDrift=rand(-240,240);
  const branchStagger=rand(-240,240), homeBend=rand(-220,220);
  for (let id=1;id<specs.length;id++) {
    const p=specs[id];
    if (id===1) p[1]+=homeBend;
    else if (p[5]==='contested') {
      const bend=p[1]<0?westBend:eastBend;
      p[1]+=bend*(id>=4?1:.45);
      p[2]+=(p[1]<0?1:-1)*branchStagger;
    } else { p[1]+=northDrift;p[2]+=branchStagger*.25; }
  }
  const terrain = [];
  function land(x,y,radius,kind,a,sector,holdingId) {
    const seed = rand(0,10000), id = terrain.length;
    // Crescents are a single concave shoreline, with an open water lagoon.
    const shoreline = [];
    if (kind === 'crescent') {
      const start = -.15 * Math.PI, end = 1.25 * Math.PI;
      for (let i=0;i<=18;i++) {
        const t=start+(end-start)*i/18, r=radius*rand(.92,1.06);
        shoreline.push([Math.cos(t)*r,Math.sin(t)*r*.85]);
      }
      for (let i=18;i>=0;i--) {
        const t=start+(end-start)*i/18, r=radius*rand(.43,.51);
        shoreline.push([Math.cos(t)*r,Math.sin(t)*r*.85]);
      }
      // The holding is on the outer back of the crescent, never in its lagoon.
      for (const p of shoreline) p[0] += radius*.71;
    } else {
      for(let i=0;i<24;i++) {
        const t=i/24*TAU, r=radius*rand(.9,1.08);
        shoreline.push([Math.cos(t)*r*(kind==='long'?.62:1),Math.sin(t)*r*(kind==='long'?1.28:.8)]);
      }
    }
    for (const p of shoreline) { const [px,py]=p;p[0]=px*Math.cos(a)-py*Math.sin(a);p[1]=px*Math.sin(a)+py*Math.cos(a); }
    const extent=Math.max(...shoreline.map(p=>Math.hypot(...p)));
    const result={id,seed,x,y,radius,extent,kind,a,sector,holdingId,shoreline};terrain.push(result);return result;
  }
  const territories=specs.map(([name,x,y,radius,role,sector,kind],id)=>{
    x=(x+(id?rand(-jitter,jitter):0))*scale;y=(y+(id?rand(-jitter,jitter):0))*scale;
    const shapeAngle=role==='airfield'?rand(-.16,.16):rand(0,TAU);
    const physical=land(x,y,radius,kind,id===0?0:shapeAngle,sector,id);
    return {id,name,x,y,radius,role,sector,seed:physical.seed,a:-Math.PI/2+(id===0?0:shapeAngle),terrainId:physical.id,
      shoreline:physical.shoreline,extent:physical.extent,stronghold:sector==='stronghold',owner:id?'enemy':'us',activated:!id,progress:0,fighters:id===1?2:id<6?3:4};
  });
  // Satellites follow each chain's long axis. Avoid the runway approach corridor.
  for(const t of territories) {
    const count=Math.floor(rand(C.satelliteMin??2,(C.satelliteMax??3)+1));
    for(let i=0;i<count;i++) {
      for (let attempt=0;attempt<4;attempt++) {
        const side=i%2?1:-1, x=t.x+side*rand(530,850), y=t.y+rand(-490,490);
        if(terrain.some(p=>Math.hypot(p.x-x,p.y-y)<p.extent+145)) continue;
        land(x,y,rand(65,145),'islet',rand(0,TAU),t.sector,null);break;
      }
    }
  }
  // A broken outer reef links the home chain, while remaining clear of takeoff.
  for(let i=0;i<7 && terrain.length<35;i++) land(-900-i*85,-350-i*170,rand(45,65),'islet',0,'home',null);
  const theaterBounds={minX:Math.min(...terrain.map(t=>t.x-t.extent))-650,maxX:Math.max(...terrain.map(t=>t.x+t.extent))+650,
    minY:Math.min(...terrain.map(t=>t.y-t.extent))-700,maxY:1250};
  const fleetRoutes={us:[[1100,1000],[2300,1100],[2900,300]],
    jp:[[3200,-2400],[3400,-4300],[3000,-5800]]};
  theaterBounds.maxX=Math.max(theaterBounds.maxX,3900);
  return {territories,terrain,sectors,theaterBounds,fleetRoutes};
}
