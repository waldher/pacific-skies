// Shared seeded geography for the expedition game and its design atlas.
export const CRUISE = 275;
const TAU=Math.PI*2;
export function generate(seed=1942) {
  let state=seed>>>0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const between=(a,b)=>a+(b-a)*random(), pick=a=>a[Math.floor(random()*a.length)];
  const regions=[], islands=[], holdings=[], links=[];
  const names=['Aster Passage','The Broken Crown','Morrow Reaches','Glasswater Sea','Kestrel Islands','Far Lanterns','Blackwater Sound'];
  const identities=['volcanic arc','drowned caldera','great island','outer reefs'];
  const count=Math.floor(between(4,8));
  const orientation=between(-2.7,-.5);
  for(let i=0;i<count;i++) {
    let parent=i?Math.floor(between(Math.max(0,i-3),i)):null, x=0,y=0,heading=orientation;
    if(i) {
      let accepted=false;
      for(let attempt=0;attempt<120;attempt++) {
        if(attempt%20===0)parent=Math.floor(between(0,i));
        const p=regions[parent];heading=p.heading+between(-1.15,1.15);
        const d=between(10000,15000)*(attempt>90?1.3:1);
        x=p.x+Math.cos(heading)*d;y=p.y+Math.sin(heading)*d;
        if(regions.every(r=>Math.hypot(x-r.x,y-r.y)>9000)){accepted=true;break;}
      }
      if(!accepted)throw new Error('Could not place a separated region');
      links.push([parent,i]);
    }
    regions.push({id:i,name:names[i],x,y,heading,parent,identity:i===0?'great island':pick(identities),radius:between(2800,4400)});
  }
  // Occasional lateral sea passages make loops, without imposing a diamond template.
  for(let a=1;a<count;a++)for(let b=a+1;b<count;b++) {
    if(links.some(([i,j])=>(i===a&&j===b)||(i===b&&j===a)))continue;
    if(Math.hypot(regions[a].x-regions[b].x,regions[a].y-regions[b].y)<18500&&random()<.35)links.push([a,b]);
  }
  function land(region,x,y,rx,ry,a,kind='island') {
    const extent=Math.max(rx,ry);
    if(islands.some(t=>Math.hypot(t.x-x,t.y-y)<t.extent+extent+90))return null;
    const phase=between(0,TAU), coast=[];
    for(let k=0;k<48;k++) {
      const theta=k/48*TAU;
      const noise=1+.12*Math.sin(theta*3+phase)+.07*Math.sin(theta*7-phase)+between(-.025,.025);
      const u=Math.cos(theta)*rx*noise,v=Math.sin(theta)*ry*noise;
      coast.push([u*Math.cos(a)-v*Math.sin(a),u*Math.sin(a)+v*Math.cos(a)]);
    }
    const island={id:islands.length,region:region.id,x,y,rx,ry,a,extent:extent*1.2,coast,kind};islands.push(island);return island;
  }
  for(const r of regions) {
    const n=Math.floor(between(10,18)), bend=between(-1.1,1.1);
    if(r.identity==='great island')land(r,r.x,r.y,between(800,1300),between(1900,2800),r.heading,'mainland');
    for(let j=0;j<n;j++) {
      for(let attempt=0;attempt<24;attempt++) {
        let u,v,angle=r.heading,rx,ry;
        const t=between(-1,1);
        if(r.identity==='drowned caldera') {
          const q=between(0,TAU*.86),rad=r.radius*between(.72,1.1);u=Math.cos(q)*rad;v=Math.sin(q)*rad*.72;angle+=q+Math.PI/2;
          rx=between(170,400);ry=between(350,720);
        }else if(r.identity==='great island') {
          const q=between(0,TAU),rad=between(2900,4900);u=Math.cos(q)*rad;v=Math.sin(q)*rad;rx=between(180,430);ry=between(200,650);
        }else {
          u=t*r.radius*1.35;v=bend*t*t*r.radius*.55+between(-650,650);
          angle+=Math.atan2(bend*t,1);
          rx=between(140,r.identity==='outer reefs'?340:650);ry=between(180,r.identity==='outer reefs'?450:900);
        }
        const x=r.x+u*Math.cos(r.heading)-v*Math.sin(r.heading),y=r.y+u*Math.sin(r.heading)+v*Math.cos(r.heading);
        if(land(r,x,y,rx,ry,angle,r.identity==='outer reefs'?'reef':'island'))break;
      }
    }
    const candidates=islands.filter(t=>t.region===r.id).sort((a,b)=>b.extent-a.extent);
    const desired=r.id===0?3:Math.floor(between(1,4));
    for(let j=0;j<Math.min(desired,candidates.length);j++) {
      const t=candidates[j];
      const role=j===0?(r.id===0?'home airfield':'airfield'):j===1?'port':pick(['radar','seaplane station']);
      holdings.push({id:holdings.length,x:t.x,y:t.y,region:r.id,island:t.id,role,name:r.name+' · '+role});
    }
    // Multiple facilities can share a major landmass: geography is not an objective list.
    if(r.identity==='great island'&&r.id!==0&&candidates[0]) {
      const t=candidates[0];holdings.push({id:holdings.length,x:t.x-Math.sin(t.a)*t.ry*.5,y:t.y+Math.cos(t.a)*t.ry*.5,region:r.id,island:t.id,role:'port',name:r.name+' · harbor'});
    }
  }
  const home=holdings.find(h=>h.role==='home airfield');
  const farthest=regions.reduce((a,b)=>Math.hypot(b.x-home.x,b.y-home.y)>Math.hypot(a.x-home.x,a.y-home.y)?b:a);
  farthest.stronghold=true;
  const bounds={minX:Math.min(...islands.map(t=>t.x-t.extent))-2000,maxX:Math.max(...islands.map(t=>t.x+t.extent))+2000,minY:Math.min(...islands.map(t=>t.y-t.extent))-2000,maxY:Math.max(...islands.map(t=>t.y+t.extent))+2000};
  const local=[];for(const a of holdings){const ds=holdings.filter(b=>b.id!==a.id&&b.region===a.region).map(b=>Math.hypot(a.x-b.x,a.y-b.y));if(ds.length)local.push(Math.min(...ds)/CRUISE);}
  const passages=links.map(([a,b])=>Math.hypot(regions[a].x-regions[b].x,regions[a].y-regions[b].y)/CRUISE);
  return {seed,regions,islands,holdings,links,home,bounds,metrics:{local,passages,span:Math.hypot(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY)/CRUISE}};
}
