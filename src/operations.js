// Both charts draw only charted geography and player intelligence snapshots.
import { islandOutline } from './surface.js';
import { knownInstallations, knownShips, radarStations, enemyObserved } from './intelligence.js';
import { CONFIG } from './config.js';
import { keys, stick, fireTouch } from './input.js';
let bound=false;
export function mapProjection(game,rect) {
  const b=game.theaterBounds || {minX:-5000,maxX:5000,minY:-5000,maxY:5000};
  const scale=Math.min((rect.w-24)/(b.maxX-b.minX),(rect.h-24)/(b.maxY-b.minY));
  const ox=rect.x+rect.w/2-(b.minX+b.maxX)/2*scale, oy=rect.y+rect.h/2-(b.minY+b.maxY)/2*scale;
  return {scale, point:p=>[ox+p.x*scale,oy+p.y*scale]};
}
export function drawTheaterMap(ctx,game,rect,detailed=false) {
  const {scale,point}=mapProjection(game,rect);
  ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.w,rect.h);ctx.clip();
  ctx.fillStyle='#091f2b';ctx.fillRect(rect.x,rect.y,rect.w,rect.h);
  for(const t of game.terrain||game.territories||[]) {
    ctx.beginPath();islandOutline(t).forEach(([x,y],i)=>{const [px,py]=point({x:t.x+x,y:t.y+y});i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.closePath();
    ctx.fillStyle='#254d4b';ctx.fill();ctx.strokeStyle='#49736a';ctx.lineWidth=detailed?1:.5;ctx.stroke();
  }
  if(detailed) for(const sector of game.sectors||[]) { const [x,y]=point(sector);ctx.font='600 10px system-ui';ctx.textAlign='left';ctx.fillStyle='#adc6ca77';ctx.fillText(sector.name.toUpperCase(),rect.x+10,y); }
  if(detailed) for(const t of radarStations(game)) {const [x,y]=point(t);ctx.beginPath();ctx.arc(x,y,(CONFIG.intelligence?.radarRadius??2400)*scale,0,Math.PI*2);ctx.fillStyle='#82dfbc09';ctx.fill();ctx.setLineDash([4,5]);ctx.strokeStyle='#82dfbc44';ctx.stroke();ctx.setLineDash([]);}
  for(const t of knownInstallations(game)) {
    const [x,y]=point(t);ctx.fillStyle=t.owner==='us'?'#82dfbc':'#f19b80';
    if(t.role==='radar') {ctx.beginPath();ctx.moveTo(x,y-4);ctx.lineTo(x+4,y+3);ctx.lineTo(x-4,y+3);ctx.closePath();ctx.fill();}
    else ctx.fillRect(x-3,y-3,6,6);
    if(detailed) {ctx.font='600 11px system-ui';ctx.textAlign='center';ctx.fillStyle='#eee9d8';ctx.fillText(t.name,x,y-10);ctx.font='10px system-ui';ctx.fillStyle='#adc6ca';ctx.fillText(t.role||'Outpost',x,y+16);}
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
  if(game.waypoint){const[x,y]=point(game.waypoint);const[px,py]=point(game.player);ctx.strokeStyle='#f2ead2';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(x,y);ctx.stroke();ctx.setLineDash([]);ctx.strokeRect(x-6,y-6,12,12);}
  if(game.player){const[x,y]=point(game.player);ctx.translate(x,y);ctx.rotate(game.player.a);ctx.fillStyle='#fff9e9';ctx.beginPath();ctx.moveTo(6,0);ctx.lineTo(-4,-4);ctx.lineTo(-4,4);ctx.closePath();ctx.fill();}
  ctx.restore();
}
export function setOperationsOpen(game,open) {
  game.paused=open&&game.mode==='play';
  for(const key of Object.keys(keys))keys[key]=false;
  stick.active=fireTouch.active=false;stick.dx=stick.dy=0;
  document.getElementById('operations-panel').hidden=!game.paused;
  if(game.paused) document.getElementById('operations-close').focus();
}
export function initOperations(game) {
  if(bound)return;bound=true;
  document.getElementById('map-open').addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();setOperationsOpen(game,true);});
  document.getElementById('map-open').addEventListener('click',e=>{if(e.detail===0)setOperationsOpen(game,true);});
  document.getElementById('operations-close').addEventListener('click',()=>setOperationsOpen(game,false));
  document.getElementById('waypoint-clear').addEventListener('click',()=>{game.waypoint=null;});
  const panel=document.getElementById('operations-panel');
  panel.addEventListener('pointerdown',e=>e.stopPropagation());
  panel.addEventListener('keydown',e=>{e.stopPropagation();if(e.code==='Escape')setOperationsOpen(game,false);if(e.code==='Tab'){const items=[...panel.querySelectorAll('button')];const i=items.indexOf(document.activeElement);e.preventDefault();items[(i+(e.shiftKey?-1:1)+items.length)%items.length].focus();}});
  document.getElementById('operations-map').addEventListener('pointerdown',e=>{
    e.preventDefault();e.stopPropagation();
    const canvas=e.currentTarget, r=canvas.getBoundingClientRect(), x=e.clientX-r.left,y=e.clientY-r.top;
    const {point}=mapProjection(game,{x:0,y:0,w:r.width,h:r.height});
    const candidates=[...knownInstallations(game),...knownShips(game)];
    const target=candidates.map(t=>({t,d:Math.hypot(point(t)[0]-x,point(t)[1]-y)})).sort((a,b)=>a.d-b.d)[0];
    if(target&&target.d<30)game.waypoint={x:target.t.x,y:target.t.y,name:target.t.name||'Last known contact'};
  });
}
export function drawOperations(game) {
  initOperations(game);
  document.getElementById('map-open').hidden=game.mode!=='play';
  if(game.mode!=='play') {game.paused=false;document.getElementById('operations-panel').hidden=true;}
  if(!game.paused)return;
  const canvas=document.getElementById('operations-map'),r=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);
  if(canvas.width!==Math.round(r.width*dpr)||canvas.height!==Math.round(r.height*dpr)){canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);}
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);drawTheaterMap(ctx,game,{x:0,y:0,w:r.width,h:r.height},true);
  document.getElementById('operations-waypoint').textContent=game.waypoint?`Course set: ${game.waypoint.name}`:'Select a known installation or contact to set your course.';
}
