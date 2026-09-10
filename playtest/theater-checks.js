// Geography tests exercise generated coastlines, not former grid coordinates.
export async function theaterChecks(api) {
  const { game, startGame, setSeed, CONFIG } = api;
  const { onLand } = await import('../src/surface.js');
  const checks = [], check = (name, ok) => checks.push({ name, ok: !!ok });
  let terrainRich = true, runwaySafe = true, finite = true, waterways = true;
  const layouts = new Set();
  for (const seed of [1,927,1942,1945,8801,65535]) {
    setSeed(seed); startGame();
    const snapshot = () => JSON.stringify({terrain:game.terrain,territories:game.territories});
    const first = snapshot(); setSeed(seed); startGame();
    finite &&= snapshot() === first;
    layouts.add(first);
    terrainRich &&= game.terrain.length > game.territories.length * 2 && game.sectors.length >= 4 && game.sectors.length <= 7;
    for(const [a,b] of game.sectorLinks) waterways &&= Math.hypot(game.sectors[a].x-game.sectors[b].x,game.sectors[a].y-game.sectors[b].y)>9000;
    for (const t of game.terrain) finite &&= t.shoreline.every(p=>p.every(Number.isFinite));
    for (const field of game.airfields) {
      for (const along of [-CONFIG.airfield.length/2,0,CONFIG.airfield.length/2]) {
        for (const side of [-CONFIG.airfield.width/2,CONFIG.airfield.width/2]) {
          runwaySafe &&= onLand({x:field.x+Math.cos(field.a)*along-Math.sin(field.a)*side,
            y:field.y+Math.sin(field.a)*along+Math.cos(field.a)*side},game.terrain);
        }
      }
    }
    for (const region of game.sectors.filter(t=>t.identity==='drowned caldera')) {
      waterways &&= !onLand(region,game.terrain);
    }
  }
  check('six seeds reproduce finite shoreline geometry deterministically', finite && layouts.size === 6);
  check('archipelagos contain varied scenery beyond capturable holdings', terrainRich);
  check('every runway corner and midpoint rests on physical land', runwaySafe);
  check('regional passages have expedition scale and caldera interiors remain water', waterways);
  setSeed(1942); startGame();
  check('theater offers a home region, connected fronts and a distant stronghold', game.territories[0].sector===0 && game.sectors.some(r=>r.stronghold&&r.id!==0) && game.sectorLinks.length>=game.sectors.length-1);
  check('home archipelago includes a forward airfield before the first ocean crossing', game.territories.some(t=>t.id!==0&&t.sector===0&&t.role==='airfield'));
  check('first foothold does not demand anti-ship weapons', game.territories[1].role === 'radar' && !game.ships.some(s=>s.territory===game.territories[1].id));
  const { updateFleets } = await import('../src/fleets.js');
  let hullsClear = true, formation = true;
  for (const seed of [1,1942,65535]) {
    setSeed(seed); startGame(); game.ships[0].active = true;
    game.player.x = 20000; game.player.y = 20000;
    for (let i=0;i<1200;i++) {
      updateFleets(game,1);
      for (const ship of game.ships) {
        for (const along of [-ship.length/2,0,ship.length/2]) for(const side of [-ship.width/2,ship.width/2]) {
          hullsClear &&= !onLand({x:ship.x+Math.cos(ship.a)*along-Math.sin(ship.a)*side,
            y:ship.y+Math.sin(ship.a)*along+Math.cos(ship.a)*side},game.terrain);
        }
        const f=ship.fleet, dx=ship.x-f.x, dy=ship.y-f.y;
        formation &&= Math.abs(dx*Math.cos(f.a)+dy*Math.sin(f.a)-ship.formationAlong)<1e-6
          && Math.abs(-dx*Math.sin(f.a)+dy*Math.cos(f.a)-ship.formationLateral)<1e-6;
      }
    }
  }
  check('both task groups keep hulls offshore across full patrol circuits', hullsClear);
  check('destroyer escorts retain formation through route turns', formation);
  const enemy=game.ships.find(s=>s.team==='jp'&&s.kind==='carrier');
  const escorts=game.ships.filter(s=>s.team==='jp'&&s.kind==='destroyer');
  const before=escorts.map(s=>[s.x,s.y]); enemy.hp=0; updateFleets(game,10);
  check('sinking a carrier leaves surviving escorts underway', escorts.every((s,i)=>s.hp>0&&Math.hypot(s.x-before[i][0],s.y-before[i][1])>0));
  const friendly=game.ships[0];
  game.player.baseId='fleet-carrier'; game.player.flight='landed';
  const parked=[friendly.x,friendly.y]; updateFleets(game,10);
  check('friendly task group holds position during deck operations', friendly.x===parked[0]&&friendly.y===parked[1]);
  setSeed(1942); startGame();
  const {resetIntelligence,updateIntelligence,installationKnown,knownShips} = await import('../src/intelligence.js');
  resetIntelligence(game); updateIntelligence(game,0);
  const remote=game.territories.find(t=>t.stronghold);
  check('remote enemy installations and carrier locations begin unknown', !installationKnown(game,remote)&&!knownShips(game).some(s=>s.team==='jp'));
  const radar=game.territories.find(t=>t.role==='radar');
  const nearby=game.territories.find(t=>t.owner==='enemy'&&t.id!==radar.id&&(t.sector===radar.sector||Math.hypot(t.x-radar.x,t.y-radar.y)<CONFIG.intelligence.radarRadius));
  radar.owner='us'; radar.established=0; updateIntelligence(game,0);
  check('captured radar reveals nearby installations immediately', !!nearby&&installationKnown(game,nearby));
  const contact=game.ships.find(s=>s.team==='jp'&&s.kind==='carrier');
  game.player.x=contact.x; game.player.y=contact.y; updateIntelligence(game,0);
  const { mapProjection } = await import('../src/operations.js');
  const chartBefore=mapProjection(game,{x:0,y:0,w:390,h:600}).point(game.territories[0]);
  const seen=knownShips(game).find(s=>s.id===contact.id);
  game.player.x=20000;game.player.y=20000; contact.x+=10000; updateIntelligence(game,10);
  const stale=knownShips(game).find(s=>s.id===contact.id);
  const chartAfter=mapProjection(game,{x:0,y:0,w:390,h:600}).point(game.territories[0]);
  check('hidden fleet motion cannot leak through chart rescaling', chartBefore.every((v,i)=>v===chartAfter[i]));
  check('unobserved carrier contact retains last-known coordinates with uncertainty', !!seen&&stale.x===seen.x&&stale.y===seen.y&&stale.age>=10&&stale.uncertainty>0);
  updateIntelligence(game,CONFIG.intelligence.fleetContactSeconds+1);
  check('old mobile fleet contacts expire while discovered installations remain known', !knownShips(game).some(s=>s.id===contact.id)&&installationKnown(game,nearby));
  setSeed(1942); startGame();
  return checks;
}
