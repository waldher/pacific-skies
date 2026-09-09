// Central mutable game state, shared by all systems.
import { CONFIG } from './config.js';
import { createCampaign } from './campaign.js';

export const game = {
  mode: 'title', // title | play | over | victory
  player: null,
  torpedoes: [],
  bullets: [],
  ebullets: [],
  enemies: [], allies: [], raidTimer: 0,
  particles: [],
  cam: { x: 0, y: 0 },
  score: 0,
  best: 0,
  territories: [], ships: [],
  message: '', messageTime: 0,
  shake: 0,
  time: 0,
};

export function startGame() {
  game.player = {
    x: 0, y: -40, a: -Math.PI / 2,
    altitude: CONFIG.render.flightHeight, flight: 'flying', flightTime: 0,
    torpedoCd: 0, torpedoAmmo: CONFIG.torpedo.capacity, rearmTime: 0, deckApproach: false, landingHint: '',
    speed: CONFIG.player.speedCruise, hp: CONFIG.player.hp,
    fireCd: 0, heat: 0, overheated: false, steamCd: 0, hitFlash: 0, smokeCd: 0,
  };
  game.raidTimer = CONFIG.airWar.raidFirst;
  game.allies = Array.from({ length: CONFIG.airWar.allyCount }, (_, i) => ({
    team: 'us', name: `BLUE ${i + 1}`, x: i ? -170 : 170, y: i ? 20 : -130, a: -Math.PI / 2,
    hp: CONFIG.airWar.allyHp, speed: CONFIG.airWar.allySpeed, turn: CONFIG.airWar.allyTurn,
    fireCd: 0, waypoint: i, hitFlash: 0,
  }));
  game.torpedoes = [];
  game.bullets = []; game.ebullets = []; game.enemies = []; game.particles = [];
  game.cam = { x: 0, y: 0 };
  game.score = 0;
  Object.assign(game, createCampaign());
  game.message = 'Guns for fighters. Torpedoes for ships.';
  game.messageTime = CONFIG.conquest.messageDuration;
  game.shake = 0;
  game.mode = 'play';
}
