// All gameplay tuning lives here. Balance experiments should be
// one-line diffs in this file, never edits to system logic.
export const CONFIG = {
  render: {
    aircraftWingspan: 48,    // world units; 1 unit = 1 CSS pixel at this camera scale
    flightHeight: 32,
    bankAngle: Math.PI / 5,  // maximum visual bank, independent of flight physics
    bankResponse: 8,
    propellerSpeed: 55,      // radians/s
    sunOffset: [-300, 640, -360], // sun position relative to the camera; shadows and ocean lighting share it
    lighting: { sky: '#b4cfe8', ground: '#465058', hemisphere: 1.5, sun: '#ffe9c4', sunIntensity: 2.8 },
    // The camera looks straight down but heights lean up-screen by this many
    // pixels per unit, so walls, masts and hillsides show a face. Ground
    // positions are untouched: sea-level x,y still maps 1:1 to the screen.
    oblique: .42,
    groundHeight: 8.5,       // island interior above the sea
    shadow: { color: '#040f1a', opacity: .42 },
    tracer: { seconds: .038, width: 4 },   // streak length as flight time, and glow width in px
    wake: { width: 2.2, length: 2.9, lead: .08 },   // wake quad in ship beams / lengths; lead ahead of the bow
    quality: {
      // Adaptive quality ladder, best first. The renderer steps down while
      // frames stay slow and back up only into levels that never failed.
      // Shadows are planar projections (shadow.js), so every level has them.
      // pixelRatio caps the device ratio (below 1 the world renders soft but
      // the HUD stays crisp); ocean is the shader detail (2 full, 1 no
      // glitter/whitecaps, 0 two octaves, no clouds).
      // Pin a level for testing with ?quality=N in the URL.
      levels: [
        { pixelRatio: 2, ocean: 2 },
        { pixelRatio: 1.5, ocean: 2 },
        // Native 1:1 is where cheap tablets start: the top-down world is
        // authored at one unit per CSS pixel, so nothing is lost.
        { pixelRatio: 1, ocean: 2 },
        { pixelRatio: .8, ocean: 1 },
        { pixelRatio: .65, ocean: 0 },
      ],
      start: 1,
      touchStart: 2,
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
      glitter: .45,            // sun sparkle intensity
      foam: .1,                // pale bloom on the tallest crests
      surf: .55,               // shoreline foam ring opacity
      deep: '#062740', mid: '#0e4a6b', sky: '#1d4a66', shallows: '#36aaa0',
      shallowsRadius: 1.9,     // lagoon fade-out distance, in island radii
      shallowsOpacity: .8,     // strength of the turquoise skirt at the shoreline
    },
    land: {
      // Island scenery. Everything is authored in world units (1 ≈ one CSS
      // pixel; an aircraft is 48 wide) and batched into one draw per island.
      treeSpacing: 21,         // grid step between forest trees
      maxTrees: 2600,          // spacing widens on large islands to stay under this
      forestCover: .48,        // fraction of an island's interior that becomes forest
      villageRadius: 220,      // islands smaller than this get a hut at most
      houseSize: 16,           // footprint of a village house
      roadWidth: 9,
      clearRadius: { airfield: 240, port: 190, radar: 170 }, // scenery keeps off installations
      traffic: {
        trucks: 64, people: 256, boats: 32,   // instance pool sizes
        truckSpeed: 34, walkSpeed: 7, boatSpeed: 18,
        peoplePerVillage: [4, 9], trucksPerRoad: [1, 3],
      },
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
    hp: 4,                    // collisions no longer do the enemy's work, so guns must
    fireCooldown: 0.6,
    ace: { speed: 290, turn: 2.6, hp: 6, fireCooldown: 0.45 },
    aceFromTerritory: 2,           // first wave that can include aces
    aceEvery: 3,              // every Nth enemy in a wave is an ace
    bulletSpeed: 660,
    bulletLife: 1.2,
    bulletDamage: 12,
    engageDist: 470,          // max range to open fire
    aimCone: 0.34,            // rad off-nose tolerance to fire
    // Glancing collisions: both aircraft are hurt and shoved apart, the enemy
    // is briefly uncontrollable and the player spins out. Nobody dies of one,
    // and ramming pays no score.
    collision: { radius: 26, damage: 15, enemyDamage: 1, shove: 70, stunSeconds: .5, cooldown: 1,
      spinSeconds: 1.1, spinTurns: 1.25 },   // the player tumbles: no controls, no guns, speed bleeding off
    avoidRange: 260,          // fighters sidestep a head-on closer than this
    closeRange: 200,          // and any fast closure inside this, whatever the headings
    recoverSeconds: 1.5,      // after a collision, extend away before re-engaging
    brake: .65, boost: 1.35,  // throttle multipliers of an enemy's base speed
    // Flying styles. Recruits pure-pursue; veterans lead their target and brake
    // to cut inside; aces boom and zoom, extending after a pass and breaking
    // hard when something gets on their tail.
    styles: { weaveRange: 260, weave: 170, veteran: { brakeAngle: 1.1 }, ace: { extendSeconds: 1.6, breakSeconds: 1, breakRange: 320, passRange: 150 } },
    spawnDistMin: 750,
    spawnDistMax: 1150,
  },
  aircraft: {
    p38: { speedCruise: 275, speedBoost: 370, speedBrake: 165, turnRate: 2.8, gunOffsets: [-3, 3] },
    dauntless: { speedCruise: 210, speedBoost: 280, speedBrake: 130, turnRate: 2.4, fireCooldown: .22, bombDamage: 40, bombBlastRadius: 120, bombFallSeconds: .7, bombDriftSpeed: 130 },
    avenger: { speedCruise: 215, speedBoost: 275, speedBrake: 135, turnRate: 2.1, fireCooldown: .24, torpedoDamage: 40 },
    p51: { speedCruise: 315, speedBoost: 430, speedBrake: 180, turnRate: 3.3, fireCooldown: .1, heatPerShot: .075, gunOffsets: [-6, 6] },
  },
  navigation: { repairHull: 30, arrivalRadius: 500, departureRadius: 700 },
  // Speed trades for turn: braked aircraft turn tight, boosted ones turn wide.
  // Applies to every aircraft, so cutting inside a circle is a choice.
  flight: { turnScale: { brake: 1.3, boost: .75 } },
  // Enemy supply convoys run between holdings and resupply the destination.
  // Transports are soft: guns sink them, and each one is worth score.
  convoy: { firstDelay: 45, intervalMin: 50, intervalMax: 80, size: [2, 3], maxActive: 2, speed: 32, hp: 8,
    length: 64, width: 20, spacing: 95, offshore: 260, supply: 12, score: 150, sightRadius: 1600 },
  persistence: { saveInterval: 15 },
  theater: { homeCoastSetback: 115, portSetback: 80, fleetCoastClearance: 650, fleetPatrolLength: 4200 },
  fleet: { turnRate: .25, enemyCarrierHp: 80, speed: 24, escortAhead: 180, escortLateral: 230, approachHoldDistance: 650, approachHoldAngle: .65 },
  intelligence: { minimapRadius: 2200, chartRadius: 5500, reconnaissanceRadius: 1800, radarRadius: 6500, searchRadius: 1500, fleetContactSeconds: 90, uncertaintyPerSecond: 24, tacticalRadius: 1100 },
  airfield: { deckHeight: 9, length: 300, width: 70, hp: 40, homeHp: 200 },
  progression: { aircraftUnlocks: { dauntless: 0, avenger: 4000, p51: 6000 }, aircraftSorties: { dauntless: 1, corsair: 5, avenger: 8, p51: 12 }, rescueScore: 2500, rescueStartRadius: 1200, rescueIntercepts: 2, rescueHp: 140, rescueRadius: 600, rescueRetry: 45, rescueEnemies: 3, rescueSpawnDistance: 1500 },
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
    // Wingmen: a squadron that flies off the player's quarters, engages what the
    // player engages and comes home. Slots by rank; losses are replaced only
    // after further combat sorties, so bringing them home matters.
    // Doctrine: cover the player, never play the game for them. Wingmen fight
    // only what threatens the player (tail-chasers first), shoot slowly and
    // only clean shots, break off when hurt, and their kills score half.
    wing: { slots: [1, 2, 3], hp: 40, speed: 275, boost: 370, turn: 2.8, fireCooldown: .9, aimCone: .12,
      formation: [[-70, 62], [-70, -62], [-140, 0]], engageRange: 450, selfDefence: 220, rejoinRange: 600,
      retreatHull: .4, killScore: .5,
      replacementSorties: 2, veteranKills: 3, veteran: { aimCone: .16, fireCooldown: .6, hp: 52 },
      names: ['Hawk', 'Dutch', 'Tex', 'Moose', 'Sparky', 'Duke', 'Red', 'Slim', 'Ace', 'Whiskey', 'Chief', 'Kid'] },
    // Captured airfields fly their own patrols around the neighbourhood.
    patrol: { intervalMin: 55, intervalMax: 90, size: 2, maxActive: 6, duration: 80, radius: 900, engageRange: 600 },
    gunnery: { aimCone: .22, fireCooldown: .5 },   // patrols and carrier aircraft
    // The carrier keeps a combat air patrol overhead and flies strikes of its own.
    cap: { count: 2, radius: 420, respawn: 60, engageRange: 750 },
    carrierStrike: { intervalMin: 110, intervalMax: 160, size: 2, range: 6500, damage: 10, attackRange: 80 },
    allyRange: 600, waypointRadius: 150,
  },
  torpedo: { capacity: 2, rearmSeconds: 0, speed: 220, range: 1100, damage: 20, cooldown: 5, armingDistance: 45 },
  ship: {
    length: 115, width: 28, hp: 20, speed: 22, patrolOffset: 155,
    gunRange: 500, fireCooldown: 1.8, bulletSpeed: 400, bulletDamage: 6, score: 200,
    sinkingSeconds: 4,
  },
  score: { kill: 100, aceKill: 250 },
  camera: { lead: 60 },       // px the camera leads ahead of the nose
  // In-flight HUD. Presentation only: nothing here changes how the game plays.
  hud: {
    // Status ring worn by the player's aircraft; it turns with the heading.
    // Aft arc = hull in cells, fore arc = gun heat. Angles are half-arcs in radians.
    rig: { radius: 31, width: 5.5, cells: 5, cellGap: 3, hullHalfArc: 1.9, heatHalfArc: .82, heatWidth: 4,
      worn: 60, low: 35,           // hull % where the arc turns amber, then critical
      heatWarn: .7,                // heat where the fore arc gains its limit stops
      bankSquash: .2, bankResponse: 7, pulse: 7 },
    // Guiding wind: streaks that blow from the aircraft toward the objective.
    wind: { streaks: 5, inner: 44, spanShare: .22, spanMin: 70, spanMax: 120, length: 56, lane: 8,
      speed: .55, thickness: 2.9, busyStreaks: 4, busyAlpha: .85, minRun: 26 },
    site: { ring: 24, orbit: 34, ticks: 12, orbitSpeed: 1.1 },
    // A fight is "busy" with a live enemy this close (px); secondary cues then recede.
    busy: { range: 420, fade: 5 },
    edge: { margin: 22, baseBeyond: .75 },   // base cue appears once it is this share of the screen away
    keepout: { refreshFrames: 20, pad: 6 },
    pipper: { range: 650, cone: 1.1, radius: 7 },
  },
};
