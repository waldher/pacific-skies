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
    quality: {
      // Adaptive quality ladder, best first. The renderer steps down while
      // frames stay slow and back up only into levels that never failed.
      // pixelRatio caps the device ratio; ocean is the shader detail
      // (2 full, 1 no glitter/whitecaps, 0 two octaves, no clouds).
      // Pin a level for testing with ?quality=N in the URL.
      levels: [
        { pixelRatio: 2, ocean: 2, shadows: true },
        { pixelRatio: 1.5, ocean: 2, shadows: true },
        { pixelRatio: 1.25, ocean: 1, shadows: true },
        { pixelRatio: 1, ocean: 1, shadows: true },
        { pixelRatio: 1, ocean: 0, shadows: false },
      ],
      start: 1,
      slowFrame: .024,         // s; frames longer than this count as slow (≈42 fps)
      fastFrame: .0175,        // s; frames shorter than this count as fast (holds 60 fps)
      settle: 2,               // s of net slow frames before stepping down
      recover: 12,             // s of fast frames before stepping up
      hold: 3,                 // s to ignore after a change (shader compiles cause hitches)
    },
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
    aceFromTerritory: 2,           // first wave that can include aces
    aceEvery: 3,              // every Nth enemy in a wave is an ace
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
  conquest: {
    islands: [['CORAL', -1, -1], ['PALM', 1, -1], ['LAGOON', -2, -1], ['NORTH REEF', 1, -2]],
    fighters: [2, 2, 3, 3], destroyers: [1, 1, 1, 2],
    activateRadius: 850, captureRadius: 330, captureSeconds: 6, captureScore: 500,
    patrolRadius: 290, pursuitRadius: 750, engageRadius: 620, messageDuration: 4,
  },
  carrier: {
    x: 0, y: 200, length: 240, width: 68, deckHeight: 15,
    headingTolerance: Math.PI / 15, lateralTolerance: 12, descentDistance: 180,
    landingSeconds: 1, rolloutDistance: 75, takeoffSeconds: 2.5, launchDistance: 300,
    repairPerSecond: 20, defenseRange: 500, fireCooldown: .3,
  },
  ship: {
    length: 115, width: 28, hp: 20, speed: 22, patrolOffset: 155,
    gunRange: 500, fireCooldown: 1.8, bulletSpeed: 400, bulletDamage: 6, score: 200,
    sinkingSeconds: 4,
  },
  score: { kill: 100, aceKill: 250 },
  camera: { lead: 60 },       // px the camera leads ahead of the nose
};
