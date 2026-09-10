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
  aircraft: {
    p38: { speedCruise: 275, speedBoost: 370, speedBrake: 165, turnRate: 2.8, gunOffsets: [-3, 3] },
    dauntless: { speedCruise: 210, speedBoost: 280, speedBrake: 130, turnRate: 2.4, fireCooldown: .22, bombDamage: 40, bombBlastRadius: 120, bombFallSeconds: .7, bombDriftSpeed: 130 },
    avenger: { speedCruise: 215, speedBoost: 275, speedBrake: 135, turnRate: 2.1, fireCooldown: .24, torpedoDamage: 40 },
    p51: { speedCruise: 315, speedBoost: 430, speedBrake: 180, turnRate: 3.3, fireCooldown: .1, heatPerShot: .075, gunOffsets: [-6, 6] },
  },
  navigation: { repairHull: 30 },
  persistence: { saveInterval: 15 },
  theater: { homeCoastSetback: 115, portSetback: 80, fleetCoastClearance: 650, fleetPatrolLength: 4200 },
  fleet: { turnRate: .25, enemyCarrierHp: 80, speed: 24, escortAhead: 180, escortLateral: 230, approachHoldDistance: 650, approachHoldAngle: .65 },
  intelligence: { minimapRadius: 2200, chartRadius: 5500, reconnaissanceRadius: 1800, radarRadius: 6500, searchRadius: 1500, fleetContactSeconds: 90, uncertaintyPerSecond: 24, tacticalRadius: 1100 },
  airfield: { deckHeight: 9, length: 300, width: 70, hp: 40, homeHp: 200 },
  progression: { aircraftFlightSeconds: { dauntless: 420, corsair: 720, avenger: 1080, p51: 1500 }, aircraftUnlocks: { dauntless: 1800, avenger: 4000, p51: 6000 }, aircraftSorties: { dauntless: 3, corsair: 5, avenger: 8, p51: 12 }, rescueScore: 2500, rescueStartRadius: 1200, rescueIntercepts: 2, rescueHp: 140, rescueRadius: 600, rescueRetry: 45, rescueEnemies: 3, rescueSpawnDistance: 1500 },
  bomb: { capacity: 2, rearmSeconds: 0, cooldown: 1, fallSeconds: .8, driftSpeed: 160, blastRadius: 100, damage: 20, airfieldScore: 300 },
  strike: { launchGap: 45, firstMin: 90, firstMax: 150, intervalMin: 65, intervalMax: 90, groupSize: 3, maxActive: 4, speed: 205, turn: 1.7, hp: 3, attackRange: 65, baseDamage: 22, torpedoDamage: 30, escortCount: 1, escortRange: 450, escortFireCooldown: 1.4, defenseRange: 600, defenseCooldown: .8, baseDetectionRange: 1100, baseRepairPerSecond: 3, formationSpacing: 48, retreatDistance: 1000 },
  conquest: {
    outpostHp: 100, capturedIntegrityFraction: .55, establishSeconds: 90, garrisonRepairPerSecond: .35, portRepairPerSecond: .4, recaptureFighters: 2,
    activateRadius: 850, captureRadius: 330, captureSeconds: 6, captureScore: 500,
    patrolRadius: 290, pursuitRadius: 750, engageRadius: 620, messageDuration: 4,
  },
  carrier: {
    x: 0, y: 200, length: 240, width: 68, deckHeight: 15,
    headingTolerance: Math.PI * 25 / 180, lateralTolerance: 24, descentDistance: 180,
    catchWindow: 105,
    landingSeconds: 1, rolloutDistance: 75, takeoffSeconds: 2.5, launchDistance: 300,
    repairPerSecond: 20, defenseRange: 500, fireCooldown: .3,
  },
  airWar: {
    raidFirst: 40, raidMin: 35, raidMax: 55, raidSpeed: 270, raidSpawnDistance: 850,
    allyCount: 2, allyHp: 36, allySpeed: 235, allyTurn: 2.3,
    allyRange: 600, allyFireCooldown: .45, waypointRadius: 150,
  },
  torpedo: { capacity: 2, rearmSeconds: 0, speed: 220, range: 1100, damage: 20, cooldown: 5, armingDistance: 45 },
  ship: {
    length: 115, width: 28, hp: 20, speed: 22, patrolOffset: 155,
    gunRange: 500, fireCooldown: 1.8, bulletSpeed: 400, bulletDamage: 6, score: 200,
    sinkingSeconds: 4,
  },
  score: { kill: 100, aceKill: 250 },
  camera: { lead: 60 },       // px the camera leads ahead of the nose
};
