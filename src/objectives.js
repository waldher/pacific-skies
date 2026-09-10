// One destination and one concrete action, shared by the HUD and operations chart.
import { CONFIG } from './config.js';
import { knownInstallations, knownShips, explorationLeads, observedAt, flightSeconds } from './intelligence.js';
import { availableBases, resolveBase } from './bases.js';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const closest=(p,list)=>[...list].sort((a,b)=>distance(p,a)-distance(p,b))[0];
function siteWaypoint(site) { return {x:site.x,y:site.y,name:site.name,siteId:site.id,role:site.role,owner:site.owner,auto:true}; }
export function updateGuidance(game) {
  if(!game.player || game.mode!=='play')return;
  const p=game.player;
  let wp=game.waypoint;
  if(!wp && game.guidanceCleared)return;
  if(wp?.rescue && game.rescue?.status!=='active')game.waypoint=wp=null;
  if(wp?.rescue){const carrier=knownShips(game).find(s=>s.id===wp.shipId);if(carrier){wp.x=carrier.x;wp.y=carrier.y;}}
  // Preserve chart-selected courses. Automatic guidance advances after completion.
  if(wp?.auto && wp.siteId!=null && game.intelligence.sites[wp.siteId]?.owner==='us' && !wp.returning)game.waypoint=wp=null;
  if(wp?.returning && p.flight==='landed')game.waypoint=wp=null;
  const target=wp && (game.territories||[]).find(t=>t.id===wp.siteId);
  const field=target && game.airfields.find(f=>f.territory===target.id);
  const empty=p.loadout==='bombs' ? !p.bombAmmo : !p.torpedoAmmo;
  const needsRearm=empty && (!target || (field && field.hp>0));
  if((!wp || wp.auto) && p.flight==='flying' && (p.hp<CONFIG.navigation.repairHull || needsRearm)) {
    const base=closest(p,availableBases(game).map(b=>resolveBase(game,b.id)));
    if(base)game.waypoint=wp={x:base.x,y:base.y,name:base.name,baseId:base.id,returning:true,auto:true};
  }
  if(wp?.returning && wp.baseId) { const base=resolveBase(game,wp.baseId);if(base){wp.x=base.x;wp.y=base.y;} }
  if(wp || game.guidanceCleared)return;
  if(game.rescue?.status==='active') {
    const carrier=knownShips(game).find(s=>s.team==='us'&&s.kind==='carrier');
    if(carrier){game.waypoint={...carrier,shipId:carrier.id,auto:true,rescue:true};return;}
  }
  const site=closest(p,knownInstallations(game).filter(t=>t.owner!=='us'));
  if(site){game.waypoint=siteWaypoint(site);return;}
  const lead=closest(p,explorationLeads(game));
  if(lead)game.waypoint={...lead,auto:true};
}
export function objectiveFor(game) {
  const p=game.player,wp=game.waypoint;
  if(!p)return {target:null,title:'',detail:''};
  if(!wp)return {target:null,title:p.flight==='landed'?'Ready for takeoff':'Choose a destination',detail:'Tap the map'};
  let title='Fly to destination',reason='';
  const site=knownInstallations(game).find(t=>t.id===wp.siteId || (t.name===wp.name && distance(t,wp)<1));
  if(wp.defend){title='Defend the base';reason='Shoot down the attackers';}
  else if(wp.returning || wp.baseId){title='Land to rearm and repair';}
  else if(wp.rescue || (wp.shipId==='carrier' && game.rescue?.status==='active')){title='Defend the carrier';reason=game.rescue?.launched?'Shoot down the attackers':'Fly to the carrier';}
  else if(wp.search){title=wp.region!=null?'Scout the next islands':'Find the enemy outpost';}
  else if(site){
    if(site.owner==='us'){title=site.role==='airfield'?'Land to rearm and repair':'Fly to friendly outpost';}
    else {
      title=site.role==='airfield'?'Bomb the runway':site.role==='radar'?'Capture radar':'Capture the port';
      const actual=game.territories.find(t=>t.id===site.id), near=distance(p,site)<CONFIG.conquest.activateRadius;
      if(actual && near && observedAt(game,actual)) {
        const fighters=game.enemies.filter(e=>e.territory===site.id&&e.hp>0&&!e.strike).length;
        const field=game.airfields.find(f=>f.territory===site.id&&f.owner==='enemy'&&f.hp>0);
        if(field){title='Bomb the runway';reason=`${Math.ceil(field.hp/(CONFIG.aircraft[p.aircraft]?.bombDamage||CONFIG.bomb.damage))} bomb hits needed`;}
        else if(fighters){title='Shoot down the defenders';reason=`${fighters} remaining`;}
        else if(actual.activated){title='Circle to capture';reason=`${Math.max(0,Math.ceil(CONFIG.conquest.captureSeconds-actual.progress))}s remaining`;}
      }
    }
  }else if(wp.team==='jp'){title='Find the fleet contact';reason='Last known position';}
  else if(wp.team==='us'){title='Fly to the carrier';}
  const time=`${flightSeconds(game,wp)}s flight`;
  return {target:wp,title,detail:p.flight==='landed'?`Take off · ${time}`:reason||time};
}

// Hysteresis avoids flickering between navigation and arrival on a capture orbit.
const arrivalState=new WeakMap();
export function coursePhase(game) {
  const target=game.waypoint,p=game.player;
  if(!target || !p){arrivalState.delete(game);return 'none';}
  const key=target.siteId??target.baseId??target.shipId??target.name;
  const previous=arrivalState.get(game),d=distance(p,target);
  const arrived=previous?.world===game.terrain&&previous.key===key&&previous.arrived
    ? d<CONFIG.navigation.departureRadius : d<CONFIG.navigation.arrivalRadius;
  arrivalState.set(game,{key,arrived,world:game.terrain});return arrived?'arrived':'travel';
}
export function flightPresentation(game) {
  const goal=objectiveFor(game),phase=coursePhase(game);
  if(!goal.target)return {title:'',detail:''};
  const names={
    'Fly to destination':'Destination', 'Defend the base':'Base defense',
    'Land to rearm and repair':'Return to base', 'Defend the carrier':'Carrier defense',
    'Scout the next islands':'Uncharted islands', 'Find the enemy outpost':'Reported activity',
    'Fly to friendly outpost':'Friendly outpost', 'Bomb the runway':'Enemy airfield',
    'Capture radar':'Radar station', 'Capture the port':'Enemy port',
    'Shoot down the defenders':'Contested airspace', 'Circle to capture':'Capturing',
    'Find the fleet contact':'Fleet contact', 'Fly to the carrier':'Carrier',
  };
  const title=names[goal.title]||'Destination';
  // Counts belong to the map or visible target bars. Capture progress has its own bar.
  return {title,detail:phase==='travel'?`${flightSeconds(game,goal.target)}s`:''};
}
