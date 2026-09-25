// Fun audit: does the game stay fun? Run after every change.
//
// Seven procedural personas play whole seeded campaigns headless (see
// lib/pilot.cjs): three skill levels following the marker (rookie,
// average, ace), three restricted strategies (brawler hunts everything,
// rusher skips fights, pacifist never fires) and a passive player who
// defends home and never advances. lib/fun-metrics.cjs turns their
// telemetry into answers to design questions: too hard or too easy, dead
// air, repetition, dominant strategies, variety, map spread. Each answer
// is ok, warn or killer, with design advice for anything that is not ok.
//
// Pass/fail is a ratchet against playtest/fun-baseline.json:
//   - a smoke invariant fails (softlock, unwinnable, no objective), or
//   - a finding that was not a killer becomes one, or
//   - a known killer gets clearly worse (further outside its band).
// Known problems are recorded, not hidden: the report lists them every run.
//
// Usage: node --experimental-vm-modules playtest/fun-audit.cjs [--update-baseline]
//   SEEDS=1,2,3  PERSONAS=average,ace  MINUTES=45  WORKERS=4
// Reports: playtest/shots/fun-report.md and fun-audit.json.
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const { fork } = require('node:child_process');

if (process.env.FUN_WORKER) return worker();

const SEEDS = process.env.SEEDS ? process.env.SEEDS.split(',').map(Number) : [1942, 7, 23, 58, 91, 144];
const { PERSONAS } = require('./lib/pilot.cjs');
const PERSONA_LIST = process.env.PERSONAS ? process.env.PERSONAS.split(',') : Object.keys(PERSONAS);
const MINUTES = Number(process.env.MINUTES || 45);
const NEGLECT_MINUTES = 25;   // the passive player only needs to show whether the war comes to it
const WORKERS = Number(process.env.WORKERS || Math.min(4, os.cpus().length));
const BASELINE = path.join(__dirname, 'fun-baseline.json');
const WORSE = .25;            // a known killer may drift this many band widths before it fails

async function worker() {
  const { loadGame } = require('./lib/headless.cjs'), { runCampaign, loadModules } = require('./lib/pilot.cjs'), { runMetrics } = require('./lib/fun-metrics.cjs');
  const env = await loadGame(); env.modules = await loadModules(env);
  // FUN_CONFIG deep-merges tuning overrides into CONFIG: used by fun-sensitivity.cjs to break the game on purpose.
  const merge = (target, patch) => { for (const [k, v] of Object.entries(patch)) if (v && typeof v === 'object' && !Array.isArray(v)) merge(target[k] ??= {}, v); else target[k] = v; };
  if (process.env.FUN_CONFIG) merge(env.api.CONFIG, JSON.parse(process.env.FUN_CONFIG));
  process.on('message', job => {
    if (!job) return process.exit(0);
    const t0 = Date.now();
    const run = runCampaign(env, job);
    process.send({ job, metrics: runMetrics(run), run: { ...run, timeline: undefined }, wall: (Date.now() - t0) / 1000 });
  });
  process.send({ ready: true });
}

(async () => {
  const { summarize, evaluate, distance } = require('./lib/fun-metrics.cjs');
  const started = Date.now();
  // Slow personas first so the pool finishes together.
  const cost = { pacifist: 4, rookie: 3, brawler: 2, rusher: 2, average: 1.5, ace: 1, passive: .5 };
  const jobs = PERSONA_LIST.flatMap(persona => SEEDS.map(seed => ({ seed, persona, minutes: persona === 'passive' ? Math.min(MINUTES, NEGLECT_MINUTES) : MINUTES })))
    .sort((a, b) => (cost[b.persona] || 1) - (cost[a.persona] || 1));
  const results = [];
  await new Promise((resolve, reject) => {
    let running = 0;
    const next = child => { const job = jobs.shift(); if (job) { running++; child.send(job); } else child.send(null); };
    for (let i = 0; i < Math.min(WORKERS, jobs.length); i++) {
      const child = fork(__filename, [], { env: { ...process.env, FUN_WORKER: '1' }, execArgv: ['--experimental-vm-modules', '--no-warnings'] });
      child.on('message', m => {
        if (m.ready) return next(child);
        running--; results.push(m);
        process.stdout.write(`  ${m.job.persona.padEnd(8)} seed ${String(m.job.seed).padEnd(5)} ${m.run.mode.padEnd(8)} ${m.run.minutes.toFixed(1).padStart(5)} min  (${m.wall.toFixed(0)}s)\n`);
        next(child);
      });
      child.on('exit', code => { if (code) reject(new Error(`worker exited ${code}`)); else if (!running && !jobs.length && results.length === PERSONA_LIST.length * SEEDS.length) resolve(); });
      child.on('error', reject);
    }
  });

  const rows = results.map(r => r.metrics);
  const summary = summarize(rows);
  const findings = evaluate(summary, rows);
  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null;
  const full = !process.env.SEEDS && !process.env.PERSONAS && !process.env.MINUTES && !process.env.FUN_CONFIG;
  for (const f of findings) {
    const before = baseline?.findings?.[f.id];
    f.baseline = before ?? null;
    if (f.smoke) f.verdict = f.status === 'ok' ? 'pass' : 'FAIL';
    else if (!before || !full) f.verdict = f.status === 'killer' ? 'KILLER' : f.status;
    else if (f.status === 'killer' && before.status !== 'killer') f.verdict = 'FAIL';
    else if (f.status === 'killer' && distance(f) > before.distance + WORSE) f.verdict = 'FAIL';
    else f.verdict = f.status === 'killer' ? 'known killer' : f.status;
    f.distance = +distance(f).toFixed(3);
  }
  const failed = findings.filter(f => f.verdict === 'FAIL');

  // Console: grouped by category.
  const fmt = v => v == null ? '—' : !Number.isFinite(v) ? 'never' : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2);
  console.log('\nPersona medians');
  const cols = ['winRate', 'victoryMinutes', 'deathsPer10', 'capturesPer10', 'travelShare', 'fightShare', 'lullShare', 'closeCallsPer10', 'peaksPer10', 'predictability'];
  console.log('  ' + 'persona'.padEnd(9) + cols.map(c => c.slice(0, 11).padStart(12)).join(''));
  for (const p of PERSONA_LIST) if (summary[p]) console.log('  ' + p.padEnd(9) + cols.map(c => fmt(summary[p][c]).padStart(12)).join(''));
  let category = '';
  for (const f of findings) {
    if (f.category !== category) { category = f.category; console.log(`\n${category.toUpperCase()}`); }
    const was = f.baseline && Number.isFinite(f.baseline.value) ? ` (was ${fmt(f.baseline.value)})` : '';
    console.log(`  ${f.verdict.padEnd(12)} ${f.id.padEnd(16)} ${fmt(f.value).padStart(6)}${was}   healthy ${f.band.join('..')}  — ${f.question}`);
    if (f.advice && f.status !== 'ok') console.log(`${' '.repeat(16)}→ ${f.advice}`);
  }

  const out = process.env.FUN_OUT || path.join(__dirname, 'shots'); fs.mkdirSync(out, { recursive: true });
  // Infinity means "never" (never won, never lost a holding); JSON would turn it into null.
  const never = (key, v) => v === Infinity ? 'never' : v;
  fs.writeFileSync(path.join(out, 'fun-audit.json'), JSON.stringify({ seeds: SEEDS, personas: PERSONA_LIST, minutes: MINUTES, summary, findings, rows,
    runs: results.map(r => r.run) }, never, 2));
  fs.writeFileSync(path.join(out, 'fun-report.md'), report(summary, findings));
  if (process.argv.includes('--update-baseline')) {
    if (!full) throw new Error('Baseline updates need the full matrix (unset SEEDS, PERSONAS, MINUTES).');
    // One line per finding so a baseline change reads as a diff in review.
    const entry = f => JSON.stringify({ value: f.value != null && Number.isFinite(f.value) ? +f.value.toFixed(3) : f.value === Infinity ? 'never' : null, status: f.status, distance: f.distance });
    fs.writeFileSync(BASELINE, `{\n  "note": "Fun-audit ratchet. Regenerate with npm run test:fun:baseline only with a reason in the commit.",\n  "findings": {\n${findings.map(f => `    ${JSON.stringify(f.id)}: ${entry(f)}`).join(',\n')}\n  }\n}\n`);
    console.log(`\nBaseline written: ${path.relative(process.cwd(), BASELINE)}`);
  }
  const counts = s => findings.filter(f => f.status === s).length;
  console.log(`\n${counts('ok')} ok, ${counts('warn')} warn, ${counts('killer')} fun-killers; ${failed.length ? 'FAILED: ' + failed.map(f => f.id).join(', ') : 'no regressions'}  (${((Date.now() - started) / 1000).toFixed(0)}s)`);
  process.exitCode = failed.length ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });

function report(summary, findings) {
  const fmt = v => v == null ? '—' : !Number.isFinite(v) ? 'never' : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2);
  const lines = ['# Fun audit', '', `Seeds ${SEEDS.join(', ')} · ${MINUTES} min cap · personas: ${PERSONA_LIST.join(', ')}`, ''];
  const rank = { FAIL: 0, KILLER: 1, 'known killer': 1, warn: 2, ok: 3, pass: 3, 'n/a': 4 };
  lines.push('## Needs design attention', '');
  for (const f of [...findings].filter(f => f.status !== 'ok').sort((a, b) => rank[a.verdict] - rank[b.verdict]))
    lines.push(`- **${f.id}** (${f.category}, ${f.verdict}): ${f.question} **${fmt(f.value)}**, healthy ${f.band.join('–')}. ${f.advice || ''}`);
  lines.push('', '## All findings', '', '| verdict | finding | value | healthy | killer outside | question |', '|---|---|---|---|---|---|');
  for (const f of findings) lines.push(`| ${f.verdict} | ${f.id} | ${fmt(f.value)} | ${f.band.join('–')} | ${f.killer.join('–')} | ${f.question} |`);
  const cols = Object.keys(summary.average || Object.values(summary)[0]).filter(k => !['minutes', 'runs'].includes(k));
  lines.push('', '## Persona medians', '', '| persona | ' + cols.join(' | ') + ' |', '|' + '---|'.repeat(cols.length + 1));
  for (const [p, s] of Object.entries(summary)) lines.push(`| ${p} | ` + cols.map(c => fmt(s[c])).join(' | ') + ' |');
  lines.push('', '## Personas', '');
  for (const [p, def] of Object.entries(PERSONAS)) lines.push(`- **${p}** (${def.role}): ${def.about}`);
  return lines.join('\n') + '\n';
}
