// Territory defense and enemy fighter AI.
//
// Three flying styles keep fights from collapsing into one circle:
//   recruit  pure pursuit with a wobble, cruise throttle
//   veteran  leads the target so its rounds land; brakes to cut inside
//   ace      boom and zoom: attacks at boost, extends after a pass, and
//            breaks hard when something gets on its tail
// Every fighter sidesteps a head-on; a collision is glancing (both hurt,
// shoved apart, stunned) and pays no score. Throttle changes turn rate (player.js).
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

// Where a target will be when a round fired now arrives: along its current
// arc when it is turning, straight ahead otherwise.
export function leadPoint(from, target, bulletSpeed) {
  const d = Math.hypot(target.x - from.x, target.y - from.y), t = d / bulletSpeed;
  const v = target.v ?? target.speed ?? 0, w = target.omega || 0;
  if (Math.abs(w) < .15) return { x: target.x + Math.cos(target.a) * v * t, y: target.y + Math.sin(target.a) * v * t };
  const r = v / w;
  return { x: target.x + r * (Math.sin(target.a + w * t) - Math.sin(target.a)), y: target.y - r * (Math.cos(target.a + w * t) - Math.cos(target.a)) };
}
// True when `a` is inside `range` of `b`, does not have it dead astern, and the
// gap is closing fast: a turning fight about to trade paint, whatever the headings.
export function closing(a, b, range, minClosing = 40) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  if (d > range || Math.abs(angDiff(a.a, Math.atan2(dy, dx))) > 2.2) return false;
  const va = a.v ?? a.speed ?? 0, vb = b.v ?? b.speed ?? 0;
  return ((Math.cos(a.a) * va - Math.cos(b.a) * vb) * dx + (Math.sin(a.a) * va - Math.sin(b.a) * vb) * dy) / d > minClosing;
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
      else {
        tx = lead.x; ty = lead.y;
        // Weave on a head-on approach so nobody can hold a bead on the merge.
        const toTarget = Math.atan2(target.y - e.y, target.x - e.x);
        const merging = Math.abs(angDiff(e.a, toTarget)) < .6 && Math.abs(angDiff(target.a, toTarget + Math.PI)) < .7;
        if (dist > S.weaveRange && merging) {
          const sway = Math.sin(e.wobble * 2.2) * S.weave;
          tx += Math.cos(toTarget + Math.PI / 2) * sway; ty += Math.sin(toTarget + Math.PI / 2) * sway;
        }
      }
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
    // After a collision, extend away before turning back in.
    if (e.recover > 0) { e.recover -= dt; tx = e.x + Math.cos(e.a) * 200; ty = e.y + Math.sin(e.a) * 200; throttle = E.boost; }
    // Nobody trades paint on purpose: a head-on, or any fast closure at short range, is sidestepped.
    if (target && (headOn(e, target, E.avoidRange) || closing(e, target, E.closeRange))) {
      const side = angDiff(e.a, Math.atan2(target.y - e.y, target.x - e.x)) > 0 ? -1 : 1;
      tx = e.x + Math.cos(e.a + side * 1.2) * 200; ty = e.y + Math.sin(e.a + side * 1.2) * 200;
    }
    const want = Math.atan2(ty - e.y, tx - e.x);
    const d = angDiff(e.a, want);
    const turn = e.turn * turnFactor(e.v, e.speed * E.brake, e.speed * E.boost);
    const turned = e.stun > 0 ? 0 : clamp(d, -turn * dt, turn * dt);
    if (e.stun > 0) e.stun -= dt; else e.a += turned;
    e.omega = dt > 0 ? turned / dt : 0;
    e.v = lerp(e.v, e.speed * throttle, 1 - Math.pow(.05, dt));
    e.x += Math.cos(e.a) * e.v * dt;
    e.y += Math.sin(e.a) * e.v * dt;
    if (e.shoveX || e.shoveY) {
      e.x += e.shoveX * dt; e.y += e.shoveY * dt;
      const k = Math.exp(-dt / (E.collision.stunSeconds / 2));
      e.shoveX *= k; e.shoveY *= k;
      if (Math.abs(e.shoveX) + Math.abs(e.shoveY) < 1) e.shoveX = e.shoveY = 0;
    }

    e.fireCd -= dt;
    if (chase && e.fireCd <= 0 && dist < E.engageDist && aim < E.aimCone) {
      e.fireCd = e.ace ? E.ace.fireCooldown : E.fireCooldown;
      game.ebullets.push({
        x: e.x + Math.cos(e.a) * 20, y: e.y + Math.sin(e.a) * 20,
        vx: Math.cos(e.a) * E.bulletSpeed, vy: Math.sin(e.a) * E.bulletSpeed,
        life: E.bulletLife,
      });
    }
    e.collideCd = Math.max(0, (e.collideCd || 0) - dt);
    if (player.flight === 'flying' && e.collideCd <= 0 && Math.hypot(player.x - e.x, player.y - e.y) < E.collision.radius) {
      // Glancing collision: both hurt, shoved apart, briefly uncontrollable.
      const C = E.collision, dx = e.x - player.x, dy = e.y - player.y, len = Math.hypot(dx, dy) || 1;
      e.collideCd = C.cooldown; e.hp -= C.enemyDamage; e.stun = C.stunSeconds; e.recover = E.recoverSeconds;
      // The player tumbles for a while: no controls, no guns, speed bleeding off.
      player.spin = C.spinSeconds; player.spinRate = (rand(0, 1) < .5 ? -1 : 1) * TAU * C.spinTurns / C.spinSeconds;
      // An impulse that decays over the stun, not a jump: the distance is C.shove.
      const tau = C.stunSeconds / 2, push = C.shove / tau;
      e.shoveX = dx / len * push; e.shoveY = dy / len * push;
      player.shoveX = -dx / len * push * .5; player.shoveY = -dy / len * push * .5;
      game.collisions = (game.collisions || 0) + 1;
      for (let i = 0; i < 6; i++) game.particles.push({ x: player.x + dx / 2, y: player.y + dy / 2, vx: rand(-90, 90), vy: rand(-90, 90), life: .3, max: .3, size: 3, kind: 'fire' });
      damagePlayer(C.damage);
      if (e.hp <= 0) explosion(e.x, e.y, false);
    }
  }
}
