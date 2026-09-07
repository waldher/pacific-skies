// Finite, persistent territory objectives on the existing procedural islands.
import { CONFIG } from './config.js';
import { hash2 } from './util.js';

export function createCampaign() {
  const territories = CONFIG.conquest.islands.map(([name, gx, gy], i) => {
    const h = hash2(gx * 3 + 11, gy * 7 + 5);
    return { id: i, name, x: gx * 1500 + 1500 * (.25 + hash2(gx, gy * 2) * .5),
      y: gy * 1500 + 1500 * (.25 + hash2(gx * 2, gy) * .5), radius: 90 + h * 600,
      owner: 'enemy', activated: false, progress: 0, fighters: CONFIG.conquest.fighters[i] };
  });
  const C = CONFIG.carrier;
  const ships = [{ id: 'carrier', kind: 'carrier', team: 'us', x: C.x, y: C.y, a: -Math.PI / 2,
    hp: Infinity, maxHp: Infinity, fireCd: 0, length: C.length, width: C.width }];
  territories.forEach((t, i) => {
    for (let j = 0; j < CONFIG.conquest.destroyers[i]; j++) {
      const orbit = t.radius + CONFIG.ship.patrolOffset + j * 75;
      const angle = (i + j) * 1.9;
      ships.push({ id: `patrol-${i}-${j}`, kind: 'destroyer', team: 'jp', territory: t.id,
        x: t.x + Math.cos(angle) * orbit, y: t.y + Math.sin(angle) * orbit,
        a: angle + Math.PI / 2, orbit, angle, fireCd: 1 + j,
        hp: CONFIG.ship.hp, maxHp: CONFIG.ship.hp, length: CONFIG.ship.length, width: CONFIG.ship.width });
    }
  });
  return { territories, ships };
}

export function defenders(game, territory) {
  return game.enemies.filter(e => e.territory === territory.id && e.hp > 0).length
    + game.ships.filter(s => s.territory === territory.id && s.hp > 0).length;
}

export function notify(game, message) {
  game.message = message;
  game.messageTime = CONFIG.conquest.messageDuration;
}

export function updateCampaign(game, dt, activate) {
  const C = CONFIG.conquest;
  for (const t of game.territories) {
    if (t.owner === 'us') continue;
    const distance = Math.hypot(game.player.x - t.x, game.player.y - t.y);
    if (!t.activated && distance < C.activateRadius) {
      t.activated = true;
      activate(t);
      notify(game, `${t.name}: clear fighters and ships`);
    }
    if (!t.activated) continue;
    if (defenders(game, t) === 0 && distance < C.captureRadius && game.player.flight === 'flying') {
      t.progress = Math.min(C.captureSeconds, t.progress + dt);
      if (t.progress >= C.captureSeconds) {
        t.owner = 'us';
        game.score += C.captureScore;
        notify(game, `${t.name} secured`);
        if (game.target === t.id) {
          const next = game.territories.filter(s => s.owner !== 'us').sort((a, b) =>
            Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y))[0];
          game.target = next?.id ?? 'carrier';
        }
      }
    } else t.progress = 0;
  }
  if (game.mode === 'play' && game.territories.every(t => t.owner === 'us')) {
    game.mode = 'victory';
    game.best = Math.max(game.best, game.score);
  }
}

export function getTarget(game) {
  return game.target === 'carrier' ? game.ships.find(s => s.kind === 'carrier')
    : game.territories.find(t => t.id === game.target);
}

export function nextTarget(game) {
  const choices = ['carrier', ...game.territories.filter(t => t.owner !== 'us').map(t => t.id)];
  game.target = choices[(choices.indexOf(game.target) + 1) % choices.length];
}
