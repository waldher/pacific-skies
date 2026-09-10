// Player knowledge is separate from the live simulation. Charts consume snapshots.
import { CONFIG } from './config.js';
const setting = (key, fallback) => CONFIG.intelligence?.[key] ?? fallback;
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
export function resetIntelligence(game) { game.intelligence = { time:0, sites:{}, ships:{}, surveyed:{}, briefed:false }; game.waypoint=null; }
export function radarStations(game) { return (game.territories||[]).filter(t=>t.owner==='us' && t.role==='radar' && (t.integrity??1)>0); }
export function observedAt(game, point, tactical=false) {
  if (game.player && distance(game.player,point)<=setting(tactical?'tacticalRadius':'reconnaissanceRadius',tactical?1100:950)) return true;
  if(tactical) {
    const range=CONFIG.strike?.baseDetectionRange??1100;
    if((game.territories||[]).some(t=>t.owner==='us' && (t.integrity??1)>0 && distance(t,point)<=range)) return true;
    if((game.ships||[]).some(s=>s.team==='us'&&s.hp>0&&s.active!==false&&distance(s,point)<=range)) return true;
  }
  return radarStations(game).some(t=>distance(t,point)<=setting('radarRadius',2400));
}
function siteObserved(game, site) {
  return observedAt(game,site) || radarStations(game).some(r=>r.sector!=null && r.sector===site.sector);
}
export function installationKnown(game, site) { return !!site && (site.owner==='us' || !!game.intelligence?.sites[site.id]); }
export function shipObserved(game, ship) { return ship.team==='us' || observedAt(game,ship); }
export function enemyObserved(game, enemy) { return enemy.hp>0 && observedAt(game,enemy,true); }
export function updateIntelligence(game, dt=0) {
  if (!game.intelligence) resetIntelligence(game);
  const intel=game.intelligence; intel.time+=dt;
  for (const t of game.territories||[]) if (t.owner==='us'||siteObserved(game,t)) {
    intel.sites[t.id]={ id:t.id,x:t.x,y:t.y,name:t.name,role:t.role,owner:t.owner,sector:t.sector,seenAt:intel.time };
  }
  intel.surveyed ||= {};
  for(const region of game.sectors||[]) {
    if(game.player && distance(game.player,region)<=setting('surveyRadius',2600)) intel.surveyed[region.id]=true;
    if(radarStations(game).some(r=>r.sector===region.id)) intel.surveyed[region.id]=true;
  }
  // One coarse local lead makes the first sortie purposeful without revealing a base.
  if(!intel.briefed && game.player && (game.territories||[]).length) {
    intel.briefed=true;
    const nearby=(game.territories||[]).filter(t=>!installationKnown(game,t)).sort((a,b)=>distance(game.player,a)-distance(game.player,b))[0];
    if(nearby && !game.waypoint) {
      const cell=setting('searchRadius',1500);
      game.waypoint={x:Math.round(nearby.x/cell)*cell,y:Math.round(nearby.y/cell)*cell,name:'Scout reported activity',search:true,radius:cell};
    }
  }
  // Arriving within sight resolves a search into a permanent charted installation.
  if(game.waypoint?.search) {
    const contact=Object.values(intel.sites).filter(t=>t.owner!=='us' && distance(t,game.waypoint)<game.waypoint.radius && observedAt(game,t)).sort((a,b)=>distance(game.player,a)-distance(game.player,b))[0];
    if(contact) game.waypoint={x:contact.x,y:contact.y,name:contact.name};
  }
  for (const s of game.ships||[]) {
    if (s.active===false) { if(s.team==='us') delete intel.ships[s.id]; continue; }
    if (shipObserved(game,s)) {
      if(s.hp<=0) { delete intel.ships[s.id]; continue; }
      intel.ships[s.id]={id:s.id,x:s.x,y:s.y,a:s.a,kind:s.kind,team:s.team,name:s.name|| (s.kind==='carrier'?'Carrier group':'Destroyer'),seenAt:intel.time};
    }
  }
  for (const [id,s] of Object.entries(intel.ships)) if(s.team!=='us' && intel.time-s.seenAt>setting('fleetContactSeconds',90)) delete intel.ships[id];
}
export function knownInstallations(game) { return Object.values(game.intelligence?.sites||{}); }
export function knownShips(game) { return Object.values(game.intelligence?.ships||{}).map(s=>({...s,age:Math.max(0,game.intelligence.time-s.seenAt),uncertainty:Math.max(0,game.intelligence.time-s.seenAt)*setting('uncertaintyPerSecond',18)})); }

// Leads point to geography, never to a hidden fleet's live location.
export function explorationLeads(game) {
  return (game.sectors||[]).filter(r=>!game.intelligence?.surveyed?.[r.id]).map(r=>({
    x:r.x,y:r.y,name:`Survey ${r.name}`,search:true,radius:setting('surveyRadius',2600),region:r.id,
  }));
}
export function flightSeconds(game, point) {
  const speed=CONFIG.aircraft?.[game.player?.aircraft]?.speedCruise || CONFIG.player?.speedCruise || 275;
  return Math.max(1,Math.round(distance(game.player,point)/speed));
}
