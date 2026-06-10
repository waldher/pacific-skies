// All gameplay tuning lives here. Balance experiments should be
// one-line diffs in this file, never edits to system logic.
export const CONFIG = {
  player: {
    hp: 100,
    turnRate: 3.1,            // rad/s
    speedCruise: 250,
    speedBoost: 350,
    speedBrake: 160,
    fireCooldown: 0.13,
    bulletSpeed: 860,
    bulletLife: 0.9,
    gunOffsets: [-7, 7],      // wing gun positions
    smokeBelowHp: 40,
  },
  enemy: {
    speed: 245,
    turn: 2.1,
    hp: 2,
    fireCooldown: 1.2,
    ace: { speed: 290, turn: 2.6, hp: 4, fireCooldown: 0.8 },
    aceFromWave: 3,           // first wave that can include aces
    aceEvery: 4,              // every Nth enemy in a wave is an ace
    bulletSpeed: 560,
    bulletLife: 1.4,
    bulletDamage: 9,
    engageDist: 470,          // max range to open fire
    aimCone: 0.22,            // rad off-nose tolerance to fire
    ramDist: 26,
    ramDamage: 30,
    spawnDistMin: 750,
    spawnDistMax: 1150,
  },
  waves: {
    baseCount: 2,             // enemies in wave N = baseCount + perWave * N
    perWave: 1,
    healBetween: 25,
    firstDelay: 1.5,
    delay: 2.5,
    clearBonusPerWave: 50,
  },
  score: { kill: 100, aceKill: 250 },
  camera: { lead: 60 },       // px the camera leads ahead of the nose
};
