// Runs through the real simulation in-browser with deterministic setups.
export async function campaignChecks(api) {
  const { game, startGame, update, keys, CONFIG, requestCarrier } = api;
  const { defenders } = await import('../src/campaign.js');
  const { damageShip, hitsShip } = await import('../src/ships.js');
  const checks = [];
  const check = (name, ok) => checks.push({ name, ok: !!ok });
  const reset = () => { for (const key of Object.keys(keys)) keys[key] = false; startGame(); };
  const step = seconds => { for (let i = 0; i < Math.round(seconds / .02); i++) update(.02); };
  reset();
  check('campaign starts with four persistent objectives and six ships', game.territories.length === 4 && game.ships.length === 6);
  check('no waves or enemies spawn at the carrier', !('waveNum' in game) && game.enemies.length === 0);
  const t = game.territories[0];
  game.player.x = t.x; game.player.y = t.y;
  update(.02);
  check('entering hostile airspace activates its fighter patrol once', t.activated && game.enemies.length === t.fighters);
  const count = game.enemies.length;
  update(.02);
  check('active territories do not repeatedly respawn defenders', game.enemies.length === count);
  check('defenders prevent capture', t.progress === 0 && defenders(game, t) > 0);
  const ship = game.ships.find(s => s.territory === t.id);
  check('fast rounds intersect the oriented hull', hitsShip({ prevX: ship.x - Math.cos(ship.a) * 200,
    prevY: ship.y - Math.sin(ship.a) * 200, x: ship.x + Math.cos(ship.a) * 200, y: ship.y + Math.sin(ship.a) * 200 }, ship));
  const hullHp = ship.hp;
  game.bullets.push({ x: ship.x, y: ship.y, vx: 0, vy: 0, life: 1 });
  update(.02);
  check('player rounds damage ship hulls through the combat loop', ship.hp === hullHp - 1);
  const before = game.score;
  damageShip(ship, ship.hp);
  damageShip(ship, 5);
  check('destroyers sink and award points only once', ship.hp === 0 && game.score === before + CONFIG.ship.score);
  game.enemies.forEach(e => { if (e.territory === t.id) e.hp = 0; });
  // Hold a small real flight orbit inside the capture zone.
  game.player.x = t.x; game.player.y = t.y; game.player.a = 0;
  keys.KeyD = true;
  step(CONFIG.conquest.captureSeconds / 2);
  check('clear territory gains capture progress while flying inside it', t.progress > 1 && t.owner === 'enemy');
  game.player.x = t.x + CONFIG.conquest.captureRadius + 200;
  update(.02);
  check('leaving the zone resets an unfinished capture', t.progress === 0);
  game.player.x = t.x; game.player.y = t.y;
  step(CONFIG.conquest.captureSeconds + .2);
  check('holding cleared airspace captures territory and selects the next objective', t.owner === 'us' && game.target !== t.id);
  const capturedScore = game.score;
  step(1);
  check('captured territory stays captured without awarding points repeatedly', t.owner === 'us' && game.score === capturedScore);
  reset();
  game.player.hp = 35; step(.5);
  check('flying no longer repairs health automatically', game.player.hp === 35);
  game.player.x = 4000; requestCarrier();
  check('distant carrier action sets navigation without teleporting', game.target === 'carrier' && game.player.flight === 'flying' && game.player.x === 4000);
  const c = game.ships[0];
  game.player.x = c.x; game.player.y = c.y + CONFIG.carrier.approachDistance + 65;
  game.player.a = c.a; game.player.speed = CONFIG.carrier.approachSpeed;
  requestCarrier();
  check('carrier request starts a guided approach', game.player.flight === 'approach');
  requestCarrier();
  check('approach can be cancelled', game.player.flight === 'flying');
  requestCarrier(); keys.Space = true;
  for (let i = 0; i < 1000 && game.player.flight !== 'landed'; i++) update(.02);
  check('assisted approach lands on the physical carrier deck', game.player.flight === 'landed'
    && Math.abs(game.player.x - c.x) < 1 && game.player.altitude === CONFIG.carrier.deckHeight);
  check('approach and landing inhibit firing', game.bullets.length === 0);
  step(1);
  check('deck repairs restore health over time', game.player.hp > 35 && game.player.hp < CONFIG.player.hp);
  step(10);
  check('repairs cap at full health and cool guns', game.player.hp === CONFIG.player.hp && game.player.heat === 0);
  keys.Space = false; requestCarrier();
  check('takeoff begins from the deck', game.player.flight === 'takeoff');
  step(CONFIG.carrier.takeoffSeconds + .1);
  check('takeoff restores normal flight at cruising altitude', game.player.flight === 'flying'
    && game.player.altitude === CONFIG.render.flightHeight && game.player.y < c.y - c.length / 2);
  reset();
  for (let i = 0; i < game.territories.length; i++) {
    const island = game.territories[i];
    game.player.x = island.x; game.player.y = island.y; game.player.a = 0;
    update(.02);
    game.enemies.forEach(e => { e.hp = 0; });
    game.ships.filter(s => s.territory === island.id).forEach(s => damageShip(s, s.hp));
    keys.KeyD = true;
    step(CONFIG.conquest.captureSeconds + .2);
  }
  check('conquering all islands ends the campaign in victory', game.mode === 'victory' && game.territories.every(t => t.owner === 'us'));
  reset();
  check('new campaign resets territory ownership, fleet and flight state', game.mode === 'play'
    && game.territories.every(t => t.owner === 'enemy' && !t.activated) && game.player.flight === 'flying'
    && game.ships.every(s => s.hp === s.maxHp));
  return checks;
}
