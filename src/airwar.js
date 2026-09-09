// Independent friendly patrols and occasional roaming interceptors.
import { CONFIG } from './config.js';
import { game } from './state.js';
import { view } from './canvas.js';
import { clamp, angDiff, rand, TAU } from './util.js';

export function updateAirWar(dt) {
  const A = CONFIG.airWar;
  game.raidTimer -= dt;
  if (game.raidTimer <= 0 && game.player.flight === 'flying' && !game.enemies.some(e => e.raider && e.hp > 0)) {
    const angle = rand(0, TAU), radius = Math.max(A.raidSpawnDistance, Math.hypot(view.W, view.H) / 2 + 200);
    game.enemies.push({ x: game.player.x + Math.cos(angle) * radius, y: game.player.y + Math.sin(angle) * radius,
      a: angle + Math.PI, hp: CONFIG.enemy.hp, speed: A.raidSpeed, turn: CONFIG.enemy.turn,
      raider: true, ace: false, fireCd: 1, wobble: rand(0, TAU) });
    game.raidTimer = rand(A.raidMin, A.raidMax);
  }
  for (const f of game.allies) {
    if (f.hp <= 0) continue;
    f.fireCd -= dt; f.hitFlash = Math.max(0, f.hitFlash - dt);
    const target = game.enemies.filter(e => e.hp > 0 && Math.hypot(e.x - f.x, e.y - f.y) < A.allyRange)
      .sort((a, b) => Math.hypot(a.x - f.x, a.y - f.y) - Math.hypot(b.x - f.x, b.y - f.y))[0];
    const route = [...game.territories, game.ships[0]], waypoint = route[f.waypoint % route.length];
    if (!target && Math.hypot(waypoint.x - f.x, waypoint.y - f.y) < A.waypointRadius) f.waypoint++;
    const goal = target ?? waypoint;
    const delta = angDiff(f.a, Math.atan2(goal.y - f.y, goal.x - f.x));
    f.a += clamp(delta, -f.turn * dt, f.turn * dt);
    f.x += Math.cos(f.a) * f.speed * dt; f.y += Math.sin(f.a) * f.speed * dt;
    if (target && f.fireCd <= 0 && Math.abs(delta) < CONFIG.enemy.aimCone) {
      f.fireCd = A.allyFireCooldown;
      game.bullets.push({ x: f.x + Math.cos(f.a) * 22, y: f.y + Math.sin(f.a) * 22,
        vx: Math.cos(f.a) * CONFIG.player.bulletSpeed, vy: Math.sin(f.a) * CONFIG.player.bulletSpeed,
        life: CONFIG.player.bulletLife, fromShip: true, fromAlly: true });
    }
  }
}
