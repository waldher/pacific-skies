// Both charts draw only charted geography and player intelligence snapshots.
import { islandOutline } from './surface.js';
import { knownInstallations, knownShips, radarStations, enemyObserved, explorationLeads, flightSeconds } from './intelligence.js';
import { objectiveFor } from './objectives.js';
import { CONFIG } from './config.js';
import { keys, stick, fireTouch } from './input.js';
// Coastlines are immutable for the lifetime of each generated terrain object.
const coastlines = new WeakMap();
function chartCoast(t) {
  let coast=coastlines.get(t);
  if(!coast) {
    const points=islandOutline(t);
    coast={points,extent:Math.max(...points.map(([x,y])=>Math.max(Math.abs(x),Math.abs(y))))};
    coastlines.set(t,coast);
  }
  return coast;
}
let bound=false;
let chart={zoom:1,x:null,y:null,bounds:null,local:false};
function centerChart(game) {
  chart={zoom:1,x:game.player.x,y:game.player.y,bounds:game.theaterBounds,local:true};
}
export function localMapProjection(game,rect) {
  const radius=CONFIG.intelligence?.minimapRadius??2200;
  const scale=Math.min(rect.w,rect.h)/(radius*2);
  const cx=game.player?.x??0,cy=game.player?.y??0;
  const ox=rect.x+rect.w/2-cx*scale,oy=rect.y+rect.h/2-cy*scale;
  return {scale,point:p=>[ox+p.x*scale,oy+p.y*scale],world:(x,y)=>({x:(x-ox)/scale,y:(y-oy)/scale})};
}
export function mapProjection(game,rect,interactive=false) {
  const b=game.theaterBounds || {minX:-5000,maxX:5000,minY:-5000,maxY:5000};
  if(interactive && chart.bounds!==b)centerChart(game);
  const fit=Math.min((rect.w-24)/(b.maxX-b.minX),(rect.h-24)/(b.maxY-b.minY));
  const local=Math.min(rect.w-24,rect.h-24)/(2*(CONFIG.intelligence?.chartRadius??5500));
  const scale=interactive?(chart.local?local:fit)*chart.zoom:fit;
  const cx=interactive&&chart.x!=null?chart.x:(b.minX+b.maxX)/2,cy=interactive&&chart.y!=null?chart.y:(b.minY+b.maxY)/2;
  const ox=rect.x+rect.w/2-cx*scale, oy=rect.y+rect.h/2-cy*scale;
  return {scale, point:p=>[ox+p.x*scale,oy+p.y*scale],world:(x,y)=>({x:(x-ox)/scale,y:(y-oy)/scale})};
}
export function drawTheaterMap(ctx,game,rect,detailed=false) {
  const {scale,point}=detailed?mapProjection(game,rect,true):localMapProjection(game,rect);
  ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.w,rect.h);ctx.clip();
  ctx.fillStyle='#091f2b';ctx.fillRect(rect.x,rect.y,rect.w,rect.h);
  for(const t of game.terrain||game.territories||[]) {
    const coast=chartCoast(t),[cx,cy]=point(t),extent=coast.extent*scale+1;
    if(cx+extent<rect.x||cx-extent>rect.x+rect.w||cy+extent<rect.y||cy-extent>rect.y+rect.h)continue;
    ctx.beginPath();coast.points.forEach(([x,y],i)=>{const px=cx+x*scale,py=cy+y*scale;i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.closePath();
    ctx.fillStyle='#254d4b';ctx.fill();ctx.strokeStyle='#49736a';ctx.lineWidth=detailed?1:.5;ctx.stroke();
  }
  if(detailed) for(const sector of game.sectors||[]) { const [x,y]=point(sector);ctx.font='600 10px system-ui';ctx.textAlign='center';ctx.fillStyle='#adc6ca99';ctx.fillText(sector.name.toUpperCase(),x,y-22); }
  if(detailed) for(const t of radarStations(game)) {const [x,y]=point(t);ctx.beginPath();ctx.arc(x,y,(CONFIG.intelligence?.radarRadius??2400)*scale,0,Math.PI*2);ctx.fillStyle='#82dfbc09';ctx.fill();ctx.setLineDash([4,5]);ctx.strokeStyle='#82dfbc44';ctx.stroke();ctx.setLineDash([]);}
  if(detailed) for(const lead of explorationLeads(game)) {
    const[x,y]=point(lead);ctx.strokeStyle='#d7b87888';ctx.setLineDash([2,5]);ctx.beginPath();ctx.arc(x,y,Math.max(8,lead.radius*scale),0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    ctx.font='10px system-ui';ctx.textAlign='center';ctx.fillStyle='#d7b878';ctx.fillText('Unsurveyed',x,y+12);
  }
  for(const t of knownInstallations(game)) {
    const [x,y]=point(t);ctx.fillStyle=t.owner==='us'?'#82dfbc':'#f19b80';
    if(t.role==='radar') {ctx.beginPath();ctx.moveTo(x,y-4);ctx.lineTo(x+4,y+3);ctx.lineTo(x-4,y+3);ctx.closePath();ctx.fill();}
    else ctx.fillRect(x-3,y-3,6,6);
    if(detailed && scale>.022) {ctx.font='600 11px system-ui';ctx.textAlign='center';ctx.fillStyle='#eee9d8';ctx.fillText(t.name,x,y-10);ctx.font='10px system-ui';ctx.fillStyle='#adc6ca';ctx.fillText(t.role||'Outpost',x,y+16);}
  }
  for(const s of knownShips(game)) {
    if(!detailed&&s.kind!=='carrier')continue;
    const [x,y]=point(s);ctx.strokeStyle=s.team==='us'?'#82dfbc':'#f19b80';ctx.fillStyle=ctx.strokeStyle;
    ctx.globalAlpha=s.age>1?.55:1;
    if(detailed&&s.age>1&&s.kind==='carrier'){ctx.setLineDash([3,4]);ctx.beginPath();ctx.arc(x,y,Math.max(7,s.uncertainty*scale),0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}
    ctx.strokeRect(x-3,y-5,6,10);
    if(detailed&&s.kind==='carrier'){ctx.font='11px system-ui';ctx.textAlign='center';ctx.fillText(s.age>1?`Last seen ${Math.floor(s.age)}s ago`:(s.team==='us'?'Friendly carrier':'Carrier contact'),x,y+19);}ctx.globalAlpha=1;
  }
  for(const e of game.enemies||[]) if(e.strike&&e.phase!=='retreat'&&enemyObserved(game,e)){const[x,y]=point(e);ctx.fillStyle='#ffc879';ctx.beginPath();ctx.arc(x,y,2,0,Math.PI*2);ctx.fill();}
  if(game.waypoint){const[rawX,rawY]=point(game.waypoint);let x=rawX,y=rawY;
    if(!detailed){
      const cx=rect.x+rect.w/2,cy=rect.y+rect.h/2,dx=x-cx,dy=y-cy;
      const edge=Math.min(1,(rect.w/2-9)/Math.max(1,Math.abs(dx)),(rect.h/2-9)/Math.max(1,Math.abs(dy)));
      x=cx+dx*edge;y=cy+dy*edge;
    }const[px,py]=point(game.player);ctx.strokeStyle='#f5ca76';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(x,y);ctx.stroke();ctx.setLineDash([]);ctx.strokeRect(x-6,y-6,12,12);if(game.waypoint.search&&detailed){ctx.beginPath();ctx.arc(rawX,rawY,game.waypoint.radius*scale,0,Math.PI*2);ctx.stroke();}}
  if(detailed){const length=15*(CONFIG.aircraft?.[game.player?.aircraft]?.speedCruise||CONFIG.player.speedCruise)*scale;ctx.strokeStyle='#adc6ca';ctx.beginPath();ctx.moveTo(rect.x+14,rect.y+rect.h-18);ctx.lineTo(rect.x+14+length,rect.y+rect.h-18);ctx.stroke();ctx.fillStyle='#adc6ca';ctx.font='10px system-ui';ctx.textAlign='left';ctx.fillText('15s cruise',rect.x+14,rect.y+rect.h-24);}
  if(game.player){const[x,y]=point(game.player);ctx.translate(x,y);ctx.rotate(game.player.a);ctx.fillStyle='#fff9e9';ctx.beginPath();ctx.moveTo(6,0);ctx.lineTo(-4,-4);ctx.lineTo(-4,4);ctx.closePath();ctx.fill();}
  ctx.restore();
}
export function setOperationsOpen(game,open) {
  game.paused=open&&game.mode==='play';
  for(const key of Object.keys(keys))keys[key]=false;
  stick.active=fireTouch.active=false;stick.dx=stick.dy=0;
  document.getElementById('operations-panel').hidden=!game.paused;
  if(game.paused) {centerChart(game);document.getElementById('operations-close').focus();}
}
export function initOperations(game) {
  if(bound)return;bound=true;
  document.getElementById('map-open').addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();setOperationsOpen(game,true);});
  document.getElementById('map-open').addEventListener('click',e=>{if(e.detail===0)setOperationsOpen(game,true);});
  document.getElementById('operations-close').addEventListener('click',()=>setOperationsOpen(game,false));
  document.getElementById('waypoint-clear').addEventListener('click',()=>{game.waypoint=null;game.guidanceCleared=true;});
  const panel=document.getElementById('operations-panel');
  panel.addEventListener('pointerdown',e=>e.stopPropagation());
  panel.addEventListener('keydown',e=>{e.stopPropagation();if(e.code==='Escape')setOperationsOpen(game,false);if(e.code==='Tab'){const items=[...panel.querySelectorAll('button')];const i=items.indexOf(document.activeElement);e.preventDefault();items[(i+(e.shiftKey?-1:1)+items.length)%items.length].focus();}});
  const map=document.getElementById('operations-map');
  const controls=document.createElement('div');controls.style.cssText='display:flex;gap:6px;flex-wrap:wrap';
  for(const [label,action] of [['−',()=>chart.zoom=Math.max(.25,chart.zoom/1.6)],['+',()=>chart.zoom=Math.min(12,chart.zoom*1.6)],['Whole theater',()=>{chart.zoom=1;chart.x=chart.y=null;chart.local=false;}],['My position',()=>{centerChart(game);}]]) {
    const button=document.createElement('button');button.textContent=label;button.type='button';button.setAttribute('aria-label',label==='+'?'Zoom in':label==='−'?'Zoom out':label);button.addEventListener('click',action);controls.append(button);
  }
  panel.querySelector('header').append(controls);
  panel.querySelector('p').textContent='Tap a destination. Drag or pinch to explore.';
  const points=new Map();let gesture=null;
  const projection=()=>{const r=map.getBoundingClientRect();return mapProjection(game,{x:0,y:0,w:r.width,h:r.height},true);};
  map.addEventListener('pointerdown',e=>{
    e.preventDefault();e.stopPropagation();map.setPointerCapture(e.pointerId);points.set(e.pointerId,{x:e.clientX,y:e.clientY});
    gesture={x:e.clientX,y:e.clientY,moved:false};
    if(points.size===2){const[a,b]=[...points.values()];gesture={pinch:Math.hypot(a.x-b.x,a.y-b.y),zoom:chart.zoom,moved:true};}
  });
  map.addEventListener('pointermove',e=>{
    if(!points.has(e.pointerId))return;
    const previous=points.get(e.pointerId);points.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(points.size===2){const[a,b]=[...points.values()];if(gesture?.pinch)chart.zoom=Math.max(.25,Math.min(12,gesture.zoom*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,gesture.pinch)));return;}
    if(!gesture||gesture.pinch)return;
    if(Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)>6)gesture.moved=true;
    if(gesture.moved){const p=projection(),r=map.getBoundingClientRect(),center=p.world(r.width/2,r.height/2);chart.x=center.x-(e.clientX-previous.x)/p.scale;chart.y=center.y-(e.clientY-previous.y)/p.scale;}
  });
  const finish=e=>{
    const was=gesture;points.delete(e.pointerId);gesture=null;
    if(e.type==='pointercancel'||!was||was.moved)return;
    const r=map.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,{point}=projection();
    const candidates=[...knownInstallations(game),...knownShips(game),...explorationLeads(game)];
    const target=candidates.map(t=>({t,d:Math.hypot(point(t)[0]-x,point(t)[1]-y)})).sort((a,b)=>a.d-b.d)[0];
    if(target&&target.d<30){game.waypoint={...target.t,name:target.t.name||'Last known contact',auto:false,...(target.t.kind?{shipId:target.t.id}:target.t.id!=null?{siteId:target.t.id}:{})};game.guidanceCleared=false;}
  };
  map.addEventListener('pointerup',finish);map.addEventListener('pointercancel',finish);
  map.addEventListener('wheel',e=>{e.preventDefault();chart.zoom=Math.max(.25,Math.min(12,chart.zoom*Math.exp(-e.deltaY*.001)));},{passive:false});
}
export function drawOperations(game) {
  initOperations(game);
  document.getElementById('map-open').hidden=game.mode!=='play';
  if(game.mode!=='play') {game.paused=false;document.getElementById('operations-panel').hidden=true;}
  if(!game.paused)return;
  const canvas=document.getElementById('operations-map'),r=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);
  if(canvas.width!==Math.round(r.width*dpr)||canvas.height!==Math.round(r.height*dpr)){canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);}
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);drawTheaterMap(ctx,game,{x:0,y:0,w:r.width,h:r.height},true);
  const objective=objectiveFor(game);
  document.getElementById('operations-waypoint').textContent=objective.target?`${objective.title} · ${flightSeconds(game,objective.target)}s flight`:'Tap a destination to set your course.';
}
