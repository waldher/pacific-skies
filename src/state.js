// Central mutable game state, shared by all systems.
import { CONFIG } from './config.js';
import { createCampaign } from './campaign.js';

export const game = {
  mode: 'title', // title | play | over | victory
  player: null,
  bullets: [],
  ebullets: [],
  enemies: [],
  particles: [],
  cam: { x: 0, y: 0 },
  score: 0,
  best: 0,
  territories: [], ships: [], target: 0,
  message: '', messageTime: 0,
  shake: 0,
  time: 0,
};

export function startGame() {
  game.player = {
    x: 0, y: -40, a: -Math.PI / 2,
    altitude: CONFIG.render.flightHeight, flight: 'flying', flightTime: 0,
    speed: CONFIG.player.speedCruise, hp: CONFIG.player.hp,
    fireCd: 0, heat: 0, overheated: false, steamCd: 0, hitFlash: 0, smokeCd: 0,
  };
  game.bullets = []; game.ebullets = []; game.enemies = []; game.particles = [];
  game.cam = { x: 0, y: 0 };
  game.score = 0;
  Object.assign(game, createCampaign());
  game.target = 0; game.message = 'Clear fighters and ships, then hold each island';
  game.messageTime = CONFIG.conquest.messageDuration;
  game.shake = 0;
  game.mode = 'play';
}
