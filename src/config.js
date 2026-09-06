// All gameplay tuning lives here. Balance experiments should be
// one-line diffs in this file, never edits to system logic.
export const CONFIG = {
  render: {
    aircraftWingspan: 48,    // world units; 1 unit = 1 CSS pixel at this camera scale
    flightHeight: 32,
    bankAngle: Math.PI / 5,  // maximum visual bank, independent of flight physics
    bankResponse: 8,
    propellerSpeed: 55,      // radians/s
    sunOffset: [-240, 800, -320], // sun position relative to the camera; shadows and ocean lighting share it
    ocean: {
      wind: [14, 6],           // ripple drift, world units/s
      cloudSpeed: 2.5,         // cloud shadows drift at wind × this
      cloudStrength: .2,       // how much cloud shadows darken the sea (0..1)
      glitter: .6,             // sun sparkle intensity
      foam: .7,                // whitecap density
      surf: .55,               // shoreline foam ring opacity
      deep: '#0f4468', mid: '#1c6b8a', shallows: '#39aeb0',
      shallowsRadius: 1.9,     // lagoon fade-out distance, in island radii
    },
  },
  player: {
    hp: 100,
    turnRate: 3.1,            // rad/s
    speedCruise: 250,
    speedBoost: 350,
    speedBrake: 160,
    fireCooldown: 0.13,
    heatPerShot: 0.085,       // gun heat gauge (0..1) added per trigger pull
    heatCoolRate: 0.4,        // gauge/s shed at all times (≈4s sustained fire to overheat)
    heatRecoverAt: 0.35,      // overheated guns unlock once cooled below this
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
