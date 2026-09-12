// Central mutable game state, shared by all systems.
import { resetSessionReport } from './session-report.js';
import { resetIntelligence, updateIntelligence } from './intelligence.js';
import { CONFIG } from './config.js';
import { createCampaign } from './campaign.js';
import { AIRCRAFT } from './aircraft-types.js';
import { availableBases, canUseAircraft, resolveBase } from './bases.js';
import { saveCampaign, loadCampaign } from './persistence.js';

export const game = {
  mode: 'title', // title | play | recovery | over | victory
  player: null,
  torpedoes: [],
  bullets: [],
  ebullets: [],
  enemies: [], allies: [], raidTimer: 0,
  particles: [],
  cam: { x: 0, y: 0 },
  score: 0,
  best: 0,
  territories: [], ships: [], convoys: [],
  message: '', messageTime: 0,
  shake: 0,
  time: 0,
};

export function startGame() {
  game.player = {
    x: 0, y: 70, a: -Math.PI / 2,
    aircraft: 'p38', loadout: 'bombs', baseId: 'home-airfield', parked: { x: 0, y: 70 }, parkedOffset: { along: -70, lateral: 0 }, bombAmmo: CONFIG.bomb.capacity, bombCd: 0,
    altitude: CONFIG.airfield.deckHeight, flight: 'landed', flightTime: 0,
    torpedoCd: 0, torpedoAmmo: CONFIG.torpedo.capacity, rearmTime: 0, deckApproach: false, landingHint: '',
    speed: CONFIG.player.speedCruise, hp: CONFIG.player.hp,
    fireCd: 0, heat: 0, overheated: false, steamCd: 0, hitFlash: 0, smokeCd: 0,
  };
  game.raidTimer = CONFIG.airWar.raidFirst;
  game.allies = Array.from({ length: CONFIG.airWar.allyCount }, (_, i) => ({
    team: 'us', aircraft: 'p38', name: `BLUE ${i + 1}`, x: i ? -170 : 170, y: i ? 20 : -130, a: -Math.PI / 2,
    hp: CONFIG.airWar.allyHp, speed: CONFIG.airWar.allySpeed, turn: CONFIG.airWar.allyTurn,
    fireCd: 0, waypoint: i, hitFlash: 0,
  }));
  game.torpedoes = []; game.convoys = []; game.convoyTimer = undefined;
  game.bullets = []; game.ebullets = []; game.enemies = []; game.particles = [];
  game.cam = { x: 0, y: 0 };
  game.score = 0; game.time = 0; game.flightSeconds = 0; game.combatSorties = 0; game.playerMerit = 0; game.raidImpacts = 0; game.raidDamage = 0; game.raidIntercepts = 0; game.strikeLaunchCooldown = 0; game.endReason = '';
  Object.assign(game, createCampaign());
  const home = resolveBase(game, 'home-airfield');
  if (home) Object.assign(game.player, { x: home.x, y: home.y, a: home.a, parked: { x: home.x, y: home.y }, parkedOffset: { along: 0, lateral: 0 } });
  game.cam = { x: game.player.x, y: game.player.y };
  game.pilotLosses = 0;
  game.paused = false; game.waypoint = null; game.guidanceCleared = false;
  resetIntelligence(game); updateIntelligence(game, 0);
  resetSessionReport(game);
  game.message = 'Follow the gold marker.';
  game.messageTime = CONFIG.conquest.messageDuration;
  game.shake = 0;
  game.mode = 'play';
  saveCampaign(game);
}

// Keep the war and its active attackers intact; only replace the lost aircraft.
export function recoveryBases() {
  return availableBases(game).filter(base => Object.keys(AIRCRAFT).some(id => canUseAircraft(game, base, id)));
}
export function recoverPilot(baseId) {
  if (game.mode !== 'recovery') return false;
  const bases = recoveryBases();
  const p = game.player;
  // Without a choice, come back at the closest base to where the aircraft was
  // lost: a captured forward field saves the whole transit, not just the sortie.
  const base = bases.find(b => b.id === baseId) ||
    bases.sort((a,b) => Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
  if (!base) { game.mode = 'over'; game.endReason = 'All bases lost'; saveCampaign(game); return false; }
  resolveBase(game,base.id);
  const aircraft = canUseAircraft(game,base,p.aircraft) ? p.aircraft : Object.keys(AIRCRAFT).find(id => canUseAircraft(game,base,id));
  Object.assign(p,{ aircraft,loadout:AIRCRAFT[aircraft].loadouts.includes(p.loadout) ? p.loadout : AIRCRAFT[aircraft].loadouts[0],
    x:base.x,y:base.y,a:base.a,baseId:base.id,parked:{x:base.x,y:base.y},parkedOffset:{along:0,lateral:0},
    hp:CONFIG.player.hp,speed:0,flight:'landed',flightTime:0,
    altitude:base.kind==='carrier' ? CONFIG.carrier.deckHeight : CONFIG.airfield.deckHeight,
    heat:0,overheated:false,hitFlash:0,fireCd:0,steamCd:0,smokeCd:0,deckApproach:false,landingHint:'',
    bombAmmo:CONFIG.bomb.capacity,torpedoAmmo:CONFIG.torpedo.capacity,bombCd:0,torpedoCd:0,rearmTime:0 });
  delete p.sortieScore; delete p.departure; delete p.arrival;
  game.cam={x:p.x,y:p.y}; game.shake=0; game.paused=false; game.mode='play'; game.endReason='';
  game.message=`Recovered at ${base.name} — your expedition continues`; game.messageTime=CONFIG.conquest.messageDuration;
  saveCampaign(game); return true;
}
export function resumeCampaign() {
  const saved=loadCampaign();
  if (!saved || !['play','recovery'].includes(saved.mode)) return false;
  const best=game.best;
  Object.assign(game,saved,{ best:Math.max(best,saved.score),cam:{x:saved.player.x,y:saved.player.y},
    paused:false,particles:[],convoys:[],convoyTimer:undefined,shake:0,message:'Expedition resumed',messageTime:CONFIG.conquest.messageDuration });
  return true;
}
