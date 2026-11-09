#!/usr/bin/env node
// Scorecard: turns audio-render.cjs reports into pass / warn / fail checks under
// the owner's four listening categories, plus coverage.
//
// Every check is a measurement standing in for a listening judgement. A pass
// means "this property that a good sound should have is present", never "this
// sounds good". Thresholds and the reason for each are in CHECKS below; the
// reasons come from the source material and the hardware, not from tuning them
// until one source passed. Where a source has no cue at all the check fails:
// a silent event cannot be characterful, distinct or in sync.
//
//   node playtest/climb/audio-score.cjs [dir] [sources]
const fs = require('node:fs'), path = require('node:path');

const cueOf = (r, n) => r.cues[n] && !r.cues[n].silent ? r.cues[n] : null;
const band = (v, pass, warn) => v == null ? 'fail' : pass(v) ? 'pass' : warn && warn(v) ? 'warn' : 'fail';
const pair = (r, k) => r.distinct.keyPairs[k];
const DISTINCT = v => band(v, x => x >= .3, x => x >= .2);
const OVER = v => band(v, x => x >= 6, x => x >= 3);

// [category, id, what is measured and why the threshold, value(report), verdict(value, report)]
const CHECKS = [
  // --- character and fit --------------------------------------------------------
  ['character', 'guns are noise and impact, not a tone',
    'Spectral flatness (100 Hz–8 kHz) of a held burst. A pitched bleep concentrates energy in a few partials (flatness → 0); gunfire is broadband. ≥ .05 pass, ≥ .02 warn.',
    r => r.burst.flatness ?? null, v => band(v, x => x >= .05, x => x >= .02)],
  ['character', 'guns have body',
    'Share of a held burst\'s energy below 250 Hz. A .50-cal muzzle blast is mostly low-frequency pressure; without it guns read as clicks. ≥ 15 % pass, ≥ 8 % warn.',
    r => r.burst.bands ? r.burst.bands.sub + r.burst.bands.low : null, v => band(v, x => x >= .15, x => x >= .08)],
  ['character', 'guns have crack and clatter',
    'Share of a held burst above 2 kHz (supersonic crack, bolt). ≥ 3 % pass, ≥ 1 % warn; and it is what survives a tablet speaker.',
    r => r.burst.bands ? r.burst.bands.high + r.burst.bands.air : null, v => band(v, x => x >= .03, x => x >= .01)],
  ['character', 'a burst is a battery, not one gun',
    'Onsets per second inside a held burst (5 ms frames jumping 6 dB). The game fires 7.7 pulls/s; one M2 fires ~13 rounds/s; six unsynchronised guns far more. ≥ 20/s pass, ≥ 12/s warn.',
    r => r.burst.onsetsPerSecond ?? null, v => band(v, x => x >= 20, x => x >= 12)],
  ['character', 'a burst is continuous while the trigger is held',
    'Fraction of 5 ms frames within 12 dB of the burst\'s median level. Gaps between pulls read as separate blips. ≥ .9 pass, ≥ .7 warn.',
    r => r.burst.fill ?? null, v => band(v, x => x >= .9, x => x >= .7)],
  ['character', 'gunfire has a tail on release',
    'Time from the last trigger pull until the level is 40 dB under the burst. Reports roll away over open water; a hard stop sounds synthetic. 250–1500 ms pass, ≥ 120 ms warn.',
    r => r.burst.releaseTailMs ?? null, v => band(v, x => x >= 250 && x <= 1500, x => x >= 120)],
  ['character', 'the aircraft has an engine',
    'Level of the bed at cruise with no cues playing. An aircraft game with a silent aircraft fails outright. > −50 dBFS pass.',
    r => r.engine && !r.masking.bed.silent ? r.engine.cruiseRmsDb : null, v => band(v, x => x > -50)],
  ['character', 'engine pitch follows throttle',
    'Spectral centroid (60–1500 Hz) of the bed: idle < brake-turn < cruise < boost, each step ≥ 3 %.',
    r => r.engine && !r.masking.bed.silent ? [r.engine.centroidIdle, r.engine.centroidBrakeTurn, r.engine.centroidCruise, r.engine.centroidBoost] : null,
    v => band(v, x => x[0] * 1.03 < x[1] && x[1] * 1.03 < x[2] && x[2] * 1.03 < x[3], x => x[0] < x[2] && x[2] < x[3])],
  ['character', 'engine level follows power',
    'Bed RMS: idle at least 6 dB under cruise, boost above cruise.',
    r => r.engine && !r.masking.bed.silent ? [r.engine.idleRmsDb, r.engine.cruiseRmsDb, r.engine.boostRmsDb] : null,
    v => band(v, x => x[0] <= x[1] - 6 && x[2] > x[1], x => x[0] < x[1] && x[2] >= x[1])],
  ['character', 'a turn loads the airframe',
    'Bed level in the brake turn relative to straight flight at the same throttle would need a separate render; proxy: the brake-turn bed is no more than 6 dB under cruise although the engine is throttled back.',
    r => r.engine && !r.masking.bed.silent ? r.engine.turnRmsDb - r.engine.cruiseRmsDb : null, v => band(v, x => x >= -6, x => x >= -10)],
  ['character', 'an aircraft passing close is heard',
    'Loudest 100 ms of the bed while an enemy crosses 60 units ahead, over the steady cruise bed. ≥ 3 dB pass, ≥ 1.5 dB warn.',
    r => r.engine && !r.masking.bed.silent ? r.engine.flybyOverCruiseDb : null, v => band(v, x => x >= 3, x => x >= 1.5)],
  ['character', 'a wingman in formation does not drone',
    'Bed level with a wingman holding station 93 units away, over the bed alone. Wingmen sit there for whole sorties. ≤ 1.5 dB pass, ≤ 3 dB warn.',
    r => r.engine && !r.masking.bed.silent ? r.engine.formationOverCruiseDb : null, v => band(v, x => x <= 1.5, x => x <= 3)],
  ['character', 'a damaged aircraft sounds damaged',
    'Spread (standard deviation, dB) of 20 ms bed levels at 10 % hull, over the same at full hull: misfires and rattle make the bed uneven. ≥ 1.5× pass, ≥ 1.15× warn.',
    r => r.engine && !r.masking.bed.silent ? r.engine.unevenHurtDb / r.engine.unevenCruiseDb : null, v => band(v, x => x >= 1.5, x => x >= 1.15)],
  ['character', 'a big explosion has a sub thump and a long tail',
    'Bomb on land: share below 250 Hz ≥ 50 % and decay ≥ 800 ms (pass); ≥ 35 % and ≥ 400 ms (warn).',
    r => cueOf(r, 'bombLand') ? [cueOf(r, 'bombLand').bands.sub + cueOf(r, 'bombLand').bands.low, cueOf(r, 'bombLand').decayMs] : null,
    v => band(v, x => x[0] >= .5 && x[1] >= 800, x => x[0] >= .35 && x[1] >= 400)],
  ['character', 'small and big explosions differ in scale',
    'Bomb decay ÷ aircraft-kill decay ≥ 1.5 and the bomb\'s centroid lower.',
    r => cueOf(r, 'bombLand') && cueOf(r, 'kill') ? [cueOf(r, 'bombLand').decayMs / cueOf(r, 'kill').decayMs, cueOf(r, 'kill').centroid / cueOf(r, 'bombLand').centroid] : null,
    v => band(v, x => x[0] >= 1.5 && x[1] > 1, x => x[0] >= 1.2)],
  ['character', 'a hit on the enemy is a short bright tick',
    'Centroid ≥ 2 kHz (metal skin, and clear of the engine) and length ≤ 130 ms, the game\'s fire interval, so consecutive hits can be counted.',
    r => cueOf(r, 'hit') ? [cueOf(r, 'hit').centroid, cueOf(r, 'hit').durationMs] : null, v => band(v, x => x[0] >= 2000 && x[1] <= 130, x => x[0] >= 1500 && x[1] <= 200)],
  ['character', 'taking a hit is low and heavy',
    'Centroid ≤ 900 Hz and length ≥ 150 ms: it should be felt in the airframe, the opposite of the tick.',
    r => cueOf(r, 'playerHit') ? [cueOf(r, 'playerHit').centroid, cueOf(r, 'playerHit').durationMs] : null, v => band(v, x => x[0] <= 900 && x[1] >= 150, x => x[0] <= 1400)],
  // --- cue distinction ----------------------------------------------------------
  ...[['hit/playerHit', 'dealing a hit vs taking one'], ['hit/enemyGun', 'dealing a hit vs enemy firing'], ['playerHit/enemyGun', 'taking a hit vs enemy firing'],
    ['gun/enemyGun', 'own guns vs enemy guns'], ['gun/hit', 'own guns vs own hits'], ['gun/playerHit', 'own guns vs taking a hit'],
    ['kill/playerHit', 'enemy destroyed vs taking a hit'], ['kill/bombLand', 'aircraft destroyed vs bomb'], ['bombLand/bombWater', 'bomb on land vs in the sea'],
    ['nearMiss/hit', 'near miss vs own hit'], ['capture/raid', 'capture vs raid warning']].map(([k, text]) =>
    ['distinction', text, `Fingerprint distance ${k}: 0.4 × mean |ΔdB| over 24 log bands (÷25 dB) + 0.2 × centroid octaves (÷3) + 0.25 × mean |ΔdB| over 9 doubling time bins (÷20 dB) + 0.15 × length octaves (÷4). ≥ .30 pass, ≥ .20 warn. A missing cue fails.`,
      r => pair(r, k), DISTINCT]),
  ['distinction', 'no two cues are near-identical',
    'Smallest distance over every pair of voiced one-shots. ≥ .08 pass, ≥ .04 warn. Needs at least 10 voiced pairs to mean anything.',
    r => r.distinct.voicedPairs >= 10 ? r.distinct.minimum : null, v => band(v, x => x >= .08, x => x >= .04)],
  // --- mix and fatigue ----------------------------------------------------------
  ['mix', 'nothing clips', 'Samples at or above 0.999 full scale in the 45 s sequence: 0.', r => r.mix.clippedSamples, v => band(v, x => x === 0)],
  ['mix', 'headroom', 'Sample peak ≤ −0.2 dBFS (inter-sample peaks and lossy Bluetooth codecs need a little room). ≤ −0.2 pass, ≤ 0 warn.', r => r.mix.samplePeakDb, v => band(v, x => x <= -.2, x => x <= 0)],
  ['mix', 'programme loudness', 'EBU R128 integrated loudness of the sequence. Handheld games sit around −23 to −14 LUFS; quieter gets lost on a tablet speaker, louder is tiring. Pass in range, warn within 4 LU.',
    r => r.mix.integratedLufs, v => band(v, x => x >= -23 && x <= -14, x => x >= -27 && x <= -10)],
  ['mix', 'dynamics', 'Loudness range. Under 3 LU everything is the same level (wall of sound, or one cue type); over 18 LU quiet parts vanish on small speakers. 4–18 pass, 3–22 warn.',
    r => r.mix.loudnessRangeLu, v => band(v, x => x >= 4 && x <= 18, x => x >= 3 && x <= 22)],
  ['mix', 'quiet stretch is a bed, not silence, and well under combat',
    'Navigation section loudness: above −45 LUFS, and 5–14 LU under the sustained-fire section (less and combat has no lift; more and the player rides the volume control).',
    r => r.sections.navigation.lufs != null && r.sections['sustained-fire'].lufs != null ? [r.sections.navigation.lufs, r.sections['sustained-fire'].lufs - r.sections.navigation.lufs] : null,
    v => band(v, x => x[0] > -45 && x[1] >= 5 && x[1] <= 14, x => x[0] > -55 && x[1] >= 2 && x[1] <= 20)],
  ['mix', 'consecutive gunshots are not copies',
    'Peak normalised cross-correlation between consecutive single trigger pulls (8 pulls). Identical buffers score 1. < .5 pass, < .8 warn.',
    r => r.repetition.waveformCorrMax ?? null, v => band(v, x => x < .5, x => x < .8)],
  ['mix', 'consecutive gunshots do not look identical either',
    'Mean correlation of consecutive pulls as band-energy × time pictures. Fresh noise through an identical recipe decorrelates the waveform but not the picture. < .93 pass, < .97 warn.',
    r => r.repetition.pictureCorrMean ?? null, v => band(v, x => x < .93, x => x < .97)],
  ['mix', 'guns read over the engine at full throttle', 'Masking margin of the burst over the un-ducked boost bed in the burst\'s own strongest bands. ≥ 6 dB pass, ≥ 3 dB warn. No bed: not applicable, scored as fail of the bed itself above.',
    r => r.masking.gunBurst?.overBoostDb ?? (r.masking.bed?.silent ? 'no bed' : null), v => v === 'no bed' ? 'n/a' : OVER(v)],
  ...[['hit', 'own hits'], ['playerHit', 'damage taken'], ['enemyGun', 'enemy fire'], ['nearMiss', 'near misses'], ['objective', 'the objective bell']].map(([n, text]) =>
    ['mix', `${text} read over the engine at full throttle`, `Masking margin of ${n} over the un-ducked boost bed in its own strongest bands. ≥ 6 dB pass, ≥ 3 dB warn.`,
      r => r.masking[n]?.overBoostDb ?? (r.masking.bed?.silent ? (cueOf(r, n) ? 'no bed' : null) : null), v => v === 'no bed' ? 'n/a' : OVER(v)]),
  ...[['hit', 'own hits'], ['playerHit', 'damage taken']].map(([n, text]) =>
    ['mix', `${text} read through the player's own gunfire`, `Level of ${n} over a held burst, in the cue's own strongest bands. Hits land while the trigger is down. ≥ 6 dB pass, ≥ 3 dB warn.`,
      r => r.masking[n]?.overGunsDb ?? (r.masking.bed?.silent ? (cueOf(r, n) ? 'no bed' : null) : null), v => v === 'no bed' ? 'n/a' : OVER(v)]),
  ['mix', 'sustained fire is not harsh', 'Share of a held burst in 2–8 kHz, where the ear is most sensitive and fatigue builds. ≤ 35 % pass, ≤ 50 % warn.',
    r => r.burst.bands ? r.burst.bands.high : null, v => band(v, x => x <= .35, x => x <= .5)],
  ['mix', 'the engine bed is not harsh', 'Share of the cruise bed in 2–8 kHz. It plays for the whole sortie. ≤ 10 % pass, ≤ 20 % warn.',
    r => cueOf(r, 'engineCruise') ? cueOf(r, 'engineCruise').bands.high : null, v => band(v, x => x <= .1, x => x <= .2)],
  ['mix', 'cues survive a small speaker', 'Smallest share of energy above 300 Hz among gun burst, damage taken, kill, bomb and cruise engine. A cheap tablet reproduces almost nothing below that. ≥ 15 % pass, ≥ 6 % warn.',
    r => { const v = [r.burst.above300, cueOf(r, 'playerHit')?.above300, cueOf(r, 'kill')?.above300, cueOf(r, 'bombLand')?.above300, cueOf(r, 'engineCruise')?.above300]; return v.some(x => x == null) ? null : Math.min(...v); },
    v => band(v, x => x >= .15, x => x >= .06)],
  // --- synchronisation ----------------------------------------------------------
  ...[['gun', 'own guns'], ['hit', 'own hits'], ['playerHit', 'damage taken'], ['enemyGun', 'enemy fire'], ['kill', 'kills'], ['bombLand', 'bomb impact'], ['ui', 'button presses']].map(([n, text]) =>
    ['sync', `${text} sound when they happen`, `Delay from the call to the first sample within 20 dB of the cue's peak, through the whole bus. A 60 Hz frame is 16.7 ms; ≤ 12 ms pass, ≤ 25 ms warn.`,
      r => r.sync[n]?.onsetMs ?? null, v => band(v, x => x <= 12, x => x <= 25)]),
  ['sync', 'feedback cues peak fast', 'Longest rise (onset to 70 % of peak) among own guns, own hits and damage taken. ≤ 15 ms pass, ≤ 40 ms warn.',
    r => ['gun', 'hit', 'playerHit'].every(n => r.sync[n]) ? Math.max(...['gun', 'hit', 'playerHit'].map(n => r.sync[n].attackMs)) : null, v => band(v, x => x <= 15, x => x <= 40)],
  ['sync', 'engine answers the throttle with the aircraft',
    'Time for the bed centroid to cover 90 % of its change after full throttle. Airspeed in player.js covers 90 % in 0.59 s; the engine should lead or match it. 0.1–0.9 s pass, ≤ 1.5 s warn.',
    r => r.engine && !r.masking.bed.silent ? r.engine.boostResponseS : null, v => band(v, x => x >= .1 && x <= .9, x => x <= 1.5)],
  ['sync', 'landing cuts the engine', 'Bed level two seconds after touchdown vs cruise: at least 6 dB down.',
    r => r.engine && !r.masking.bed.silent ? r.engine.landedAfterRmsDb - r.engine.cruiseRmsDb : null, v => band(v, x => x <= -6, x => x <= -3)],
  // --- coverage -----------------------------------------------------------------
  ['coverage', 'game events that have a sound', 'Voiced ÷ scripted events on the cue sheet (29 one-shots, 5 engine states, 2 other-aircraft states). ≥ 90 % pass, ≥ 50 % warn.',
    r => r.coverage.voiced / r.coverage.events, v => band(v, x => x >= .9, x => x >= .5)],
];
const CATEGORIES = { character: 'Character and fit', distinction: 'Cue distinction', mix: 'Mix and fatigue', sync: 'Synchronisation', coverage: 'Coverage' };

function score(report) {
  const rows = CHECKS.map(([category, id, why, value, verdict]) => {
    let v = null; try { v = value(report); } catch (e) { v = null; }
    return { category, id, why, value: v, verdict: verdict(v, report) };
  });
  const totals = {};
  for (const c of Object.keys(CATEGORIES)) { const mine = rows.filter(r => r.category === c); totals[c] = { pass: mine.filter(r => r.verdict === 'pass').length, warn: mine.filter(r => r.verdict === 'warn').length, fail: mine.filter(r => r.verdict === 'fail').length, na: mine.filter(r => r.verdict === 'n/a').length }; }
  return { rows, totals };
}
const show = v => v == null ? '—' : Array.isArray(v) ? v.map(x => Math.round(x * 100) / 100).join(' / ') : typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : v;

function run(dir, sources) {
  const reports = {}, scores = {};
  for (const s of sources) { const f = path.join(dir, `${s}.report.json`); if (fs.existsSync(f)) { reports[s] = JSON.parse(fs.readFileSync(f, 'utf8')); scores[s] = score(reports[s]); } }
  const names = Object.keys(reports), lines = [];
  lines.push('# Audio scorecard', '', 'Measured, not heard. `pass` means a property a good sound should have is present.', '');
  lines.push(`| Category | ${names.map(n => `${n} pass/warn/fail`).join(' | ')} |`, `|---|${names.map(() => '---').join('|')}|`);
  for (const [c, title] of Object.entries(CATEGORIES)) lines.push(`| ${title} | ${names.map(n => { const t = scores[n].totals[c]; return `${t.pass} / ${t.warn} / ${t.fail}${t.na ? ` (${t.na} n/a)` : ''}`; }).join(' | ')} |`);
  lines.push(`| **Total** | ${names.map(n => { const t = Object.values(scores[n].totals).reduce((a, b) => ({ pass: a.pass + b.pass, warn: a.warn + b.warn, fail: a.fail + b.fail }), { pass: 0, warn: 0, fail: 0 }); return `**${t.pass} / ${t.warn} / ${t.fail}**`; }).join(' | ')} |`, '');
  for (const [c, title] of Object.entries(CATEGORIES)) {
    lines.push(`## ${title}`, '', `| Check | ${names.join(' | ')} |`, `|---|${names.map(() => '---').join('|')}|`);
    CHECKS.forEach(([category, id], i) => { if (category === c) lines.push(`| ${id} | ${names.map(n => `${scores[n].rows[i].verdict} (${show(scores[n].rows[i].value)})`).join(' | ')} |`); });
    lines.push('');
  }
  lines.push('## Thresholds', '');
  for (const [, id, why] of CHECKS) lines.push(`- **${id}** — ${why}`);
  fs.writeFileSync(path.join(dir, 'scorecard.md'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'scorecard.json'), JSON.stringify(Object.fromEntries(names.map(n => [n, { totals: scores[n].totals, rows: scores[n].rows.map(({ category, id, value, verdict }) => ({ category, id, value, verdict })) }])), null, 1));
  const end = lines.findIndex(l => l.startsWith('## Thresholds'));
  console.log(lines.slice(0, end).join('\n'));
  return scores;
}
module.exports = { run, score, CHECKS };
if (require.main === module) run(path.resolve(process.argv[2] || path.join(__dirname, '../shots/climb/audio')), (process.argv[3] || 'main,theirs,mine').split(','));
