// Territory defense and enemy AI: pursue with wobble, fire when
// aligned, deal ram damage up close.
import { CONFIG } from './config.js';
import { game } from './state.js';
import { damagePlayer } from './player.js';
import { explosion } from './particles.js';
import { clamp, angDiff, rand, TAU } from './util.js';

export function spawnDefenders(territory) {
  const E = CONFIG.enemy;
  for (let i = 0; i < territory.fighters; i++) {
    const ace = territory.id >= E.aceFromTerritory && i % E.aceEvery === E.aceEvery - 1;
    const a = i * TAU / territory.fighters, radius = CONFIG.conquest.patrolRadius;
    game.enemies.push({
      x: territory.x + Math.cos(a) * radius, y: territory.y + Math.sin(a) * radius,
      a: a + Math.PI / 2, territory: territory.id,
      speed: ace ? E.ace.speed : E.speed, turn: ace ? E.ace.turn : E.turn,
      hp: ace ? E.ace.hp : E.hp, ace, fireCd: rand(.5, 1.6), wobble: rand(0, TAU),
    });
  }
}

export function updateEnemies(dt) {
  const E = CONFIG.enemy, player = game.player;
  for (const e of game.enemies) {
    if (e.hp <= 0 || e.strike) continue;
    e.wobble += dt * 2;
    const home = e.raider ? game.ships[0] : game.territories[e.territory];
    const candidates = [player, ...game.allies].filter(f => f.hp > 0 && f.flight !== 'landed');
    const target = e.raider && player.flight !== 'landed' ? player : candidates.sort((a, b) =>
      Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(b.x - e.x, b.y - e.y))[0];
    const chase = target && (e.raider || (Math.hypot(target.x - home.x, target.y - home.y) < CONFIG.conquest.pursuitRadius
      && Math.hypot(target.x - e.x, target.y - e.y) < CONFIG.conquest.engageRadius));
    const tx = chase ? target.x + Math.cos(e.wobble) * 60 : home.x + Math.cos(e.wobble * .2) * CONFIG.conquest.patrolRadius;
    const ty = chase ? target.y + Math.sin(e.wobble * 1.3) * 60 : home.y + Math.sin(e.wobble * .2) * CONFIG.conquest.patrolRadius;
    const want = Math.atan2(ty - e.y, tx - e.x);
    const d = angDiff(e.a, want);
    e.a += clamp(d, -e.turn * dt, e.turn * dt);
    e.x += Math.cos(e.a) * e.speed * dt;
    e.y += Math.sin(e.a) * e.speed * dt;

    e.fireCd -= dt;
    const dist = target ? Math.hypot(target.x - e.x, target.y - e.y) : Infinity;
    if (chase && e.fireCd <= 0 && dist < E.engageDist && Math.abs(d) < E.aimCone) {
      e.fireCd = e.ace ? E.ace.fireCooldown : E.fireCooldown;
      game.ebullets.push({
        x: e.x + Math.cos(e.a) * 20, y: e.y + Math.sin(e.a) * 20,
        vx: Math.cos(e.a) * E.bulletSpeed, vy: Math.sin(e.a) * E.bulletSpeed,
        life: E.bulletLife,
      });
    }
    if (player.flight !== 'landed' && Math.hypot(player.x - e.x, player.y - e.y) < E.ramDist) {
      e.hp = 0;
      damagePlayer(E.ramDamage);
      explosion(e.x, e.y, false);
    }
  }
}
