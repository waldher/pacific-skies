// Observed campaign outcomes, independent of renderer and bot strategy.
export function resetSessionReport(game) {
  game.sessionReport = { elapsed: 0, captured: 0, lost: 0, carrierLosses: 0, unlocks: [],
    owners: Object.fromEntries(game.territories.map(t => [t.id, t.owner])),
    carriers: {}, aircraft: [...(game.unlockedAircraft || ['p38'])] };
}
export function recordSession(game) {
  if (!game.sessionReport) resetSessionReport(game);
  const report = game.sessionReport;
  report.elapsed = game.time;
  for (const t of game.territories) {
    if (report.owners[t.id] !== t.owner) {
      if (t.owner === 'us') report.captured++;
      else if (report.owners[t.id] === 'us') report.lost++;
      report.owners[t.id] = t.owner;
    }
  }
  for (const ship of game.ships.filter(s => s.team === 'us' && s.kind === 'carrier')) {
    if (report.carriers[ship.id] > 0 && ship.hp <= 0) report.carrierLosses++;
    report.carriers[ship.id] = ship.hp;
  }
  for (const id of game.unlockedAircraft || []) if (!report.aircraft.includes(id)) {
    report.aircraft.push(id); report.unlocks.push({ aircraft: id, time: game.time });
  }
}
export function sessionSummary(game) {
  const report = game.sessionReport;
  return report ? { elapsed: report.elapsed, captured: report.captured, lost: report.lost,
    carrierLosses: report.carrierLosses, unlocks: report.unlocks.map(u => ({ ...u })),
    raids: { impacts: game.raidImpacts || 0, damage: game.raidDamage || 0, intercepted: game.raidIntercepts || 0 } } : null;
}
