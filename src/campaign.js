// Seeded island chains, persistent bases, and the carrier rescue progression.
import { CONFIG } from './config.js';
import { rand, TAU } from './util.js';

export function createCampaign() {
  const G = CONFIG.generation, C = CONFIG.carrier;
  const territories = [{ id: 0, name: 'HOME ISLAND', x: 0, y: 0, radius: 370, owner: 'us', activated: true, progress: 0, fighters: 0, seed: rand(0, 10000) }];
  const cells = [[-1,0],[1,0],[-1,-1],[0,-1],[1,-1],[-2,-1],[2,-1],[-1,-2],[0,-2],[1,-2]];
  for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(rand(0, i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  const count = Math.floor(rand(G.enemyMin, G.enemyMax + 1));
  const names = ['CORAL', 'PALM', 'LAGOON', 'NORTH REEF', 'EMBER', 'JADE', 'TURTLE'];
  cells.slice(0, count).forEach(([gx, gy], i) => territories.push({ id: i + 1, name: names[i],
    x: gx * G.spacing + rand(-G.jitter, G.jitter), y: gy * G.spacing + rand(-G.jitter, G.jitter),
    radius: rand(G.radiusMin, G.radiusMax), seed: rand(0, 10000), owner: 'enemy', activated: false, progress: 0, fighters: i < 3 ? 2 : 3 }));
  const airfields = territories.filter((t, i) => i === 0 || i % 2 === 1).map(t => ({
    id: t.id === 0 ? 'home-airfield' : `airfield-${t.id}`, territory: t.id, name: t.name,
    x: t.x, y: t.y, a: -Math.PI / 2, owner: t.owner,
    hp: t.id === 0 ? CONFIG.airfield.homeHp : CONFIG.airfield.hp,
    maxHp: t.id === 0 ? CONFIG.airfield.homeHp : CONFIG.airfield.hp, launchTimer: rand(35, 55) }));
  const ships = [{ id: 'carrier', kind: 'carrier', name: 'USS Resolute', team: 'us', active: false,
    x: 540, y: 650, a: -Math.PI / 2, hp: CONFIG.progression.rescueHp, maxHp: CONFIG.progression.rescueHp,
    fireCd: 0, length: C.length, width: C.width }];
  territories.slice(1).forEach(t => {
    const orbit = t.radius + CONFIG.ship.patrolOffset, angle = rand(0, TAU);
    ships.push({ id: `patrol-${t.id}`, kind: 'destroyer', team: 'jp', territory: t.id,
      x: t.x + Math.cos(angle) * orbit, y: t.y + Math.sin(angle) * orbit, a: angle + Math.PI / 2,
      orbit, angle, fireCd: 1, hp: CONFIG.ship.hp, maxHp: CONFIG.ship.hp, length: CONFIG.ship.length, width: CONFIG.ship.width });
  });
  ships.push({ id: 'enemy-carrier', kind: 'carrier', team: 'jp', name: 'Enemy carrier',
    x: -1200, y: 900, anchorX: -1200, anchorY: 900, orbit: 180, angle: 0, a: -Math.PI / 2,
    hp: 80, maxHp: 80, length: C.length, width: C.width, fireCd: 1, launchTimer: 50 });
  const bases = airfields.map(f => ({ id: f.id, name: f.territory === 0 ? 'Home Airfield' : `${f.name} Airfield`,
    kind: 'airfield', airfieldId: f.id, territory: f.territory, x: f.x, y: f.y, a: f.a,
    length: CONFIG.airfield.length, width: CONFIG.airfield.width, owner: f.owner, available: f.owner === 'us' }));
  bases.push({ id: 'fleet-carrier', name: 'USS Resolute', kind: 'carrier', shipId: 'carrier',
    x: ships[0].x, y: ships[0].y, a: ships[0].a, length: C.length, width: C.width, owner: 'us', available: false });
  return { territories, ships, airfields, bases, rank: 0, rescue: { status: 'locked', timer: 0 }, bombs: [] };
}

export function defenders(game, territory) {
  return game.enemies.filter(e => e.territory === territory.id && e.hp > 0 && !e.strike).length
    + game.ships.filter(s => s.territory === territory.id && s.hp > 0).length
    + game.airfields.filter(f => f.territory === territory.id && f.owner === 'enemy' && f.hp > 0).length;
}
export function notify(game, message) { game.message = message; game.messageTime = CONFIG.conquest.messageDuration; }

function beginRescue(game) {
  const c = game.ships[0];
  c.active = true; c.hp = c.maxHp; c.sinking = 0;
  game.rescue.status = 'active'; game.rescue.intercepts = 0; game.rescue.launched = false;
  notify(game, 'Carrier in distress — rendezvous with USS Resolute');
}

function launchRescueAttack(game) {
  const c = game.ships[0], R = CONFIG.progression;
  game.rescue.launched = true;
  for (let i = 0; i < R.rescueEnemies; i++) {
    const a = i * .35;
    game.enemies.push({ x: c.x + Math.cos(a) * R.rescueSpawnDistance, y: c.y + Math.sin(a) * R.rescueSpawnDistance,
      a: a + Math.PI, hp: CONFIG.strike.hp, speed: CONFIG.strike.speed, turn: CONFIG.strike.turn,
      fireCd: 1, wobble: 0, strike: true, rescue: true, sourceId: 'rescue', targetBaseId: 'fleet-carrier', phase: 'attack' });
  }
  notify(game, 'Carrier in distress — defend USS Resolute');
}

export function updateCampaign(game, dt, activate) {
  const C = CONFIG.conquest, R = CONFIG.progression;
  if (game.rank === 0 && game.score >= R.rescueScore) { game.rank = 1; beginRescue(game); }
  const carrier = game.ships[0], carrierBase = game.bases.find(b => b.kind === 'carrier');
  if (carrier.active && carrier.hp <= 0) {
    carrier.active = false; carrierBase.available = false;
    game.rescue.status = 'retry'; game.rescue.timer = R.rescueRetry;
    game.enemies = game.enemies.filter(e => !e.rescue);
    if (game.player.baseId === carrierBase.id && game.player.flight !== 'flying') {
      const home = game.bases[0]; Object.assign(game.player, { x: home.x, y: home.y, a: home.a, baseId: home.id,
        flight: 'landed', parked: { x: home.x, y: home.y }, parkedOffset: { along: 0, lateral: 0 }, altitude: CONFIG.airfield.deckHeight });
    }
    notify(game, 'Carrier lost — regroup. Another rescue opportunity will follow.');
  }
  if (game.rescue.status === 'retry') { game.rescue.timer -= dt; if (game.rescue.timer <= 0) beginRescue(game); }
  if (game.rescue.status === 'active' && !game.rescue.launched && Math.hypot(game.player.x - carrier.x, game.player.y - carrier.y) < R.rescueStartRadius) launchRescueAttack(game);
  if (game.rescue.status === 'active' && game.rescue.launched && !game.enemies.some(e => e.rescue && e.hp > 0) && game.rescue.intercepts < R.rescueIntercepts) {
    game.rescue.status = 'retry'; game.rescue.timer = R.rescueRetry;
    notify(game, 'Strike escaped — regroup for another rescue attempt');
  }
  if (game.rescue.status === 'active' && carrier.hp > 0 && game.rescue.intercepts >= R.rescueIntercepts && !game.enemies.some(e => e.rescue && e.hp > 0)
    && Math.hypot(game.player.x - carrier.x, game.player.y - carrier.y) < R.rescueRadius) {
    game.rank = 2; game.rescue.status = 'complete'; carrierBase.available = true;
    notify(game, 'Carrier rescued — Corsair and naval operations unlocked');
  }
  for (const t of game.territories) {
    if (t.owner === 'us') continue;
    const distance = Math.hypot(game.player.x - t.x, game.player.y - t.y);
    if (!t.activated && distance < C.activateRadius) { t.activated = true; activate(t); notify(game, `${t.name}: clear defenders${game.airfields.some(f => f.territory === t.id) ? ' and bomb the airfield' : ''}`); }
    if (!t.activated) continue;
    if (defenders(game, t) === 0 && distance < C.captureRadius && game.player.flight === 'flying') {
      t.progress = Math.min(C.captureSeconds, t.progress + dt);
      if (t.progress >= C.captureSeconds) {
        t.owner = 'us'; game.score += C.captureScore;
        const field = game.airfields.find(f => f.territory === t.id), base = game.bases.find(b => b.territory === t.id);
        if (field) { field.owner = 'us'; field.hp = field.maxHp; base.owner = 'us'; base.available = true; }
        notify(game, `${t.name} secured${field ? ' — airfield available' : ''}`);
      }
    } else t.progress = 0;
  }
  if (game.airfields[0].hp <= 0) { game.mode = 'over'; game.endReason = 'Home airfield lost'; game.best = Math.max(game.best, game.score); notify(game, 'Home airfield destroyed'); }
  if (game.mode === 'play' && game.territories.every(t => t.owner === 'us') && game.ships.every(s => s.team !== 'jp' || s.hp <= 0)) {
    game.mode = 'victory'; game.best = Math.max(game.best, game.score);
  }
}
