#!/usr/bin/env node
// Deterministic offline render of the game's sound, and the numbers behind it.
//
// One fixed ~45 s scripted sortie (idle, takeoff, cruise, boost, brake turn,
// bursts, overheat, hits and a kill, incoming fire and damage, a bomb, a
// torpedo, a quiet leg, a deck landing) is played through three sources on an
// OfflineAudioContext in headless Chromium, by calling the same exported
// functions the game calls:
//   main    git show main:src/audio.js        (the shipped sound)
//   theirs  $THEIRS/src/audio.js              (the owner's branch, read-only)
//   mine    src/audio.js in this tree
// A second render, the "cue sheet", plays every game event alone so each cue
// can be measured in isolation. Nobody in this loop can hear: everything
// written here is a measurement, never a judgement of how it sounds.
//
//   node playtest/climb/audio-render.cjs            # all three, then the scorecard
//   AUDIO_SOURCES=mine AUDIO_OUT=dir AUDIO_CLIPS=1 node playtest/climb/audio-render.cjs
//
// Writes <source>.wav, <source>-sheet.wav, <source>.png (spectrogram),
// <source>.report.json, cues.json, and with AUDIO_CLIPS=1 mine-<cue>.wav.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { execFileSync, spawnSync } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const THEIRS = process.env.THEIRS || '/home/user/theirs';
const OUT = path.resolve(process.env.AUDIO_OUT || path.join(ROOT, 'playtest/shots/climb/audio'));
const SOURCES = (process.env.AUDIO_SOURCES || 'main,theirs,mine').split(',');
const SR = 48000, SEQ_SECONDS = 45;

// --- the script -----------------------------------------------------------------
// Flight numbers are the Corsair's from src/config.js, and speed follows the
// throttle with the same lag as player.js, so the engine is driven as in play.
const FLY = { cruise: 250, boost: 350, brake: 160, turnRate: 3.1, fireCooldown: .13, heatPerShot: .085, heatCool: .4, heatRecover: .35, takeoff: 2.5, landing: 1 };
function buildSequence() {
  const events = [], cues = [], frames = 30;
  const cue = (t, name, args) => events.push({ t, cue: name, args });
  const label = (t, name, text) => cues.push({ label: name, start: t, text });
  const phases = [   // [from, flight, throttle target, turn]
    [0, 'landed', 0, 0], [2, 'takeoff', 0, 0], [4.5, 'flying', FLY.cruise, 0], [7.5, 'flying', FLY.boost, 0],
    [10.5, 'flying', FLY.brake, 1], [13.5, 'flying', FLY.cruise, 0], [41.5, 'landing', 0, 0], [42.5, 'landed', 0, 0],
  ];
  label(0, 'engine-idle', 'parked, engine idling'); label(2, 'takeoff', 'takeoff run'); label(4.5, 'cruise', 'cruise');
  label(7.5, 'boost', 'full throttle'); label(10.5, 'brake-turn', 'throttle back, hard turn'); label(13.5, 'cruise-2', 'level at cruise');
  cue(.3, 'ui'); cue(2, 'takeoff');
  // short burst
  label(14.5, 'short-burst', 'four trigger pulls');
  for (let i = 0; i < 4; i++) cue(14.5 + i * FLY.fireCooldown, 'gun');
  // sustained fire to overheat, with hits and a kill on the way
  label(16.5, 'sustained-fire', 'hold the trigger until the guns lock');
  let heat = 0, t = 16.5, overheatAt = 0, readyAt = 0;
  for (;;) {
    heat = Math.max(0, heat - FLY.heatCool * FLY.fireCooldown) + FLY.heatPerShot;
    cue(t, 'gun');
    if (heat >= 1) { overheatAt = t; cue(t, 'overheat'); break; }
    t += FLY.fireCooldown;
  }
  readyAt = overheatAt + (1 - FLY.heatRecover) / FLY.heatCool;
  label(overheatAt, 'overheat', 'guns lock'); label(readyAt, 'guns-ready', 'guns recover');
  label(17.6, 'hits-and-kill', 'four rounds strike an enemy; the fourth destroys it');
  for (const ht of [17.6, 17.73, 17.99, 18.25]) cue(ht, 'hit', { x: 260, y: -40 });
  cue(18.25, 'kill', { x: 260, y: -40 });
  // incoming
  label(22.5, 'incoming', 'enemy fire, near misses, three hits taken, an enemy passing close');
  for (const et of [22.5, 23.1, 23.7, 24.3, 25.5, 26.1]) cue(et, 'enemyGun', { x: -320, y: -180 });
  for (const [wt, x] of [[22.9, -40], [23.5, 35], [25.8, -30]]) cue(wt, 'nearMiss', { x, y: 20 });
  for (const pt of [24.0, 24.6, 26.4]) cue(pt, 'playerHit');
  // ordnance
  label(28, 'bomb', 'bomb released, falls .8 s, hits land'); cue(28, 'bombRelease'); cue(28.8, 'bombLand', { x: 150, y: -100 });
  label(31, 'torpedo', 'torpedo dropped, runs, hits and sinks a ship'); cue(31, 'torpedoDrop'); cue(33.5, 'torpedoHit', { x: 480, y: 0 }); cue(33.6, 'shipSunk', { x: 480, y: 0 });
  label(36.5, 'navigation', 'nothing happening: cruise toward the next objective'); cue(37, 'objective');
  label(41.5, 'landing', 'wire caught, roll out, engine to idle'); cue(41.5, 'landing'); cue(42.5, 'radio');
  // per-frame flight state
  let speed = 0, hp = 100;
  const shots = events.filter(e => e.cue === 'gun').map(e => e.t);
  for (let i = 0; i <= SEQ_SECONDS * frames; i++) {
    const ft = i / frames, dt = 1 / frames, ph = phases.filter(p => p[0] <= ft).pop(), since = ft - ph[0];
    if (ph[1] === 'takeoff') speed = FLY.cruise * Math.min(1, since / FLY.takeoff);
    else if (ph[1] === 'landing') { const u = Math.min(1, since / FLY.landing); speed = FLY.cruise * (1 - u * (2 - u)); }
    else if (ph[1] === 'landed') speed = 0;
    else speed += (ph[2] - speed) * (1 - Math.pow(.02, dt));
    hp = 100 - 12 * [24.0, 24.6, 26.4].filter(x => x <= ft).length;
    // One enemy crosses close in front, left to right, during the incoming section.
    const pass = ft >= 24.5 && ft <= 27.5 ? [{ id: 1, x: -700 + (ft - 24.5) * 480, y: -60, hp: 4 }] : [];
    const lastShot = shots.filter(x => x <= ft).pop();
    events.push({ t: ft, frame: { flight: ph[1], speed, omega: ph[3] * FLY.turnRate, hp, aircraft: 'corsair', fireCd: lastShot === undefined ? -9 : FLY.fireCooldown - (ft - lastShot),
      overheated: overheatAt > 0 && ft >= overheatAt && ft < readyAt, enemies: pass } });
  }
  return { events, cues, seconds: SEQ_SECONDS, marks: { overheatAt, readyAt } };
}

// Every game event on its own. `event` is the name the adapters understand.
const SHEET = [
  ['gun', 'own guns: one trigger pull'], ['hit', 'own round strikes an aircraft'], ['hitHull', 'own round strikes a transport'],
  ['kill', 'aircraft destroyed'], ['enemyGun', 'enemy fighter fires'], ['nearMiss', 'enemy round passes close'],
  ['playerHit', 'player takes a round'], ['collision', 'mid-air collision'], ['overheat', 'guns overheat and lock'],
  ['gunReady', 'guns recover'], ['allyGun', 'wingman fires'], ['shipGun', 'ship or emplacement fires'],
  ['bombRelease', 'bomb released and falling'], ['bombLand', 'bomb hits land'], ['bombShip', 'bomb hits a ship'],
  ['bombWater', 'bomb misses into the sea'], ['torpedoDrop', 'torpedo dropped and running'], ['torpedoHit', 'torpedo strikes a hull'],
  ['shipSunk', 'ship sinks'], ['landing', 'carrier arrest'], ['landingStrip', 'runway touchdown'], ['takeoff', 'takeoff roll'],
  ['capture', 'territory captured'], ['objective', 'objective changed'], ['loss', 'territory or carrier lost'],
  ['raid', 'raid warning'], ['radio', 'message arrives'], ['ui', 'button pressed'], ['playerDown', 'player shot down'],
];
const ENGINE_STATES = [   // [name, description, frame]
  ['engineIdle', 'landed idle', { flight: 'landed', speed: 0, omega: 0, hp: 100 }],
  ['engineCruise', 'cruise', { flight: 'flying', speed: FLY.cruise, omega: 0, hp: 100 }],
  ['engineBoost', 'full throttle', { flight: 'flying', speed: FLY.boost, omega: 0, hp: 100 }],
  ['engineBrakeTurn', 'throttled back in a hard turn', { flight: 'flying', speed: FLY.brake, omega: FLY.turnRate, hp: 100 }],
  ['engineHurt', 'cruise with hull at 10%', { flight: 'flying', speed: FLY.cruise, omega: 0, hp: 10 }],
  // other aircraft: an enemy crossing 60 units ahead at 480 units/s, and a wingman holding formation 93 units away
  ['flybyPass', 'enemy passes close', t => ({ flight: 'flying', speed: FLY.cruise, omega: 0, hp: 100, enemies: [{ id: 7, x: -960 + t * 480, y: -60, hp: 4 }] })],
  ['wingmanFormation', 'wingman in formation', () => ({ flight: 'flying', speed: FLY.cruise, omega: 0, hp: 100, allies: [{ id: 8, x: -70, y: 62, hp: 40, role: 'wing' }] })],
];
function buildSheet() {
  const events = [], slots = [];
  let t = .5;
  for (const [name, text] of SHEET) { events.push({ t, cue: name, args: { x: 0, y: 0 } }); slots.push({ name, text, start: t, length: 3.6, kind: 'cue' }); t += 3.6; }
  // repetition: eight single trigger pulls, far enough apart not to overlap
  for (let i = 0; i < 8; i++) { events.push({ t, cue: 'gun' }); slots.push({ name: `gunRepeat${i}`, start: t, length: .6, kind: 'repeat' }); t += .6; }
  t += 1;
  // a held burst of 24 pulls at the game's cadence, then release
  slots.push({ name: 'gunSustain', start: t, length: 24 * FLY.fireCooldown + 2, kind: 'sustain', shots: 24 });
  for (let i = 0; i < 24; i++) events.push({ t: t + i * FLY.fireCooldown, cue: 'gun' });
  t += 24 * FLY.fireCooldown + 2;
  // Frames keep running through the one-shots, out of play, so the bed is silent
  // but edge detection (the tail after a burst is released) still happens.
  for (let i = 0; i < t * 30; i++) events.push({ t: i / 30, frame: { off: true } });
  for (const [name, text, state] of ENGINE_STATES) {
    for (let i = 0; i < 120; i++) events.push({ t: t + i / 30, frame: { aircraft: 'corsair', enemies: [], ...(typeof state === 'function' ? state(i / 30) : state) } });
    events.push({ t: t + 4, frame: { off: true } });
    slots.push({ name, text, start: t, length: 4, kind: 'engine' }); t += 5.2;
  }
  return { events, slots, seconds: Math.ceil(t) };
}

// --- in the page ----------------------------------------------------------------
async function renderInPage({ source, events, seconds, sr, mono, bedOnly }) {
  const ctx = new OfflineAudioContext(2, Math.round(seconds * sr), sr);
  // The older modules gate on context state, and an offline context reads
  // "suspended" whenever we stop it to issue a cue.
  Object.defineProperty(ctx, 'state', { get: () => 'running' });
  const m = await import(`/${source}/src/audio.js?render=${Date.now()}-${Math.random()}`);
  let cues, frame = () => {};
  if (source === 'mine') {
    m.audioAttach(ctx, { sync: true });
    const P = o => o || {};
    cues = {
      gun: () => m.sfxGun('corsair', .13), overheat: () => m.sfxOverheat(), gunReady: () => m.sfx('gunReady'),
      hit: o => m.sfxHit(P(o).x, P(o).y, true), hitHull: o => m.sfxHit(P(o).x, P(o).y, true, true),
      kill: o => m.sfxBoom(false, P(o).x, P(o).y), enemyGun: o => m.sfxEnemyGun(P(o).x, P(o).y), nearMiss: o => m.sfx('whiz', o),
      playerHit: () => m.sfxPlayerHit(12), collision: () => { m.sfxPlayerHit(15); m.sfxCollision(); },
      allyGun: o => m.sfxAllyGun(P(o).x, P(o).y), shipGun: o => m.sfxShipGun(P(o).x, P(o).y),
      bombRelease: () => m.sfxBombRelease(.8),
      bombLand: o => { m.sfxBoom(true, P(o).x, P(o).y); m.sfxBombImpact('land', P(o).x, P(o).y); },
      bombShip: o => { m.sfxBoom(true, P(o).x, P(o).y); m.sfxBombImpact('ship', P(o).x, P(o).y); },
      bombWater: o => m.sfxBombImpact('water', P(o).x, P(o).y),
      torpedoDrop: () => m.sfxTorpedoDrop(), torpedoHit: o => m.sfxTorpedoHit(P(o).x, P(o).y),
      shipSunk: o => { m.sfxBoom(true, P(o).x, P(o).y); m.sfxShipSunk(P(o).x, P(o).y); m.sfxSignal('radio'); },
      landing: () => { m.sfxSignal('radio'); m.sfxLanding(true); }, landingStrip: () => m.sfxLanding(false), takeoff: () => m.sfxTakeoff(),
      capture: () => { m.sfxSignal('radio'); m.sfxSignal('capture'); }, objective: () => m.sfx('objective'),
      loss: () => { m.sfxSignal('radio'); m.sfxSignal('loss'); }, raid: () => m.sfxSignal('raid'), radio: () => m.sfxSignal('radio'),
      ui: () => m.sfxUi(), playerDown: () => { m.sfxBoom(true); m.sfx('playerDown'); },
    };
    const things = new Map();
    frame = f => {
      const same = e => { let o = things.get(e.id); if (!o) things.set(e.id, o = {}); return Object.assign(o, e); };
      const enemies = (f.enemies || []).map(same), allies = (f.allies || []).map(same);
      m.audioFrame({ mode: f.off ? 'title' : 'play', paused: false, cam: { x: 0, y: 0 }, enemies, allies, ebullets: [], waypoint: null,
        player: { x: 0, y: 0, a: 0, ...f } }, { W: 900, H: 600 });
    };
  } else {
    // What the game on that branch would actually play for each event.
    window.AudioContext = function () { return ctx; };
    m.audioInit();
    cues = { gun: () => m.sfxGun(), overheat: () => m.sfxOverheat(), kill: () => m.sfxBoom(false),
      bombLand: () => m.sfxBoom(true), bombShip: () => m.sfxBoom(true), shipSunk: () => m.sfxBoom(true), playerDown: () => m.sfxBoom(true) };
  }
  const groups = new Map(), issued = [];
  for (const e of events) {
    if (bedOnly && e.cue) continue;
    const q = Math.ceil(e.t * sr / 128) * 128;
    if (!groups.has(q)) groups.set(q, []);
    groups.get(q).push(e);
  }
  const run = list => { for (const e of list) { if (e.cue) { issued.push({ cue: e.cue, t: ctx.currentTime, has: !!cues[e.cue] }); cues[e.cue]?.(e.args); } else frame(e.frame); } };
  for (const [q, list] of groups) {
    if (q === 0) run(list);
    else if (q < seconds * sr) ctx.suspend(q / sr).then(() => { run(list); ctx.resume(); });
  }
  const buffer = await ctx.startRendering();
  const l = buffer.getChannelData(0), r = buffer.getChannelData(1), n = l.length;
  let peak = 0, clipped = 0;
  for (let i = 0; i < n; i++) { const a = Math.max(Math.abs(l[i]), Math.abs(r[i])); if (a > peak) peak = a; if (a >= .999) clipped++; }
  const ch = mono ? 1 : 2, pcm = new Int16Array(n * ch);
  for (let i = 0; i < n; i++) {
    if (mono) pcm[i] = Math.max(-32768, Math.min(32767, Math.round((l[i] + r[i]) * .5 * 32767)));
    else { pcm[2 * i] = Math.max(-32768, Math.min(32767, Math.round(l[i] * 32767))); pcm[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(r[i] * 32767))); }
  }
  const bytes = new Uint8Array(pcm.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
  return { pcm: btoa(s), channels: ch, peak, clipped, issued };
}

// --- analysis -------------------------------------------------------------------
const db = x => 20 * Math.log10(Math.max(x, 1e-9)), db10 = x => 10 * Math.log10(Math.max(x, 1e-18));
const round = (x, d = 2) => Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null;
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) {
      const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
      re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}
// Welch power spectrum of x[from..to): Hann windows of `size`, half overlapped.
function psd(x, from, to, size = 4096) {
  const out = new Float64Array(size / 2), re = new Float64Array(size), im = new Float64Array(size);
  let frames = 0;
  from = Math.max(0, Math.round(from)); to = Math.min(x.length, Math.round(to));
  for (let s = from; s < to; s += size / 2) {
    for (let i = 0; i < size; i++) { const v = s + i < to ? x[s + i] : 0; re[i] = v * (.5 - .5 * Math.cos(2 * Math.PI * i / size)); im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < size / 2; k++) out[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
    if (s + size >= to) break;
  }
  for (let k = 0; k < out.length; k++) out[k] /= Math.max(1, frames) * size * size * .375 / 2;
  return out;
}
// Spectrum of the loudest 4096-sample frame: what a transient offers against a steady bed.
function loudestFrame(x, from, to) {
  let best = from, top = -1;
  for (let s = from; s < to; s += 1024) { let e = 0; for (let i = s; i < s + 4096 && i < x.length; i++) e += x[i] * x[i]; if (e > top) { top = e; best = s; } }
  return psd(x, best, best + 4096);
}
const EDGES = [0, 80, 250, 2000, 8000, SR / 2], NAMES = ['sub', 'low', 'mid', 'high', 'air'];
function bandPower(p, lo, hi, size = (p.length * 2)) { let s = 0; const k0 = Math.ceil(lo * size / SR), k1 = Math.min(p.length, Math.ceil(hi * size / SR)); for (let k = k0; k < k1; k++) s += p[k]; return s; }
function spectral(x, from, to) {
  const p = psd(x, from, to), total = bandPower(p, 20, SR / 2) || 1e-18, shares = {};
  NAMES.forEach((n, i) => shares[n] = round(bandPower(p, Math.max(20, EDGES[i]), EDGES[i + 1]) / total, 3));
  let num = 0, den = 0, geo = 0, cnt = 0;
  for (let k = 2; k < p.length; k++) { const f = k * SR / (p.length * 2); num += f * p[k]; den += p[k]; if (f > 100 && f < 8000) { geo += Math.log(p[k] + 1e-20); cnt++; } }
  const arith = bandPower(p, 100, 8000) / cnt;
  // 24 log-spaced bands, 40 Hz – 14 kHz, in dB relative to the strongest: the cue's spectral shape.
  const shape = [];
  for (let b = 0; b < 24; b++) shape.push(db10(bandPower(p, 40 * Math.pow(350, b / 24), 40 * Math.pow(350, (b + 1) / 24)) + 1e-18));
  const top = Math.max(...shape);
  return { shares, centroid: round(num / (den || 1), 0), flatness: round(Math.exp(geo / cnt) / (arith || 1e-18), 3),
    above300: round(bandPower(p, 300, SR / 2) / total, 3), shape: shape.map(v => round(Math.max(-50, v - top), 1)), power: total, p };
}
function levels(x, from, to) {
  let peak = 0, sum = 0; from = Math.max(0, Math.round(from)); to = Math.min(x.length, Math.round(to));
  for (let i = from; i < to; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; sum += x[i] * x[i]; }
  const rms = Math.sqrt(sum / Math.max(1, to - from));
  return { peakDb: round(db(peak), 1), rmsDb: round(db(rms), 1), crestDb: round(db(peak) - db(rms), 1), peak, rms };
}
// Envelope in 1 ms peak frames; onset at -20 dB re the cue's peak; attack is
// onset → peak; decay is peak → the last frame within 30 dB of the peak.
function envelope(x, from, to, scheduled) {
  const hop = SR / 1000, env = [];
  for (let s = from; s + hop <= to; s += hop) { let m = 0; for (let i = s; i < s + hop; i++) m = Math.max(m, Math.abs(x[i])); env.push(m); }
  const peak = Math.max(...env);
  if (peak < 3e-4) return { silent: true };
  const at = env.indexOf(peak), on = env.findIndex(v => v >= peak * .1);
  let end = env.length - 1; while (end > at && env[end] < peak * Math.pow(10, -30 / 20)) end--;
  let on5 = from; while (on5 < to && Math.abs(x[on5]) < peak * .1) on5++;
  // Rise: onset → first frame at 70 % of the peak. Profile: energy in doubling time bins after the onset
  // (0–10, –20, –40 … ms), in dB re the strongest bin: the cue's shape in time.
  const rise = env.findIndex(v => v >= peak * .7) - on, profile = [];
  for (let b = 0, lo = 0, hi = 10; b < 9; b++, lo = hi, hi *= 2) { let e = 0; for (let i = on + lo; i < on + hi && i < env.length; i++) e += env[i] * env[i]; profile.push(db10(e + 1e-12)); }
  const top = Math.max(...profile);
  return { silent: false, onsetMs: round((on5 - scheduled) / SR * 1000, 2), attackMs: rise, peakAtMs: at - on, decayMs: end - at, durationMs: end - on, profile: profile.map(v => round(Math.max(-40, v - top), 1)) };
}
// Largest normalised cross-correlation of two windows within ±lag samples.
function xcorr(x, a, b, len, lag = 480) {
  let best = 0, ea = 0; for (let i = 0; i < len; i++) ea += x[a + i] * x[a + i];
  for (let l = -lag; l <= lag; l += 2) { let s = 0, eb = 0; for (let i = 0; i < len; i++) { const v = x[b + l + i] || 0; s += x[a + i] * v; eb += v * v; } best = Math.max(best, Math.abs(s) / Math.sqrt(ea * eb + 1e-18)); }
  return best;
}
// Similarity of two shots as pictures: correlation of their log band-energy/time patches.
function patch(x, from, len) {
  const out = [], size = 1024;
  for (let s = from; s + size <= from + len; s += 480) { const p = psd(x, s, s + size, size); for (let b = 0; b < 16; b++) out.push(Math.max(-80, db10(bandPower(p, 80 * Math.pow(150, b / 16), 80 * Math.pow(150, (b + 1) / 16), size) + 1e-18))); }
  return out;
}
function pearson(a, b) { const n = Math.min(a.length, b.length), ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n, mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n; let sab = 0, sa = 0, sb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return sab / Math.sqrt(sa * sb + 1e-18); }
// Distance between two cues' fingerprints, 0 (same) to 1: spectral shape, centroid, shape in time, length.
function distance(a, b) {
  if (!a || !b || a.silent || b.silent) return null;
  let s = 0, e = 0; for (let i = 0; i < 24; i++) s += Math.abs(a.shape[i] - b.shape[i]);
  for (let i = 0; i < 9; i++) e += Math.abs(a.profile[i] - b.profile[i]);
  const spec = Math.min(1, s / 24 / 25), cen = Math.min(1, Math.abs(Math.log2(a.centroid / b.centroid)) / 3), time = Math.min(1, e / 9 / 20), len = Math.min(1, Math.abs(Math.log2((a.durationMs + 5) / (b.durationMs + 5))) / 4);
  return round(.4 * spec + .2 * cen + .25 * time + .15 * len, 3);
}
function wav(file, pcm, channels) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * channels * 2, 28); h.writeUInt16LE(channels * 2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, pcm]));
}
function toFloat(pcm, channels) {   // → mono Float32
  const i16 = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2), n = i16.length / channels, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = channels === 2 ? (i16[2 * i] + i16[2 * i + 1]) / 65534 : i16[i] / 32767;
  return x;
}
// EBU R128 integrated loudness and range via ffmpeg, optionally of a section.
function loudness(file, from, length) {
  const args = ['-hide_banner', '-nostats'];
  if (from !== undefined) args.push('-ss', String(from), '-t', String(length));
  args.push('-i', file, '-af', 'ebur128', '-f', 'null', '-');
  const text = spawnSync('ffmpeg', args, { encoding: 'utf8' }).stderr || '', tail = text.slice(text.lastIndexOf('Summary:'));
  const I = /I:\s+(-?[\d.]+) LUFS/.exec(tail), LRA = /LRA:\s+(-?[\d.]+) LU/.exec(tail);
  return { lufs: I ? Number(I[1]) : null, lra: LRA ? Number(LRA[1]) : null };
}

function analyse(source, seq, seqScript, sheet, sheetScript, bed, files) {
  const x = toFloat(seq.pcmBuf, 2), s = toFloat(sheet.pcmBuf, 1), b = bed ? toFloat(bed.pcmBuf, 1) : null;
  const report = { source, sampleRate: SR, seconds: seqScript.seconds, thresholds: 'see playtest/climb/audio-score.cjs' };
  // whole mix
  const whole = spectral(x, 0, x.length), lv = levels(x, 0, x.length), loud = loudness(files.seq);
  report.mix = { samplePeak: round(seq.peak, 4), samplePeakDb: round(db(seq.peak), 2), clippedSamples: seq.clipped, rmsDb: lv.rmsDb, crestDb: round(db(seq.peak) - lv.rmsDb, 1),
    integratedLufs: loud.lufs, loudnessRangeLu: loud.lra, bands: whole.shares, centroid: whole.centroid, above300: whole.above300 };
  // labelled sections of the sequence
  report.sections = {};
  seqScript.cues.forEach((c, i) => {
    const end = seqScript.cues.slice(i + 1).map(n => n.start).find(t => t > c.start + .3) ?? seqScript.seconds, a = Math.round(c.start * SR), z = Math.round(end * SR);
    const sp = spectral(x, a, z), l = levels(x, a, z);
    report.sections[c.label] = { start: c.start, end, rmsDb: l.rmsDb, peakDb: l.peakDb, lufs: end - c.start >= 1 ? loudness(files.seq, c.start, end - c.start).lufs : null, bands: sp.shares, centroid: sp.centroid };
  });
  // isolated cues
  report.cues = {}; const prints = {};
  for (const slot of sheetScript.slots.filter(q => q.kind === 'cue' || q.kind === 'engine')) {
    const a = Math.round(slot.start * SR), z = Math.round((slot.start + slot.length) * SR), actual = sheet.issued.find(e => e.cue === slot.name && Math.abs(e.t - slot.start) < .01);
    const env = envelope(s, a, z, Math.round((actual ? actual.t : slot.start) * SR));
    if (env.silent) { report.cues[slot.name] = { text: slot.text, silent: true }; continue; }
    const zz = slot.kind === 'engine' ? z : Math.min(z, a + Math.round((env.durationMs + 60) * SR / 1000)), a2 = slot.kind === 'engine' ? a + SR : a;
    const sp = spectral(s, a2, zz), l = levels(s, a2, zz);
    prints[slot.name] = { p: loudestFrame(s, a, zz) };
    report.cues[slot.name] = { text: slot.text, silent: false, peakDb: l.peakDb, rmsDb: l.rmsDb, crestDb: l.crestDb, bands: sp.shares, centroid: sp.centroid,
      flatness: sp.flatness, above300: sp.above300, ...(slot.kind === 'cue' ? { onsetMs: env.onsetMs, attackMs: env.attackMs, peakAtMs: env.peakAtMs, decayMs: env.decayMs, durationMs: env.durationMs, profile: env.profile } : {}), shape: sp.shape };
  }
  report.coverage = { events: sheetScript.slots.filter(q => q.kind !== 'repeat' && q.kind !== 'sustain').length, voiced: Object.values(report.cues).filter(c => !c.silent).length,
    silent: Object.entries(report.cues).filter(([, c]) => c.silent).map(([n]) => n) };
  // repetition across eight consecutive single trigger pulls
  const rep = sheetScript.slots.filter(q => q.kind === 'repeat'), len = Math.round(.25 * SR), wave = [], pict = [];
  for (let i = 1; i < rep.length; i++) {
    const a = Math.round(rep[i - 1].start * SR), z = Math.round(rep[i].start * SR);
    wave.push(xcorr(s, a, z, len)); pict.push(pearson(patch(s, a, len), patch(s, z, len)));
  }
  report.repetition = levels(s, Math.round(rep[0].start * SR), Math.round(rep[0].start * SR) + len).peak < 3e-4 ? { silent: true }
    : { waveformCorrMean: round(wave.reduce((p, v) => p + v, 0) / wave.length, 3), waveformCorrMax: round(Math.max(...wave), 3), pictureCorrMean: round(pict.reduce((p, v) => p + v, 0) / pict.length, 3) };
  // a held burst: how full it is, and what happens on release
  const sus = sheetScript.slots.find(q => q.kind === 'sustain'), sa = Math.round(sus.start * SR), fireEnd = sa + Math.round(sus.shots * FLY.fireCooldown * SR), frames = [];
  for (let i = sa + SR / 2; i + 240 <= fireEnd; i += 240) frames.push(levels(s, i, i + 240).rms);
  if (Math.max(...frames) < 1e-4) report.burst = { silent: true };
  else {
    const sorted = [...frames].sort((p, q) => p - q), med = sorted[sorted.length >> 1];
    let tail = fireEnd; const lastShot = fireEnd - Math.round(FLY.fireCooldown * SR);
    for (let i = lastShot; i + 480 < s.length && i < lastShot + 2 * SR; i += 480) if (levels(s, i, i + 480).rms > med * .01) tail = i + 480;
    const sp = spectral(s, sa + SR / 2, fireEnd), l = levels(s, sa + SR / 2, fireEnd);
    // Reports per second: peaks of the differenced (high-passed) signal's 2 ms envelope that stand 6 dB
    // above the trough before them. The crack of each round is what separates one report from the next.
    const hf = []; for (let i = sa + SR / 2; i + 96 <= fireEnd; i += 96) { let e = 0; for (let j = i; j < i + 96; j++) { const d = s[j] - s[j - 1]; e += d * d; } hf.push(Math.sqrt(e / 96)); }
    let onsets = 0, trough = hf[0], armed = true;
    for (let i = 1; i < hf.length - 1; i++) {
      if (hf[i] < trough) trough = hf[i];
      if (armed && hf[i] > trough * 2 && hf[i] >= hf[i - 1] && hf[i] >= hf[i + 1]) { onsets++; armed = false; trough = hf[i]; }
      if (!armed && hf[i] < hf[i - 1]) { armed = true; trough = hf[i]; }
    }
    report.burst = { fill: round(frames.filter(v => v > med * .25).length / frames.length, 3), dipDb: round(db(sorted[Math.floor(sorted.length * .1)] / med), 1),
      onsetsPerSecond: round(onsets / (hf.length * .002), 1), releaseTailMs: round((tail - lastShot) / SR * 1000, 0), rmsDb: l.rmsDb, crestDb: l.crestDb, bands: sp.shares, centroid: sp.centroid, flatness: sp.flatness, above300: sp.above300 };
    prints.gunBurst = { p: loudestFrame(s, sa + SR / 2, fireEnd) };
  }
  // distinctness between every pair of voiced one-shots
  const names = sheetScript.slots.filter(q => q.kind === 'cue').map(q => q.name).filter(n => prints[n]);
  const fp = n => report.cues[n] && !report.cues[n].silent ? report.cues[n] : null;
  const pairs = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) pairs.push([names[i], names[j], distance(fp(names[i]), fp(names[j]))]);
  pairs.sort((p, q) => p[2] - q[2]);
  const key = [['hit', 'playerHit'], ['hit', 'enemyGun'], ['playerHit', 'enemyGun'], ['gun', 'enemyGun'], ['gun', 'hit'], ['gun', 'playerHit'], ['kill', 'bombLand'], ['kill', 'playerHit'], ['nearMiss', 'hit'], ['bombLand', 'bombWater'], ['capture', 'raid'], ['landing', 'playerHit']];
  report.distinct = { keyPairs: Object.fromEntries(key.map(([p, q]) => [`${p}/${q}`, distance(fp(p), fp(q))])), closest: pairs.slice(0, 6).map(([p, q, d]) => `${p}/${q} ${d}`),
    minimum: pairs.length ? pairs[0][2] : null, voicedPairs: pairs.length };
  // masking: a cue's loudest 85 ms against the steady engine bed, in the three bands (of 24) where the cue is
  // strongest. The bed is taken un-ducked from the bed-only render, so this is the pessimistic case.
  report.masking = {};
  if (b) {
    const beds = { cruise: psd(b, 5.5 * SR, 7.5 * SR), boost: psd(b, 8.5 * SR, 10.5 * SR) };
    const bedLevel = levels(b, 5.5 * SR, 7.5 * SR);
    report.masking.bed = { cruiseRmsDb: bedLevel.rmsDb, boostRmsDb: levels(b, 8.5 * SR, 10.5 * SR).rmsDb, silent: bedLevel.rms < 1e-4 };
    if (!report.masking.bed.silent) for (const n of ['gunBurst', 'hit', 'enemyGun', 'nearMiss', 'playerHit', 'kill', 'objective', 'raid']) {
      if (!prints[n]) continue;
      const bands = []; for (let k = 0; k < 24; k++) { const lo = 40 * Math.pow(350, k / 24), hi = 40 * Math.pow(350, (k + 1) / 24); bands.push([bandPower(prints[n].p, lo, hi), lo, hi]); }
      const top = [...bands].sort((p, q) => q[0] - p[0]).slice(0, 3), cue = top.reduce((p, v) => p + v[0], 0);
      const out = {};
      for (const [state, pb] of Object.entries(beds)) out[state] = round(db10(cue) - db10(top.reduce((p, v) => p + bandPower(pb, v[1], v[2]), 0)), 1);
      report.masking[n] = { bandsHz: top.map(v => Math.round(Math.sqrt(v[1] * v[2]))), overCruiseDb: out.cruise, overBoostDb: out.boost };
    }
    // The other masker is the player's own gunfire: hits land, and damage arrives, while the trigger is held.
    if (prints.gunBurst) for (const n of ['hit', 'playerHit', 'enemyGun', 'nearMiss']) {
      if (!report.masking[n]) continue;
      const lo = f => f / Math.pow(350, 1 / 48), hi = f => f * Math.pow(350, 1 / 48);
      const cue = report.masking[n].bandsHz.reduce((p, f) => p + bandPower(prints[n].p, lo(f), hi(f)), 0), gun = report.masking[n].bandsHz.reduce((p, f) => p + bandPower(prints.gunBurst.p, lo(f), hi(f)), 0);
      report.masking[n].overGunsDb = round(db10(cue) - db10(gun), 1);
    }
    // engine follows throttle: centroid of the 60–1500 Hz bed per 100 ms, and how fast it answers the boost at 7.5 s
    const track = t0 => { const p = psd(b, t0 * SR, (t0 + .2) * SR, 8192); let n = 0, d = 0; for (let k = 1; k < p.length; k++) { const f = k * SR / 16384; if (f > 60 && f < 1500) { n += f * p[k]; d += p[k]; } } return n / (d || 1); };
    const before = (track(6.6) + track(6.9) + track(7.2)) / 3, after = (track(9.6) + track(9.9) + track(10.2)) / 3;
    let t90 = null; for (let t = 7.5; t < 10; t += .05) if ((track(t) - before) / (after - before || 1) >= .9) { t90 = t - 7.4; break; }   // window centre
    // other aircraft and damage, from the sheet: the loudest 100 ms of a close pass and the steady level of a
    // wingman in formation, both against the plain cruise bed; and how uneven a hurt engine is (spread of 20 ms levels)
    const slotOf = n => sheetScript.slots.find(q => q.name === n), loud = n => { const q = slotOf(n); let top = 0; for (let i = q.start * SR; i + 4800 <= (q.start + q.length) * SR; i += 2400) top = Math.max(top, levels(s, i, i + 4800).rms); return db(top); };
    const steady = n => levels(s, (slotOf(n).start + 1.5) * SR, (slotOf(n).start + 3.8) * SR).rmsDb;
    const rough = n => { const q = slotOf(n), v = []; for (let i = (q.start + 1.5) * SR; i + 960 <= (q.start + 3.8) * SR; i += 960) v.push(levels(s, i, i + 960).rmsDb); const mean = v.reduce((p, x) => p + x, 0) / v.length; return Math.sqrt(v.reduce((p, x) => p + (x - mean) ** 2, 0) / v.length); };
    const others = { flybyOverCruiseDb: round(loud('flybyPass') - steady('engineCruise'), 1), formationOverCruiseDb: round(steady('wingmanFormation') - steady('engineCruise'), 1),
      unevenCruiseDb: round(rough('engineCruise'), 2), unevenHurtDb: round(rough('engineHurt'), 2) };
    report.engine = { ...others, centroidIdle: round(track(1), 0), centroidCruise: round(before, 0), centroidBoost: round(after, 0), centroidBrakeTurn: round((track(12.6) + track(12.9)) / 2, 0),
      boostResponseS: round(t90, 2), idleRmsDb: levels(b, .8 * SR, 1.8 * SR).rmsDb, cruiseRmsDb: bedLevel.rmsDb, boostRmsDb: report.masking.bed.boostRmsDb,
      turnRmsDb: levels(b, 12 * SR, 13.4 * SR).rmsDb, landedAfterRmsDb: levels(b, 43.5 * SR, 44.8 * SR).rmsDb };
  }
  // latency of feedback cues inside the full mix cannot be separated from the bed, so it is read off the sheet
  report.sync = Object.fromEntries(['gun', 'hit', 'playerHit', 'enemyGun', 'kill', 'bombLand', 'ui', 'overheat'].map(n => [n, report.cues[n]?.silent === false ? { onsetMs: report.cues[n].onsetMs, attackMs: report.cues[n].attackMs } : null]));
  return report;
}

// --- main -----------------------------------------------------------------------
function serve() {
  const cache = new Map();
  const types = { '.js': 'text/javascript', '.html': 'text/html' };
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      try {
        let body;
        if (url === '/harness.html') body = '<!doctype html><meta charset=utf-8><title>audio harness</title>';
        else if (url.startsWith('/mine/')) body = fs.readFileSync(path.join(ROOT, url.slice(6)));
        else if (url.startsWith('/theirs/')) body = fs.readFileSync(path.join(THEIRS, url.slice(8)));
        else if (url.startsWith('/main/')) { if (!cache.has(url)) cache.set(url, execFileSync('git', ['show', `${process.env.AUDIO_MAIN_REF || 'main'}:${url.slice(6)}`], { cwd: ROOT })); body = cache.get(url); }
        else throw new Error('not found');
        res.writeHead(200, { 'Content-Type': types[path.extname(url)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(body);
      } catch (e) { res.writeHead(404); res.end(String(e.message)); }
    }).listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve(), base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const seqScript = buildSequence(), sheetScript = buildSheet();
  fs.writeFileSync(path.join(OUT, 'cues.json'), JSON.stringify({ seconds: SEQ_SECONDS, sampleRate: SR, sequence: seqScript.cues,
    sheet: sheetScript.slots.map(({ name, text, start, length }) => ({ name, text, start, length })) }, null, 1));
  for (const source of SOURCES) {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${base}/harness.html`);
    const started = Date.now();
    const render = async (script, mono, bedOnly) => {
      const r = await page.evaluate(renderInPage, { source, events: script.events, seconds: script.seconds, sr: SR, mono, bedOnly });
      r.pcmBuf = Buffer.from(r.pcm, 'base64'); delete r.pcm; return r;
    };
    const seq = await render(seqScript, false, false), sheet = await render(sheetScript, true, false), bed = await render(seqScript, true, true);
    const files = { seq: path.join(OUT, `${source}.wav`), sheet: path.join(OUT, `${source}-sheet.wav`) };
    wav(files.seq, seq.pcmBuf, 2); wav(files.sheet, sheet.pcmBuf, 1);
    const report = analyse(source, seq, seqScript, sheet, sheetScript, bed, files);
    report.pageErrors = errors; report.renderSeconds = round((Date.now() - started) / 1000, 1);
    fs.writeFileSync(path.join(OUT, `${source}.report.json`), JSON.stringify(report, null, 1));
    spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', files.seq, '-lavfi', 'showspectrumpic=s=1800x700:legend=1:fscale=log:drange=96:color=magma', path.join(OUT, `${source}.png`)]);
    if (!fs.existsSync(path.join(OUT, `${source}.png`))) spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', files.seq, '-lavfi', 'showspectrumpic=s=1800x700:legend=1', path.join(OUT, `${source}.png`)]);
    if (source === 'mine' && process.env.AUDIO_CLIPS) {
      // Short clips of the cues that matter most, cut from the sheet for A/B listening.
      const want = ['gun', 'hit', 'kill', 'enemyGun', 'nearMiss', 'playerHit', 'overheat', 'bombLand', 'bombWater', 'torpedoHit', 'shipSunk', 'landing', 'takeoff', 'capture', 'raid', 'objective', 'gunSustain', 'engineIdle', 'engineCruise', 'engineBoost', 'engineBrakeTurn', 'engineHurt'];
      for (const slot of sheetScript.slots.filter(q => want.includes(q.name))) {
        const a = Math.max(0, Math.round((slot.start - .05) * SR)) * 2, z = Math.round((slot.start + slot.length) * SR) * 2;
        wav(path.join(OUT, `mine-${slot.name}.wav`), sheet.pcmBuf.subarray(a, z), 1);
      }
    }
    const m = report.mix;
    console.log(`${source.padEnd(7)} peak ${m.samplePeakDb} dBFS  clipped ${m.clippedSamples}  ${m.integratedLufs} LUFS  LRA ${m.loudnessRangeLu}  crest ${m.crestDb} dB  cues ${report.coverage.voiced}/${report.coverage.events}  render ${report.renderSeconds}s${errors.length ? '  PAGE ERRORS: ' + errors.join(' | ') : ''}`);
    await page.close();
  }
  await browser.close(); server.close();
  if (!process.env.AUDIO_NO_SCORE) require('./audio-score.cjs').run(OUT, SOURCES);
})().catch(e => { console.error(e); process.exit(1); });
