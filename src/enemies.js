// Territory defense and enemy fighter AI.
//
// Three flying styles keep fights from collapsing into one circle:
//   recruit  pure pursuit with a wobble, cruise throttle
//   veteran  leads the target so its rounds land; brakes to cut inside
//   ace      boom and zoom: attacks at boost, extends after a pass, and
//            breaks hard when something gets on its tail
// Every fighter sidesteps a head-on so collisions are the player's choice,
// and a collision pays no score. Throttle changes turn rate (player.js).
import { CONFIG } from './config.js';
import { game } from './state.js';
import { damagePlayer, turnFactor } from './player.js';
import { explosion } from './particles.js';
import { clamp, angDiff, rand, lerp, TAU } from './util.js';

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
      style: ace ? 'ace' : i % 2 ? 'veteran' : 'recruit',
    });
  }
}

// Where a target will be when a round fired now arrives.
export function leadPoint(from, target, bulletSpeed) {
  const d = Math.hypot(target.x - from.x, target.y - from.y), t = d / bulletSpeed;
  const v = target.v ?? target.speed ?? 0;
  return { x: target.x + Math.cos(target.a) * v * t, y: target.y + Math.sin(target.a) * v * t };
}
// True when two aircraft are flying at each other inside the avoid range.
export function headOn(a, b, range) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d > range) return false;
  const toB = Math.atan2(b.y - a.y, b.x - a.x);
  return Math.abs(angDiff(a.a, toB)) < .8 && Math.abs(angDiff(b.a, toB + Math.PI)) < .8;
}

export function updateEnemies(dt) {
  const E = CONFIG.enemy, S = E.styles, player = game.player;
  for (const e of game.enemies) {
    if (e.hp <= 0 || e.strike) continue;
    e.wobble += dt * 2;
    e.v ??= e.speed;
    const style = e.style || (e.ace ? 'ace' : 'recruit');
    const home = e.raider ? game.ships[0] : game.territories[e.territory];
    const candidates = [player, ...game.allies].filter(f => f.hp > 0 && (!f.flight || f.flight === 'flying'));
    const target = e.raider && player.flight === 'flying' ? player : candidates.sort((a, b) =>
      Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(b.x - e.x, b.y - e.y))[0];
    const chase = target && (e.raider || (Math.hypot(target.x - home.x, target.y - home.y) < CONFIG.conquest.pursuitRadius
      && Math.hypot(target.x - e.x, target.y - e.y) < CONFIG.conquest.engageRadius));
    const dist = target ? Math.hypot(target.x - e.x, target.y - e.y) : Infinity;
    let tx, ty, throttle = 1;
    if (chase) {
      const lead = leadPoint(e, target, E.bulletSpeed);
      if (style === 'recruit') { tx = target.x + Math.cos(e.wobble) * 60; ty = target.y + Math.sin(e.wobble * 1.3) * 60; }
      else { tx = lead.x; ty = lead.y; }
      if (style === 'veteran' && Math.abs(angDiff(e.a, Math.atan2(ty - e.y, tx - e.x))) > S.veteran.brakeAngle) throttle = E.brake;
      if (style === 'ace') {
        e.phase ??= 'attack'; e.phaseTime = (e.phaseTime ?? 0) - dt;
        const toTarget = Math.atan2(target.y - e.y, target.x - e.x);
        const tailed = dist < S.ace.breakRange && Math.abs(angDiff(e.a, toTarget)) > 2.3 && Math.abs(angDiff(target.a, toTarget)) > 2.3;
        if (tailed && e.phase !== 'break') { e.phase = 'break'; e.phaseTime = S.ace.breakSeconds; e.side = angDiff(e.a, toTarget) > 0 ? -1 : 1; }
        if (e.phase === 'attack') {
          throttle = E.boost;
          if (dist < S.ace.passRange) { e.phase = 'extend'; e.phaseTime = S.ace.extendSeconds; }
        } else if (e.phase === 'extend') {
          throttle = E.boost; tx = e.x + Math.cos(e.a) * 200; ty = e.y + Math.sin(e.a) * 200;
          if (e.phaseTime <= 0) e.phase = 'attack';
        } else {
          throttle = E.brake; tx = e.x + Math.cos(e.a + e.side * 1.5) * 200; ty = e.y + Math.sin(e.a + e.side * 1.5) * 200;
          if (e.phaseTime <= 0) { e.phase = 'extend'; e.phaseTime = S.ace.extendSeconds; }
        }
      }
    } else {
      tx = home.x + Math.cos(e.wobble * .2) * CONFIG.conquest.patrolRadius;
      ty = home.y + Math.sin(e.wobble * .2) * CONFIG.conquest.patrolRadius;
    }
    // Guns: recruits fire down their own pursuit line; veterans and aces fire when
    // the nose is on the lead point, whatever they are steering around.
    let aim = Infinity;
    if (chase) {
      const lead = leadPoint(e, target, E.bulletSpeed);
      const gun = style === 'recruit' ? Math.atan2(ty - e.y, tx - e.x) : Math.atan2(lead.y - e.y, lead.x - e.x);
      aim = Math.abs(angDiff(e.a, gun));
    }
    // Nobody trades paint on purpose: a head-on inside the avoid range is sidestepped.
    if (target && headOn(e, target, E.avoidRange)) {
      const side = angDiff(e.a, Math.atan2(target.y - e.y, target.x - e.x)) > 0 ? -1 : 1;
      tx = e.x + Math.cos(e.a + side * 1.2) * 200; ty = e.y + Math.sin(e.a + side * 1.2) * 200;
    }
    const want = Math.atan2(ty - e.y, tx - e.x);
    const d = angDiff(e.a, want);
    const turn = e.turn * turnFactor(e.v, e.speed * E.brake, e.speed * E.boost);
    e.a += clamp(d, -turn * dt, turn * dt);
    e.v = lerp(e.v, e.speed * throttle, 1 - Math.pow(.05, dt));
    e.x += Math.cos(e.a) * e.v * dt;
    e.y += Math.sin(e.a) * e.v * dt;

    e.fireCd -= dt;
    if (chase && e.fireCd <= 0 && dist < E.engageDist && aim < E.aimCone) {
      e.fireCd = e.ace ? E.ace.fireCooldown : E.fireCooldown;
      game.ebullets.push({
        x: e.x + Math.cos(e.a) * 20, y: e.y + Math.sin(e.a) * 20,
        vx: Math.cos(e.a) * E.bulletSpeed, vy: Math.sin(e.a) * E.bulletSpeed,
        life: E.bulletLife,
      });
    }
    if (player.flight === 'flying' && Math.hypot(player.x - e.x, player.y - e.y) < E.ramDist) {
      e.hp = 0;
      damagePlayer(E.ramDamage);
      explosion(e.x, e.y, false);
    }
  }
}
