// Does the fun audit notice when the game gets worse? Each mutation breaks
// one thing through CONFIG overrides and the audit must move the findings
// that describe it, in the expected direction, against an unmutated run on
// the same seeds and personas. A metric that never moves is not measuring.
//
// Usage: node playtest/fun-sensitivity.cjs   (~5 min on 4 cores)
const { execFileSync } = require('node:child_process'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');

// Seeds where the war swings both ways in the control run, so every metric has room to move.
const SEEDS = '1942,23,91', PERSONAS = 'rookie,average,ace,passive';
const MUTATIONS = [
  { name: 'deadly enemies', about: 'enemy rounds do four times the damage',
    config: { enemy: { bulletDamage: 48 } }, expect: { averageDeaths: 'up', aceDanger: 'up', rookieWins: 'not up' } },
  { name: 'harmless enemies', about: 'enemy rounds do no damage',
    config: { enemy: { bulletDamage: 0 }, ship: { bulletDamage: 0 } }, expect: { aceDanger: 'down', averageDeaths: 'not up' } },
  { name: 'empty skies', about: 'no roaming Zeros and no convoys',
    config: { airWar: { raidFirst: 1e9, raidMin: 1e9, raidMax: 1e9 }, convoy: { firstDelay: 1e9 } }, expect: { longestLull: 'up', lulls: 'up', encounters: 'down' } },
  { name: 'no counter-attacks', about: 'enemy airfields and carriers never launch strikes',
    config: { strike: { firstMin: 1e9, firstMax: 1e9, intervalMin: 1e9, intervalMax: 1e9 } }, expect: { drama: 'down', pressure: 'up' } },
  { name: 'slow aircraft', about: 'every aircraft flies at 60% speed',
    config: { player: { speedCruise: 165, speedBoost: 222, speedBrake: 99 }, aircraft: {
      p38: { speedCruise: 165, speedBoost: 222, speedBrake: 99 }, dauntless: { speedCruise: 126, speedBoost: 168, speedBrake: 78 },
      avenger: { speedCruise: 129, speedBoost: 165, speedBrake: 81 }, p51: { speedCruise: 189, speedBoost: 258, speedBrake: 108 } } },
    expect: { travel: 'up', winnable: 'not up' } },
];

function audit(name, config) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fun-'));
  try {
    execFileSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', path.join(__dirname, 'fun-audit.cjs')],
      { env: { ...process.env, SEEDS, PERSONAS, FUN_OUT: out, ...(config ? { FUN_CONFIG: JSON.stringify(config) } : {}) }, stdio: 'ignore' });
  } catch { /* the audit exits nonzero when it finds killers; that is the point here */ }
  const result = JSON.parse(fs.readFileSync(path.join(out, 'fun-audit.json'), 'utf8'));
  fs.rmSync(out, { recursive: true, force: true });
  console.log(`  ran ${name}`);
  return Object.fromEntries(result.findings.map(f => [f.id, f.value]));
}

const control = audit('control');
let failed = 0;
for (const m of MUTATIONS) {
  const mutated = audit(m.name, m.config);
  console.log(`\n${m.name}: ${m.about}`);
  for (const [id, want] of Object.entries(m.expect)) {
    const a = control[id], b = mutated[id];
    const num = v => v == null ? NaN : v === 'never' ? Infinity : v;
    const [x, y] = [num(a), num(b)];
    const moved = y > x ? 'up' : y < x ? 'down' : 'same';
    const ok = want === 'up' ? moved === 'up' : want === 'down' ? moved === 'down' : want === 'not up' ? moved !== 'up' : moved === want;
    if (!ok) failed++;
    const show = v => String(v?.toFixed?.(2) ?? v).padStart(8);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(16)} ${show(a)} → ${show(b)}   expected ${want}`);
  }
}
process.exitCode = failed ? 1 : 0;
