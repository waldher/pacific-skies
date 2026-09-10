// One local expedition checkpoint. Simulation data only: never renderer objects or UI state.
import { migrateCoastalHome } from './coastal-home.js';
import { CONFIG } from './config.js';
import { AIRCRAFT } from './aircraft-types.js';
export const CAMPAIGN_SAVE_KEY = 'pacific-skies-expedition-v1';
const VERSION = 1;
const FIELDS = ['player','score','time','flightSeconds','combatSorties','playerMerit','raidImpacts','raidDamage','raidIntercepts',
  'strikeLaunchCooldown','raidTimer','territories','terrain','sectors','regions','theaterBounds','fleetRoutes','theaterSeed','geographySeed','sectorLinks','regionLinks',
  'ships','airfields','bases','unlockedAircraft','rank','rescue','intelligence','sessionReport','pilotLosses',
  'enemies','allies','bullets','ebullets','torpedoes','bombs','waypoint','guidanceCleared','endReason'];
const arrays = ['territories','terrain','ships','airfields','bases','unlockedAircraft','enemies','allies','bullets','ebullets','torpedoes','bombs'];
let lastCheckpoint = '', lastSaveTime = -Infinity, savedAvailable;
function storage() { try { return globalThis.localStorage; } catch { return null; } }
function finiteTree(value, depth=0) {
  if (depth > 30) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object') return true;
  return Object.entries(value).every(([key,v]) => !['__proto__','constructor','prototype'].includes(key) && finiteTree(v,depth+1));
}
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const point = value => record(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
const polygon = value => Array.isArray(value) && value.length >= 3 && value.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
function valid(data) {
  if (!data || !['play','recovery','over','victory'].includes(data.mode) || !finiteTree(data)) return false;
  if (!arrays.every(key => Array.isArray(data[key]) && data[key].length < 20000)) return false;
  if (!Array.isArray(data.sectors) || !data.sectors.length || !data.sectors.every(point)) return false;
  if (!record(data.fleetRoutes) || !Object.values(data.fleetRoutes).every(polygon)) return false;
  if (!data.terrain.every(t => Number.isFinite(t.radius) && t.radius > 0 && Number.isFinite(t.extent) && polygon(t.shoreline))) return false;
  if (!data.territories.every(t => typeof t.name === 'string' && typeof t.role === 'string' && Number.isFinite(t.radius) && polygon(t.shoreline))) return false;
  if (!data.ships.every(t => ['carrier','destroyer'].includes(t.kind) && Number.isFinite(t.a) && Number.isFinite(t.length) && Number.isFinite(t.width))) return false;
  if (!data.ships.every(t => record(t.fleet) && typeof t.fleet.id === 'string' && point(t.fleet) && Number.isFinite(t.fleet.a) && polygon(t.fleet.route) && Number.isInteger(t.fleet.leg) && t.fleet.leg >= 0 && t.fleet.leg < t.fleet.route.length)) return false;
  if (!data.ships.every(t => data.ships.some(c => c.kind === 'carrier' && c.fleet.id === t.fleet.id))) return false;
  if (!data.bases.every(t => ['airfield','carrier'].includes(t.kind) && typeof t.name === 'string' && Number.isFinite(t.a))) return false;
  if (!data.unlockedAircraft.every(id => !!AIRCRAFT[id])) return false;
  if (!record(data.sessionReport) || !record(data.sessionReport.owners) || !record(data.sessionReport.carriers) || !Array.isArray(data.sessionReport.aircraft) || !Array.isArray(data.sessionReport.unlocks)) return false;
  if (!data.sessionReport.unlocks.every(u => record(u) && !!AIRCRAFT[u.aircraft] && Number.isFinite(u.time))) return false;
  if (!data.territories.length || !data.bases.length || !data.player || !data.intelligence || !data.rescue) return false;
  if (!['flying','landing','landed','takeoff'].includes(data.player.flight) || !AIRCRAFT[data.player.aircraft]) return false;
  if (!AIRCRAFT[data.player.aircraft].loadouts.includes(data.player.loadout)) return false;
  if (!record(data.intelligence.sites) || !record(data.intelligence.ships) || !record(data.intelligence.surveyed) || !Number.isFinite(data.intelligence.time)) return false;
  if (![...Object.values(data.intelligence.sites),...Object.values(data.intelligence.ships)].every(t => point(t) && Number.isFinite(t.seenAt))) return false;
  if (!['territories','terrain','ships','airfields','bases','enemies','allies','bullets','ebullets','bombs','torpedoes'].every(key => data[key].every(v => v && typeof v === 'object' && Number.isFinite(v.x) && Number.isFinite(v.y)))) return false;
  if (!['ships','airfields','enemies','allies'].every(key => data[key].every(v => Number.isFinite(v.hp)))) return false;
  if (data.player.flight === 'landed' && (!data.player.parked || !Number.isFinite(data.player.parked.x) || !Number.isFinite(data.player.parked.y))) return false;
  if (data.player.flight === 'landing' && (!point(data.player.arrival) || !Number.isFinite(data.player.arrival.a) || !Number.isFinite(data.player.arrival.speed))) return false;
  if (data.player.flight === 'takeoff' && !point(data.player.departure)) return false;
  if (!['x','y','a','hp'].every(k => Number.isFinite(data.player[k]))) return false;
  if (!Number.isFinite(data.score) || !Number.isFinite(data.time) || !Number.isFinite(data.rank)) return false;
  if (!data.theaterBounds || !['minX','minY','maxX','maxY'].every(k => Number.isFinite(data.theaterBounds[k]))) return false;
  return data.territories.every(t => t && Number.isFinite(t.x) && Number.isFinite(t.y) && ['us','enemy'].includes(t.owner)) &&
    data.bases.every(b => b && typeof b.id === 'string' && Number.isFinite(b.x) && Number.isFinite(b.y));
}
export function saveCampaign(game) {
  if (!game.player || game.mode === 'title') return false;
  const data = {mode:game.mode};
  for (const key of FIELDS) if (game[key] !== undefined) data[key] = game[key];
  try {
    const json = JSON.stringify({version:VERSION,data});
    if (!valid(JSON.parse(json).data)) return false;
    const target = storage(); if (!target) return false;
    target.setItem(CAMPAIGN_SAVE_KEY,json); savedAvailable = ['play','recovery'].includes(game.mode); lastSaveTime = game.time; return true;
  } catch { return false; }
}
export function loadCampaign() {
  try {
    const raw=storage()?.getItem(CAMPAIGN_SAVE_KEY); if (!raw || raw.length > 8000000) return null;
    const saved=JSON.parse(raw);
    if (saved.version !== VERSION || !valid(saved.data)) return null;
    // JSON loses shared references. The carrier owns each task group's route cursor;
    // reconnect escorts before any simulation update advances the formation.
    const fleets = new Map(saved.data.ships.filter(s => s.kind === 'carrier').map(s => [s.fleet.id, s.fleet]));
    for (const ship of saved.data.ships) ship.fleet = fleets.get(ship.fleet.id);
    migrateCoastalHome(saved.data);
    if(saved.data.waypoint?.name==='Scout reported activity')Object.assign(saved.data.waypoint,{name:'Enemy outpost',auto:true});
    if(saved.data.waypoint && saved.data.waypoint.auto===undefined){
      saved.data.waypoint.auto=true;
      const site=Object.values(saved.data.intelligence.sites).find(t=>Math.hypot(t.x-saved.data.waypoint.x,t.y-saved.data.waypoint.y)<1);
      if(site)Object.assign(saved.data.waypoint,{siteId:site.id,role:site.role,owner:site.owner});
    }
    return saved.data;
  } catch { return null; }
}
export function hasSavedCampaign() { if (savedAvailable === undefined) { const data=loadCampaign(); savedAvailable = !!data && ['play','recovery'].includes(data.mode); } return savedAvailable; }
export function clearCampaignSave() { try { storage()?.removeItem(CAMPAIGN_SAVE_KEY); } catch {} lastCheckpoint=''; lastSaveTime=-Infinity; savedAvailable=false; }
export function updateCampaignSave(game) {
  if (!game.player || game.mode === 'title') return;
  const marker = JSON.stringify([game.mode,game.player.flight,game.player.baseId,game.unlockedAircraft,game.rescue?.status,
    game.territories.map(t=>t.owner),Object.keys(game.intelligence?.sites||{}),game.intelligence?.surveyed]);
  if (marker !== lastCheckpoint || game.time-lastSaveTime >= (CONFIG.persistence?.saveInterval ?? 15)) {
    if (saveCampaign(game)) lastCheckpoint=marker;
  }
}
