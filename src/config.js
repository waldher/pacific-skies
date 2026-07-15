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
    ammoMax: 140,             // trigger pulls per sortie; land to rearm
    heatPerShot: 0.085,       // gun heat gauge (0..1) added per trigger pull
    heatCoolRate: 0.4,        // gauge/s shed at all times (≈4s sustained fire to overheat)
    heatRecoverAt: 0.35,      // overheated guns unlock once cooled below this
    bulletSpeed: 860,
    bulletLife: 0.9,
    gunOffsets: [-7, 7],      // wing gun positions
    smokeBelowHp: 40,
  },
  carrier: {
    x: 0, y: 260, a: -Math.PI / 2, // anchored facing north, toward the front
    deckLen: 250, deckWid: 58,
    takeoffSpeed: 195,        // reach this on the deck run to get airborne
    deckAccel: 230,           // u/s^2 while holding boost on deck
    deckBrake: 300,           // u/s^2 rolling resistance / brakes on deck
    landSpeed: 185,           // must be at or below to touch down
    landAngle: 0.65,          // rad tolerance vs deck heading to touch down
    minAirTime: 1.2,          // s after takeoff before landing is possible
    repairRate: 40,           // hp/s while parked
    rearmRate: 0.55,          // fraction of ammoMax/s while parked
    flakRange: 560,
    flakCooldown: 0.85,
    flakBulletSpeed: 700,
    flakBulletLife: 0.8,
    guns: [[95, 20], [-95, -20]], // flak mounts, deck coords [along, lateral]
  },
  islands: [                  // the front line, nearest first
    { name: 'PALM',    x: -1050, y: -1250, r: 150, tier: 1 },
    { name: 'CORAL',   x:  1250, y: -1550, r: 170, tier: 2 },
    { name: 'IRON',    x: -1500, y: -2650, r: 185, tier: 3 },
    { name: 'VOLCANO', x:  1150, y: -3000, r: 200, tier: 4 },
  ],
  island: {
    airspace: 950,            // defenders engage the player inside this radius
    rearmRadius: 1.6,         // × island r: friendly resupply zone
    rearmRate: 0.1,           // fraction of ammoMax/s gained inside the zone
    defCap: 1,                // defenders on patrol = defCap + tier
    defStock: 3,              // garrison reserves = cap × this (limits farming)
    defRespawn: 8,            // s between replacement defenders
    captureTime: 12,          // s of raider presence to lose a friendly island
    captureRegen: 0.15,       // capture progress lost /s once raiders are gone
    aa: { hp: 6, range: 540, cooldown: 1.7, bulletSpeed: 430, damage: 12 },
    hq: { hp: 12 },
  },
  enemy: {
    speed: 245,
    turn: 2.1,
    hp: 2,
    fireCooldown: 1.2,
    ace: { speed: 290, turn: 2.6, hp: 4, fireCooldown: 0.8 },
    aceFromTier: 3,           // islands of this tier+ field aces among defenders
    aceEvery: 3,              // every Nth defender from those islands is an ace
    bulletSpeed: 560,
    bulletLife: 1.4,
    bulletDamage: 9,
    engageDist: 470,          // max range to open fire
    aimCone: 0.22,            // rad off-nose tolerance to fire
    ramDist: 26,
    ramDamage: 30,
    maxCount: 20,             // patrol spawns hold off above this many planes
  },
  raids: {
    first: 50,                // s until the first recapture raid can launch
    every: 45,                // s between raids (skipped if you hold no islands)
    size: 2,                  // raiders = size + islands you hold
  },
  patrols: {
    first: 25,                // s until the first hunter patrol
    every: 30,                // s between patrols
  },
  score: { kill: 100, aceKill: 250, structure: 40, capture: 400, win: 1500 },
  camera: { lead: 60 },       // px the camera leads ahead of the nose
};
