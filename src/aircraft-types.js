import { CONFIG } from './config.js';

// Aircraft roles and unlocks. Flight and weapon tuning stays in CONFIG.
export const AIRCRAFT = Object.freeze({
  p38: { id:'p38', name:'P-38 Lightning', shortName:'P-38', role:'Interceptor', carrierCompatible:false, model:'P38_Lightning', loadouts:['bombs'], unlockScore:0, unlockSorties:0, minRank:0, description:'Fast interceptor · airfields only' },
  dauntless: { id:'dauntless', name:'SBD Dauntless', shortName:'Dauntless', role:'Dive bomber', carrierCompatible:true, model:'SBD_Dauntless', loadouts:['bombs'], unlockScore:CONFIG.progression.aircraftUnlocks.dauntless, unlockSorties:CONFIG.progression.aircraftSorties.dauntless, minRank:0, description:'Heavy bombs · slower, precise attack runs' },
  corsair: { id:'corsair', name:'F4U Corsair', shortName:'Corsair', role:'Naval fighter', carrierCompatible:true, model:'F4U_Corsair', loadouts:['bombs','torpedoes'], unlockScore:0, unlockSorties:CONFIG.progression.aircraftSorties.corsair, minRank:2, description:'Versatile fighter · rescue the carrier' },
  avenger: { id:'avenger', name:'TBF Avenger', shortName:'Avenger', role:'Torpedo bomber', carrierCompatible:true, model:'TBF_Avenger', loadouts:['torpedoes'], unlockScore:CONFIG.progression.aircraftUnlocks.avenger, unlockSorties:CONFIG.progression.aircraftSorties.avenger, minRank:2, description:'Heavy torpedoes · slower carrier hunter' },
  p51: { id:'p51', name:'P-51 Mustang', shortName:'P-51', role:'Fast fighter', carrierCompatible:false, model:'P51_Mustang', loadouts:['bombs'], unlockScore:CONFIG.progression.aircraftUnlocks.p51, unlockSorties:CONFIG.progression.aircraftSorties.p51, minRank:2, description:'Fastest fighter · airfields only' },
});
export function aircraftUnlocked(game, id) {
  const type = AIRCRAFT[id];
  return Boolean(type && game.rank >= type.minRank && game.score >= type.unlockScore && (game.combatSorties || 0) >= type.unlockSorties && (game.flightSeconds || 0) >= (CONFIG.progression.aircraftFlightSeconds[id] || 0));
}
