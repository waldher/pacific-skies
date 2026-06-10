// Central mutable game state, shared by all systems.
import { CONFIG } from './config.js';

export const game = {
  mode: 'title', // title | play | over
  player: null,
  bullets: [],
  ebullets: [],
  enemies: [],
  particles: [],
  cam: { x: 0, y: 0 },
  score: 0,
  best: 0,
  waveNum: 0,
  waveTimer: 0,
  waveBanner: 0,
  shake: 0,
  time: 0,
};

export function startGame() {
  game.player = {
    x: 0, y: 0, a: -Math.PI / 2,
    speed: CONFIG.player.speedCruise, hp: CONFIG.player.hp,
    fireCd: 0, hitFlash: 0, smokeCd: 0,
  };
  game.bullets = []; game.ebullets = []; game.enemies = []; game.particles = [];
  game.cam = { x: 0, y: 0 };
  game.score = 0;
  game.waveNum = 0; game.waveTimer = CONFIG.waves.firstDelay; game.waveBanner = 0;
  game.shake = 0;
  game.mode = 'play';
}
