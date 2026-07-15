// Enemy spawning and AI. Three roles:
//   defender — tethered to an enemy island; engages the player inside
//              its airspace, otherwise orbits home
//   raider   — flies to a friendly island and orbits it to wind the
//              recapture clock (islands.js applies the progress)
//   hunter   — classic pursuit: chases the player anywhere
import { CONFIG } from './config.js';
import { game, setBanner } from './state.js';
import { damagePlayer } from './player.js';
import { explosion } from './particles.js';
import { clamp, angDiff, rand, TAU } from './util.js';
import { nearestEnemyIsland } from './islands.js';
import { sfxAlarm } from './audio.js';

function makeEnemy(x, y, a, opts = {}) {
  const E = CONFIG.enemy, ace = !!opts.ace;
  return {
    x, y, a,
    speed: ace ? E.ace.speed : E.speed,
    turn: ace ? E.ace.turn : E.turn,
    hp: ace ? E.ace.hp : E.hp,
    ace,
    fireCd: rand(0.5, 1.6),
    wobble: rand(0, TAU),
    role: opts.role || 'hunter',
    home: opts.home || null,     // defender: island it protects
    target: opts.target || null, // raider: island it wants back
    orbitA: rand(0, TAU),
  };
}

function spawnDefender(isl) {
  const E = CONFIG.enemy;
  const a = rand(0, TAU), d = isl.r + rand(80, 220);
  const ace = isl.tier >= E.aceFromTier && isl.stock % E.aceEvery === 0;
  game.enemies.push(makeEnemy(
    isl.x + Math.cos(a) * d, isl.y + Math.sin(a) * d,
    rand(0, TAU), { role: 'defender', home: isl, ace }
  ));
}

function launchRaid() {
  const owned = game.islands.filter(i => i.owner === 'player');
  if (!owned.length) return;
  const target = owned[Math.floor(rand(0, owned.length)) % owned.length];
  const from = nearestEnemyIsland(target.x, target.y);
  if (!from) return; // no enemy islands left means the game is won anyway
  const n = CONFIG.raids.size + owned.length;
  const heading = Math.atan2(target.y - from.y, target.x - from.x);
  for (let i = 0; i < n; i++) {
    game.enemies.push(makeEnemy(
      from.x + rand(-140, 140), from.y + rand(-140, 140),
      heading, { role: 'raider', target }
    ));
  }
  setBanner('RAID INBOUND — ' + target.name, 2.6);
  sfxAlarm();
}

function launchPatrol() {
  if (game.enemies.length >= CONFIG.enemy.maxCount) return;
  const player = game.player;
  const from = nearestEnemyIsland(player.x, player.y);
  if (!from) return;
  const captured = game.islands.filter(i => i.owner === 'player').length;
  const n = 1 + Math.floor(captured / 2);
  for (let i = 0; i < n; i++) {
    game.enemies.push(makeEnemy(
      from.x + rand(-140, 140), from.y + rand(-140, 140),
      Math.atan2(player.y - from.y, player.x - from.x),
      { role: 'hunter', ace: captured >= 3 && i === 0 }
    ));
  }
}

export function updateEnemies(dt) {
  const E = CONFIG.enemy, I = CONFIG.island, player = game.player;

  // garrison upkeep: each enemy island replaces lost defenders while
  // it has reserves; the initial complement fills in the first moments
  for (const isl of game.islands) {
    if (isl.owner !== 'enemy' || isl.stock <= 0) continue;
    let defenders = 0;
    for (const e of game.enemies) if (e.role === 'defender' && e.home === isl) defenders++;
    if (defenders >= isl.cap) continue;
    isl.defT -= dt;
    if (isl.defT <= 0) {
      spawnDefender(isl);
      isl.stock--;
      isl.defT = game.runTime < 1 ? 0.02 : I.defRespawn;
    }
  }

  // recapture raids + hunter patrols on their own clocks
  game.raidT -= dt;
  if (game.raidT <= 0) { launchRaid(); game.raidT = CONFIG.raids.every; }
  game.patrolT -= dt;
  if (game.patrolT <= 0) { launchPatrol(); game.patrolT = CONFIG.patrols.every; }

  for (const e of game.enemies) {
    e.wobble += dt * 2;

    // roles react to the front line moving: a beaten garrison
    // withdraws to reinforce the nearest island still holding out
    if (e.role === 'defender' && e.home.owner !== 'enemy') {
      const next = nearestEnemyIsland(e.x, e.y);
      if (next) e.home = next;
      else { e.role = 'hunter'; e.home = null; }
    }
    if (e.role === 'raider' && e.target.owner !== 'player') {
      e.role = 'defender'; e.home = e.target; e.target = null;
    }

    const pd = Math.hypot(player.x - e.x, player.y - e.y);
    const chasing = e.role === 'hunter' ||
      (e.role === 'defender' && player.phase === 'air' &&
       Math.hypot(player.x - e.home.x, player.y - e.home.y) < I.airspace);

    let tx, ty;
    if (chasing) {
      tx = player.x + Math.cos(e.wobble) * 60;
      ty = player.y + Math.sin(e.wobble * 1.3) * 60;
    } else {
      const c = e.role === 'raider' ? e.target : e.home;
      const orbitR = c.r + 140;
      if (Math.hypot(c.x - e.x, c.y - e.y) > orbitR + 220) {
        tx = c.x; ty = c.y;
      } else {
        e.orbitA += dt * e.speed / orbitR;
        tx = c.x + Math.cos(e.orbitA) * orbitR;
        ty = c.y + Math.sin(e.orbitA) * orbitR;
      }
    }

    const want = Math.atan2(ty - e.y, tx - e.x);
    const d = angDiff(e.a, want);
    e.a += clamp(d, -e.turn * dt, e.turn * dt);
    e.x += Math.cos(e.a) * e.speed * dt;
    e.y += Math.sin(e.a) * e.speed * dt;

    // guns point at the player regardless of role (raiders shoot
    // back opportunistically while they orbit)
    e.fireCd -= dt;
    if (player.phase === 'air') {
      const aimD = angDiff(e.a, Math.atan2(player.y - e.y, player.x - e.x));
      if (e.fireCd <= 0 && pd < E.engageDist && Math.abs(aimD) < E.aimCone) {
        e.fireCd = e.ace ? E.ace.fireCooldown : E.fireCooldown;
        game.ebullets.push({
          x: e.x + Math.cos(e.a) * 20, y: e.y + Math.sin(e.a) * 20,
          vx: Math.cos(e.a) * E.bulletSpeed, vy: Math.sin(e.a) * E.bulletSpeed,
          life: E.bulletLife,
        });
      }
      if (pd < E.ramDist) {
        e.hp = 0;
        damagePlayer(E.ramDamage);
        explosion(e.x, e.y, false);
      }
    }
  }
}
