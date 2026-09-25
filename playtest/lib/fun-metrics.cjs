// Fun-killer metrics computed from campaign-pilot telemetry.
//
// runMetrics() turns one campaign into numbers; FINDINGS then read the
// per-persona medians and cross-persona comparisons. Each finding has a
// healthy band (outside it: WARN) and a killer band (outside it: the game
// is not fun in that respect), and says what to do about it in design
// terms, not only tuning terms.
//
// Sources for the ideas: procedural personas (Holmgård et al. 2018),
// restricted play for dominant strategies (Jaffe et al. 2012), Ludi's
// aesthetic criteria of drama, uncertainty and duration (Browne 2008),
// and Left 4 Dead's build-up / peak / relax intensity rhythm (Booth 2009).
const zlib = require('node:zlib');

const TRAVEL = new Set(['transit', 'explore', 'home']);
const FIGHT = new Set(['combat', 'evade']);
const OBJECTIVE = new Set(['attack', 'capture']);
const PAUSE = new Set(['ground', 'recovery']);

const median = xs => { const s = xs.filter(x => x != null && !Number.isNaN(x)).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const mean = xs => { const s = xs.filter(x => x != null && Number.isFinite(x)); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null; };
const entropy = counts => {
  const v = Object.values(counts).filter(x => x > 0), n = v.reduce((a, b) => a + b, 0);
  if (v.length < 2) return 0;
  return -v.reduce((h, c) => h + c / n * Math.log(c / n), 0) / Math.log(v.length > 1 ? Math.max(v.length, 2) : 2);
};
// Normalized to the number of categories that could occur, not only those that did.
const entropyOver = (counts, categories) => {
  const n = categories.reduce((a, k) => a + (counts[k] || 0), 0);
  if (!n) return 0;
  return -categories.reduce((h, k) => { const p = (counts[k] || 0) / n; return p > 0 ? h + p * Math.log(p) : h; }, 0) / Math.log(categories.length);
};
function jensenShannon(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]), na = Object.values(a).reduce((x, y) => x + y, 0), nb = Object.values(b).reduce((x, y) => x + y, 0);
  let js = 0;
  for (const k of keys) {
    const p = (a[k] || 0) / na, q = (b[k] || 0) / nb, m = (p + q) / 2;
    if (p) js += p / 2 * Math.log2(p / m);
    if (q) js += q / 2 * Math.log2(q / m);
  }
  return js;
}
function runs(values, predicate) {
  const out = []; let length = 0;
  for (const v of values) { if (predicate(v)) length++; else if (length) { out.push(length); length = 0; } }
  if (length) out.push(length);
  return out;
}
// Seeded shuffle so the compressibility baseline is reproducible.
function shuffled(list, seed) {
  const a = [...list]; let s = seed >>> 0 || 1;
  for (let i = a.length - 1; i > 0; i--) { s = (1664525 * s + 1013904223) >>> 0; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Per-campaign numbers.
function runMetrics(run) {
  const tl = run.timeline, flying = tl.filter(s => !PAUSE.has(s.act)), fm = Math.max(1 / 60, flying.length / 60);
  const minutes = Math.max(1 / 60, tl.length / 60);
  const count = kind => run.events.filter(e => e.kind === kind).length;
  const share = set => flying.filter(s => set.has(s.act)).length / Math.max(1, flying.length);

  // A second is active when anything is happening to or by the pilot.
  const active = s => s.near > 0 || s.taken > 0 || s.shots > 0 || FIGHT.has(s.act) || OBJECTIVE.has(s.act) || s.act === 'approach';
  const lulls = runs(flying, s => !active(s));
  const longLulls = lulls.filter(n => n >= 45);
  // 30 s windows of intensity for rhythm: build-up, peak, relax.
  const windows = [];
  for (let i = 0; i < flying.length; i += 30) {
    const w = flying.slice(i, i + 30);
    windows.push(w.filter(active).length / w.length * .6 + Math.min(1, w.reduce((n, s) => n + s.taken, 0) / 30) * .4);
  }
  let peaks = 0, low = true;
  for (const w of windows) { if (low && w >= .55) { peaks++; low = false; } else if (w < .25) low = true; }
  const grind = Math.max(0, ...runs(flying, s => s.near > 0 || FIGHT.has(s.act)));

  // Tension: dips into danger that the pilot survives.
  let closeCalls = 0, inDanger = false;
  for (let i = 0; i < tl.length; i++) {
    const s = tl[i];
    if (!inDanger && s.hull < 35 && !PAUSE.has(s.act)) inDanger = true;
    if (inDanger && (s.hull >= 60 || s.act === 'ground')) { closeCalls++; inDanger = false; }
    if (inDanger && s.act === 'recovery') inDanger = false;
  }
  const minHull = Math.min(100, ...flying.map(s => s.hull));
  const underPressure = flying.filter(s => s.hull < 50).length / Math.max(1, flying.length);
  // Difficulty curve: damage per flying minute, late third over early third.
  const third = Math.floor(flying.length / 3), dmg = part => part.reduce((n, s) => n + s.taken, 0) / Math.max(1, part.length / 60);
  const difficultyCurve = third > 60 ? (dmg(flying.slice(2 * third)) + 1) / (dmg(flying.slice(0, third)) + 1) : null;

  // Drama and uncertainty: setbacks, and how late the last one comes.
  const setbacks = count('lost');
  const lastSetback = Math.max(0, ...run.events.filter(e => e.kind === 'lost').map(e => e.t));
  const duration = Math.max(1, tl.at(-1)?.t || 1);

  // Agency: decisions, and the longest stretch in the air without one.
  const decisions = run.events.filter(e => e.decision);
  let longestNoDecision = 0, lastDecision = 0;
  for (const e of decisions) { longestNoDecision = Math.max(longestNoDecision, e.t - lastDecision); lastDecision = e.t; }
  longestNoDecision = Math.max(longestNoDecision, duration - lastDecision);

  // Novelty: the last time something happened for the first time.
  const signature = e => [e.kind, e.of, e.role, e.ship, e.aircraft, e.status].filter(Boolean).join(':');
  const novel = new Map();
  for (const e of run.events) if (!['waypoint', 'bomb', 'landed', 'takeoff', 'recovered', 'circle broken', 'STALL', 'gave up', 'victory'].includes(e.kind)) {
    const k = signature(e); if (!novel.has(k)) novel.set(k, e.t);
  }
  const noveltyTimes = [...novel.values()].sort((a, b) => a - b);
  const noveltyHorizon = noveltyTimes.length ? Math.min(1, noveltyTimes.at(-1) / duration) : 0;
  const noveltySecondHalf = noveltyTimes.filter(t => t > duration / 2).length;

  // Repetition: sorties that play out the same way, and how compressible the whole campaign is.
  const sig = s => s.acts.filter(a => a.s >= 8).map(a => a.act).filter((a, i, l) => a !== l[i - 1]).join('>');
  const sortieSigs = run.sorties.filter(s => s.seconds > 20).map(sig);
  const sigCounts = {}; for (const s of sortieSigs) sigCounts[s] = (sigCounts[s] || 0) + 1;
  const repeatedSorties = sortieSigs.length ? sortieSigs.filter(s => sigCounts[s] > 1).length / sortieSigs.length : 0;
  const tokens = []; for (let i = 0; i < flying.length; i += 10) {
    const w = flying.slice(i, i + 10), c = {}; for (const s of w) c[s.act] = (c[s.act] || 0) + 1;
    tokens.push(Object.entries(c).sort((a, b) => b[1] - a[1])[0][0][0] + (w.some(s => s.near > 0) ? '!' : ''));
  }
  const size = t => zlib.deflateSync(Buffer.from(t.join(''))).length;
  const predictability = tokens.length > 20 ? 1 - size(tokens) / mean([1, 2, 3].map(k => size(shuffled(tokens, run.seed * 7 + k)))) : null;

  const acts = {}; for (const s of flying) acts[s.act] = (acts[s.act] || 0) + 1;
  const engageKinds = {}; for (const e of run.events.filter(e => e.kind === 'engage')) engageKinds[e.of] = (engageKinds[e.of] || 0) + 1;
  const objectives = {}; for (const s of flying) objectives[s.objective] = (objectives[s.objective] || 0) + 1;
  const aircraftTime = {}; for (const s of flying) aircraftTime[s.aircraft] = (aircraftTime[s.aircraft] || 0) + 1;
  const firstPassive = run.events.find(e => e.kind === 'lost');
  // Evolution: how different the second half's mix of activities and objectives is from the first
  // (Jensen–Shannon divergence, 0 identical, 1 disjoint). Near zero: the campaign never changes character.
  const mix = part => { const c = {}; for (const s of part) { c['a:' + s.act] = (c['a:' + s.act] || 0) + 1; c['o:' + s.objective] = (c['o:' + s.objective] || 0) + 1; } return c; };
  const half = Math.floor(flying.length / 2), evolution = half > 60 ? jensenShannon(mix(flying.slice(0, half)), mix(flying.slice(half))) : null;

  return {
    seed: run.seed, persona: run.persona, won: run.victory != null, victoryMinutes: run.victory != null ? run.victory / 60 : null,
    minutes, deathsPer10: count('shot down') / minutes * 10, capturesPer10: count('captured') / minutes * 10,
    travelShare: share(TRAVEL), fightShare: share(FIGHT), objectiveShare: share(OBJECTIVE), idleShare: share(new Set(['idle'])),
    lullShare: longLulls.reduce((a, b) => a + b, 0) / Math.max(1, flying.length), longestLull: Math.max(0, ...lulls),
    peaksPer10: peaks / fm * 10, grind,
    closeCallsPer10: closeCalls / fm * 10, minHull, underPressure, difficultyCurve,
    setbacks, setbacksPer10: setbacks / minutes * 10, uncertainty: setbacks ? lastSetback / duration : 0,
    decisionsPerMin: decisions.length / fm, longestNoDecision,
    noveltyHorizon, noveltySecondHalf, novelKinds: novel.size,
    repeatedSorties, predictability, sorties: sortieSigs.length,
    activityVariety: entropyOver(acts, ['transit', 'explore', 'home', 'approach', 'combat', 'attack', 'capture']),
    encounterVariety: entropyOver(engageKinds, ['raider', 'defender', 'bomber', 'escort', 'rescue']),
    objectiveVariety: entropy(objectives),
    lateAircraftShare: flying.filter(s => s.aircraft !== 'p38').length / Math.max(1, flying.length),
    aircraftUsed: Object.keys(aircraftTime).length,
    gaveUpPer10: count('gave up') / fm * 10,
    stalls: count('STALL'),
    firstLossMinutes: firstPassive ? firstPassive.t / 60 : Infinity,
    firstCaptureMinutes: (run.events.find(e => e.kind === 'captured')?.t ?? Infinity) / 60,
    evolution,
    killsPer10: count('kill') / fm * 10,
  };
}

// Per persona: medians of each number, and the win rate.
function summarize(rows) {
  const by = {};
  for (const r of rows) (by[r.persona] ||= []).push(r);
  const out = {};
  for (const [persona, list] of Object.entries(by)) {
    const keys = Object.keys(list[0]).filter(k => typeof list[0][k] === 'number' || list[0][k] === null);
    out[persona] = Object.fromEntries(keys.filter(k => k !== 'seed').map(k => [k, median(list.map(r => r[k]))]));
    out[persona].winRate = list.filter(r => r.won).length / list.length;
    out[persona].runs = list.length;
    out[persona].victoryMinutes = median(list.map(r => r.won ? r.victoryMinutes : Infinity));
  }
  return out;
}

// Findings. Each reads the persona summaries (S) and raw rows (R).
// band: healthy range; killer: range outside which it ruins the fun.
// smoke: an invariant; failing it fails the test whatever the baseline says.
const F = (id, category, question, value, band, killer, advice, extra = {}) => ({ id, category, question, value, band, killer, advice, ...extra });
const FINDINGS = [
  // --- Smoke: the campaign works at all.
  F('softlocks', 'smoke', 'Does the war ever stop moving for a pilot following the marker?',
    S => (S.average?.stalls || 0) + (S.ace?.stalls || 0), [0, 0], [0, 0],
    { high: 'Guidance or progression dead end: read the STALL events in the JSON for position and waypoint.' }, { smoke: true }),
  F('winnable', 'smoke', 'Can an average pilot who follows the marker win?',
    S => S.average?.winRate, [.8, 1], [.8, 1], { low: 'Victory unreachable within the cap: check objective chain, fleet guidance, stronghold access.' }, { smoke: true }),
  F('idle', 'smoke', 'Is there always an objective?',
    S => S.average?.idleShare, [0, .02], [0, .02], { high: 'The marker disappears: guidance has no next target for some state.' }, { smoke: true }),

  // --- Difficulty: crushing or trivial.
  F('rookieWins', 'difficulty', 'Can a weak player still win?',
    S => S.rookie?.winRate, [.5, 1], [.17, 1],
    { low: 'Crushingly hard for new players. Consider assists that fade with rank (auto-lead, wider hit radius), fewer defenders early, or enemies that disengage when a fight drags on.' }),
  F('aceDanger', 'difficulty', 'Does a skilled player ever feel danger?',
    S => S.ace?.closeCallsPer10, [.3, 6], [.05, 12],
    { low: 'Trivial at the top: an expert is never pushed. Scale threat with rank (aces, larger strikes, AA over strongholds) or add optional hard objectives.',
      high: 'Even experts live on the edge: damage or enemy numbers are too high.' }),
  F('averageDeaths', 'difficulty', 'How often does an average pilot lose an aircraft?',
    S => S.average?.deathsPer10, [.2, 3], [0, 6],
    { low: 'Nobody dies: losing an aircraft is not part of the game. Stakes come only from the war map; consider raising enemy lethality on strike escorts and defenders.',
      high: 'Death spiral: recovery is instant but the war moves while you respawn. Soften defender accuracy or add wing cover.' }),
  F('skillMatters', 'difficulty', 'Does getting better pay off? (rookie time to win ÷ ace time to win)',
    S => (S.rookie?.victoryMinutes ?? Infinity) / Math.max(1, S.ace?.victoryMinutes ?? Infinity), [1.4, 3.5], [1.1, 99],
    { low: 'Skill barely matters: outcomes are decided by the map and the marker. Reward accuracy and flying (bonus for fast kills, harder defenders that punish sloppy passes).',
      high: 'The skill gap is a cliff: rookies fall far behind. Add catch-up help or a gentler early curve.' }),
  F('difficultyCurve', 'difficulty', 'Does the war get harder as you win? (damage taken, last third ÷ first third)',
    S => S.average?.difficultyCurve, [.8, 2.5], [.4, 5],
    { low: 'The war gets easier as you win: a snowball with a dull end. Escalate: enemy counter-attacks, aces at strongholds, a final fleet battle.',
      high: 'A late difficulty spike: the end is a wall.' }),
  F('pressure', 'difficulty', 'Does the war come to you? (minutes until a passive player first loses a holding)',
    S => S.passive?.firstLossMinutes ?? Infinity, [4, 20], [1.5, 40],
    { low: 'Relentless: the enemy overruns a player who stops to breathe. Slow early raids.',
      high: 'No stakes: a player who does nothing loses nothing. Enemy raids need teeth or the war needs a clock.' }),

  F('hook', 'difficulty', 'Minutes until a weak player captures a first island',
    S => S.rookie?.firstCaptureMinutes, [0, 6], [0, 15],
    { high: 'A new player waits too long for a first win. Put a lightly defended target near home.' }),
  F('frustration', 'difficulty', 'Unresolved fights a rookie abandons per 10 minutes of flying',
    S => S.rookie?.gaveUpPer10, [0, 1.5], [0, 4],
    { high: 'Weak pilots get stuck in fights nobody wins. Enemies should break off, run low on fuel, or be finishable (a hit-radius assist for rookies).' }),

  // --- Dynamism and pacing.
  F('lulls', 'pacing', 'How much flying time sits in long lulls (45 s+ with nothing happening)?',
    S => S.average?.lullShare, [0, .3], [0, .5],
    { high: 'Dead air. Put decisions on the route: ambushes, convoys to divert for, weather, damaged friendlies calling for help, or shorten the map.' }),
  F('longestLull', 'pacing', 'Longest stretch in the air with nothing happening (seconds, median campaign)',
    S => S.average?.longestLull, [0, 120], [0, 240],
    { high: 'At least one long empty crossing per campaign. Look at the region links and survey legs.' }),
  F('rhythm', 'pacing', 'Intensity peaks per 10 minutes of flying (build-up, peak, relax)',
    S => S.average?.peaksPer10, [1.5, 6], [.7, 10],
    { low: 'Flat pacing: either constant fighting or constant cruising. Separate encounters with recoveries and make each encounter a spike.',
      high: 'No valleys: fights run into each other with no room to breathe.' }),
  F('grind', 'pacing', 'Longest continuous fight (seconds)',
    S => S.average?.grind, [20, 150], [5, 300],
    { high: 'Fights that never end: enemies neither die nor leave. Give enemies fuel or morale so dragged-out fights break off.',
      low: 'Fights are over before they start: enemies die in one pass.' }),
  F('uncertainty', 'pacing', 'How late does the last setback come? (fraction of the campaign)',
    S => S.average?.uncertainty, [.4, 1], [.1, 1],
    { low: 'The outcome is decided early; the rest is mopping up. Enemy counter-offensives late in the war keep it in doubt.' }),
  F('drama', 'pacing', 'Holdings lost per 10 minutes (setbacks to recover from)',
    S => S.average?.setbacksPer10, [.2, 2], [.05, 4],
    { low: 'Nothing is ever lost: no drama. Let raids retake undefended islands more often.',
      high: 'The front keeps collapsing behind you: whack-a-mole.' }),

  // --- Repetition and novelty.
  F('novelty', 'repetition', 'When does the last new thing happen? (fraction of the campaign)',
    S => S.average?.noveltyHorizon, [.5, 1], [.25, 1],
    { low: 'Everything is seen early; the second half repeats it. Introduce new enemy types, targets or mechanics as the war advances (bombers with gunners, AA, night, weather, the enemy fleet sortieing).' }),
  F('repeatedSorties', 'repetition', 'Share of sorties that play out exactly like another one',
    S => S.average?.repeatedSorties, [0, .5], [0, .8],
    { high: 'Same sortie over and over: take off, fly, bomb, circle, return. Vary objectives (escort, intercept, recon, rescue) and target defenses.' }),
  F('predictability', 'repetition', 'How compressible is the activity stream vs. a shuffled one? (0 random, 1 fully scripted)',
    S => S.average?.predictability, [.03, .55], [0, .75],
    { high: 'Highly scripted: you can predict the next ten minutes. Add interruptions and emergent events.',
      low: 'Close to random: activities follow no arc. Encounters may need build-up (radar warnings, visible strike groups) before they hit.' }),
  F('evolution', 'repetition', 'How much does the second half differ from the first? (Jensen–Shannon divergence of activities and objectives)',
    S => S.average?.evolution, [.05, .5], [.02, .8],
    { low: 'The campaign never changes character: the last ten minutes look like the first ten. Phase the war (island hopping, then fleet hunt, then assault on the stronghold) with distinct mechanics per phase.',
      high: 'The two halves are different games: check the second half is not a grind.' }),
  F('objectives', 'variety', 'Variety of objectives the marker gives (normalized entropy of objective titles over flying time)',
    S => S.average?.objectiveVariety, [.55, 1], [.35, 1],
    { low: 'The marker keeps asking for the same thing. Add objective types: escort a strike, intercept a raid, recon a fleet, rescue a downed pilot.' }),

  // --- Flying.
  F('travel', 'flying', 'Share of flying spent travelling with nothing to decide',
    S => S.average?.travelShare, [.2, .45], [0, .6],
    { high: 'Mostly commuting. Forward bases that rearm closer to the front, shorter survey legs, or content en route.' }),
  F('decisionGap', 'flying', 'Longest stretch without a decision (seconds)',
    S => S.average?.longestNoDecision, [0, 150], [0, 300],
    { high: 'Long stretches of holding a heading. Offer choices en route (targets of opportunity, distress calls).' }),

  // --- Strategy and variety.
  F('gunsMatter', 'strategy', 'Can you win without firing a shot? (pacifist win rate)',
    S => S.pacifist?.winRate, [0, .2], [0, .5],
    { high: 'Dogfighting is optional: the wing or ordnance does the work. Make air superiority a precondition or a big accelerator.' }),
  F('fightsPay', 'strategy', 'Is skipping fights faster? (rusher time to win ÷ average)',
    S => (S.rusher?.victoryMinutes ?? Infinity) / Math.max(1, S.average?.victoryMinutes ?? Infinity), [.85, 1.5], [.7, 99],
    { low: 'Avoiding combat is the dominant strategy: fights are a tax, not a reward. Make kills pay into the war (weaker counter-attacks, unlocks, faster captures).' }),
  F('huntingPays', 'strategy', 'Is hunting every fighter slower? (brawler time to win ÷ average)',
    S => (S.brawler?.victoryMinutes ?? Infinity) / Math.max(1, S.average?.victoryMinutes ?? Infinity), [.8, 1.4], [.6, 2],
    { high: 'Chasing aircraft costs you the war: combat and conquest pull against each other. Tie fighter kills to territory progress.',
      low: 'Pure hunting wins fastest: the conquest layer barely matters.' }),
  F('dominance', 'strategy', 'Share of seeds where the same full strategy wins fastest',
    (S, R) => {
      const seeds = [...new Set(R.map(r => r.seed))], strategies = ['average', 'brawler', 'rusher'];
      const best = seeds.map(seed => strategies.map(p => R.find(r => r.seed === seed && r.persona === p)).filter(r => r?.won).sort((a, b) => a.victoryMinutes - b.victoryMinutes)[0]?.persona).filter(Boolean);
      if (!best.length) return null;
      const counts = {}; for (const b of best) counts[b] = (counts[b] || 0) + 1;
      return Math.max(...Object.values(counts)) / seeds.length;
    }, [0, .67], [0, .9],
    { high: 'One strategy wins everywhere: players will find it and stop exploring. Give maps features that reward different approaches.' }),
  F('aircraftChoice', 'strategy', 'Share of flying in aircraft unlocked after the start',
    S => S.average?.lateAircraftShare, [.3, .9], [.1, .98],
    { low: 'Unlocks do not change how you play: the first aircraft is enough. Give each aircraft a job only it does well.',
      high: 'The starter aircraft is abandoned at once: its unlock is meaningless.' }),
  F('encounters', 'variety', 'Variety of enemies engaged (normalized entropy over raider/defender/bomber/escort/rescue)',
    S => S.average?.encounterVariety, [.45, 1], [.25, 1],
    { low: 'Every fight is against the same kind of enemy. More enemy roles, or make strike groups reach the player more often.' }),
  F('activities', 'variety', 'Variety of what the pilot does (normalized entropy over flying activities)',
    S => S.average?.activityVariety, [.65, 1], [.45, 1],
    { low: 'One activity dominates the session.' }),
  F('mapFairness', 'map', 'Spread of campaign length across seeds (slowest ÷ fastest, average pilot)',
    (S, R) => { const v = R.filter(r => r.persona === 'average' && r.won).map(r => r.victoryMinutes); return v.length > 1 ? Math.max(...v) / Math.min(...v) : null; },
    [1, 2], [1, 3], { high: 'Seeds differ wildly: some maps are much longer. Constrain region count or link lengths in expedition-geography.' }),
];

function evaluate(summary, rows) {
  return FINDINGS.map(f => {
    let value = null;
    try { value = f.value(summary, rows); } catch { value = null; }
    const within = ([lo, hi]) => value != null && Number.isFinite(value) ? value >= lo && value <= hi : (value === Infinity ? hi === Infinity || hi >= 99 : false);
    const status = value == null ? 'n/a' : within(f.band) ? 'ok' : within(f.killer) ? 'warn' : 'killer';
    const side = value != null && value < f.band[0] ? 'low' : 'high';
    return { id: f.id, category: f.category, question: f.question, value, band: f.band, killer: f.killer, status, smoke: !!f.smoke,
      advice: status === 'ok' ? null : f.advice[side] || f.advice.high || f.advice.low };
  });
}
// How far outside its healthy band a value sits, in band widths: used to ratchet known problems.
function distance(result) {
  const { value, band: [lo, hi] } = result;
  if (value == null) return 0;
  if (!Number.isFinite(value)) return 10;
  const width = Math.max(1e-6, Number.isFinite(hi) ? hi - lo : Math.abs(lo) || 1);
  return value < lo ? (lo - value) / width : value > hi ? (value - hi) / width : 0;
}
module.exports = { runMetrics, summarize, evaluate, distance, FINDINGS, median };
