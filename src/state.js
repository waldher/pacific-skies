// Central mutable game state, shared by all systems.
import { CONFIG } from './config.js';

export const game = {
  mode: 'title', // title | play | over | win
  player: null,
  bullets: [],
  ebullets: [],
  enemies: [],
  particles: [],
  islands: [],
  carrier: null, // runtime carrier state (flak cooldowns); geometry is CONFIG
  cam: { x: 0, y: 0 },
  score: 0,
  best: 0,
  banner: { text: '', t: 0, dur: 0 },
  raidT: 0,
  patrolT: 0,
  shake: 0,
  time: 0,    // wall time since page load (ocean animation)
  runTime: 0, // time in the current run
};

export function setBanner(text, dur = 2.2) {
  game.banner = { text, t: dur, dur };
}

function makeIsland(def, idx) {
  const I = CONFIG.island;
  const structures = [{ kind: 'hq', dx: 0, dy: 0, hp: I.hq.hp, max: I.hq.hp }];
  for (let i = 0; i < def.tier; i++) {
    const a = (i / def.tier) * Math.PI * 2 + idx * 1.7 + 0.6;
    structures.push({
      kind: 'aa',
      dx: Math.cos(a) * def.r * 0.52,
      dy: Math.sin(a) * def.r * 0.44,
      hp: I.aa.hp, max: I.aa.hp,
      fireCd: 1 + i * 0.4,
    });
  }
  const cap = I.defCap + def.tier;
  return {
    ...def, idx,
    owner: 'enemy',
    structures,
    cap,
    stock: cap * I.defStock,
    defT: 0,
    capture: 0, // 0..1 enemy recapture progress while raiders hold the island
    alert: 0,
  };
}

export function startGame() {
  const C = CONFIG.carrier;
  game.player = {
    // parked at the stern, ready for the deck run
    x: C.x - Math.cos(C.a) * C.deckLen * 0.36,
    y: C.y - Math.sin(C.a) * C.deckLen * 0.36,
    a: C.a, speed: 0,
    hp: CONFIG.player.hp, ammo: CONFIG.player.ammoMax,
    phase: 'deck', airT: 0, serviced: true,
    fireCd: 0, heat: 0, overheated: false, steamCd: 0, hitFlash: 0, smokeCd: 0,
  };
  game.bullets = []; game.ebullets = []; game.enemies = []; game.particles = [];
  game.islands = CONFIG.islands.map(makeIsland);
  game.carrier = { fireCds: CONFIG.carrier.guns.map(() => 0) };
  game.cam = { x: game.player.x, y: game.player.y };
  game.score = 0;
  game.banner = { text: '', t: 0, dur: 0 };
  game.raidT = CONFIG.raids.first;
  game.patrolT = CONFIG.patrols.first;
  game.shake = 0;
  game.runTime = 0;
  game.mode = 'play';
}
