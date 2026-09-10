// Organized strikes originate at surviving enemy facilities. All aircraft can be intercepted.
import { CONFIG } from './config.js';
import { rand, clamp, angDiff } from './util.js';
import { explosion } from './particles.js';

function candidates(game) {
  return [...game.bases.filter(b => b.owner === 'us' && b.available !== false),
    ...game.territories.filter(t => t.owner === 'us' && !game.bases.some(b => b.territoryId === t.id || b.territory === t.id))
      .map(t => ({ id: `territory-${t.id}`, kind: 'territory', territoryId: t.id, owner: 'us' }))];
}
function baseAsset(game, base) {
  if (base.kind === 'territory') return game.territories.find(t => t.id === base.territoryId);
  if (base.kind === 'carrier') return base.ship ?? game.ships.find(s => s.id === base.shipId);
  return base.airfield ?? game.airfields.find(f => f.id === (base.airfieldId ?? base.id));
}
function health(asset, base) { return base.kind === 'territory' ? asset.integrity : asset.hp; }
function living(game, base) {
  const a = baseAsset(game, base);
  return a && a.active !== false && health(a, base) > 0;
}
function territoryFor(game, base) {
  const asset = baseAsset(game, base);
  return game.territories.find(t => t.id === (base.territoryId ?? base.territory ?? asset?.territory));
}
export function updateStrikes(game, dt) {
  game.strikeLaunchCooldown = Math.max(0, (game.strikeLaunchCooldown || 0) - dt);
  const S = CONFIG.strike, targets = candidates(game).filter(b => living(game, b));
  const parked = game.player.flight === 'landed' && targets.find(b => b.id === game.player.baseId && b.kind === 'airfield');
  if (parked) {
    const field = baseAsset(game, parked);
    field.hp = Math.min(field.maxHp, field.hp + S.baseRepairPerSecond * dt);
  }
  const sources = [...game.airfields.filter(f => f.owner === 'enemy' && f.hp > 0),
    ...game.ships.filter(s => s.team === 'jp' && s.kind === 'carrier' && s.hp > 0 && s.active !== false)];
  for (const source of sources) source.launchTimer = (source.launchTimer ?? rand(S.intervalMin, S.intervalMax)) - dt;
  sources.sort((a, b) => a.launchTimer - b.launchTimer);
  let active = game.enemies.filter(e => e.strike && e.hp > 0).length;
  for (const source of sources) {
    if (game.strikeLaunchCooldown > 0 || source.launchTimer > 0 || !targets.length || active >= S.maxActive) continue;
    // The nearest foothold takes pressure, instead of every source ignoring the frontline.
    const target = [...targets].sort((a, b) => {
      const aa = baseAsset(game, a), bb = baseAsset(game, b);
      return Math.hypot(aa.x - source.x, aa.y - source.y) - Math.hypot(bb.x - source.x, bb.y - source.y);
    })[0];
    source.launchTimer = rand(S.intervalMin, S.intervalMax);
    game.strikeLaunchCooldown = S.launchGap;
    const asset = baseAsset(game, target), a = Math.atan2(asset.y - source.y, asset.x - source.x);
    const size = S.groupSize + S.escortCount;
    for (let i = 0; i < size && active < S.maxActive; i++, active++) {
      const offset = (i - (size - 1) / 2) * S.formationSpacing;
      game.enemies.push({ x: source.x - Math.sin(a) * offset, y: source.y + Math.cos(a) * offset,
        a, hp: S.hp, speed: S.speed, turn: S.turn, ace: false, fireCd: 0, wobble: 0,
        strike: true, strikeRole: i >= S.groupSize ? 'escort' : target.kind === 'carrier' ? 'torpedo' : 'bomber',
        sourceId: source.id, targetBaseId: target.id, phase: 'attack', retreatDistance: 0 });
    }
  }
  // Established garrisons buy time. Each emplacement engages one aircraft, with a cooldown.
  for (const base of targets) {
    const asset = baseAsset(game, base), territory = territoryFor(game, base);
    const level = base.defenseLevel ?? territory?.defenseLevel ?? (territory?.established >= CONFIG.conquest.establishSeconds ? 1 : 0);
    asset.defenseCd = Math.max(0, (asset.defenseCd ?? 0) - dt);
    if (!level || asset.defenseCd > 0 || (territory && territory.established < CONFIG.conquest.establishSeconds)) continue;
    const enemy = game.enemies.filter(e => e.strike && e.phase === 'attack' && e.hp > 0 && Math.hypot(e.x - asset.x, e.y - asset.y) < S.defenseRange)
      .sort((a, b) => Math.hypot(a.x - asset.x, a.y - asset.y) - Math.hypot(b.x - asset.x, b.y - asset.y))[0];
    if (enemy) {
      asset.defenseCd = S.defenseCooldown / level;
      const a = Math.atan2(enemy.y - asset.y, enemy.x - asset.x);
      game.bullets.push({ x: asset.x, y: asset.y, vx: Math.cos(a) * CONFIG.ship.bulletSpeed,
        vy: Math.sin(a) * CONFIG.ship.bulletSpeed, life: S.defenseRange / CONFIG.ship.bulletSpeed, fromShip: true });
    }
  }
  for (const e of game.enemies) {
    if (!e.strike || e.hp <= 0) continue;
    e.phase ??= 'attack';
    e.detected = Math.hypot(e.x - game.player.x, e.y - game.player.y) < S.escortRange
      || targets.some(b => { const a = baseAsset(game, b); return Math.hypot(e.x - a.x, e.y - a.y) < S.baseDetectionRange; })
      || game.territories.some(t => t.owner === 'us' && t.role === 'radar' && t.established >= CONFIG.conquest.establishSeconds && Math.hypot(e.x - t.x, e.y - t.y) < S.radarRange);
    const base = targets.find(b => b.id === e.targetBaseId) ?? game.bases.find(b => b.id === e.targetBaseId && b.owner === 'us' && living(game, b)), asset = base && baseAsset(game, base);
    if (!asset) e.phase = 'retreat';
    if (e.phase === 'attack') {
      let tx = asset.x, ty = asset.y;
      const escorts = e.strikeRole === 'escort';
      const player = game.player, engage = escorts && player.flight === 'flying' && Math.hypot(player.x - e.x, player.y - e.y) < S.escortRange;
      if (engage) { tx = player.x; ty = player.y; }
      const want = Math.atan2(ty - e.y, tx - e.x), diff = angDiff(e.a, want);
      e.a += clamp(diff, -e.turn * dt, e.turn * dt);
      e.fireCd -= dt;
      if (engage && Math.abs(diff) < CONFIG.enemy.aimCone && e.fireCd <= 0) {
        e.fireCd = S.escortFireCooldown;
        game.ebullets.push({x:e.x,y:e.y,vx:Math.cos(e.a)*CONFIG.enemy.bulletSpeed,vy:Math.sin(e.a)*CONFIG.enemy.bulletSpeed,life:CONFIG.enemy.bulletLife});
      }
      if (Math.hypot(asset.x - e.x, asset.y - e.y) <= S.attackRange) {
        if (!escorts && health(asset, base) > 0) {
          const damage = Math.min(health(asset, base), e.strikeRole === 'torpedo' ? S.torpedoDamage : S.baseDamage);
          if (base.kind === 'territory') asset.integrity = Math.max(0, asset.integrity - damage);
          else asset.hp = Math.max(0, asset.hp - damage);
          const territory = territoryFor(game, base);
          if (territory) { territory.attackHits = (territory.attackHits || 0) + 1; territory.lastAttackedAt = game.time; }
          game.raidImpacts = (game.raidImpacts || 0) + 1;
          game.raidDamage = (game.raidDamage || 0) + damage;
          explosion(asset.x, asset.y, true);
        }
        e.phase = 'retreat';
      }
    } else {
      e.retreatDistance = (e.retreatDistance || 0) + e.speed * dt;
      if (e.retreatDistance > S.retreatDistance) e.departed = true;
    }
    e.x += Math.cos(e.a) * e.speed * dt; e.y += Math.sin(e.a) * e.speed * dt;
  }
  game.enemies = game.enemies.filter(e => !e.departed);
}
