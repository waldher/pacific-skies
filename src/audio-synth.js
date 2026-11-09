// Pure DSP for the sound system: every cue and loop is synthesised here into
// plain Float32Arrays. No AudioContext, no globals, no gameplay RNG: the same
// seed always yields the same samples, in the browser or in Node.
// Design notes for each sound (what the real thing is, which layer stands in
// for which part of it) live in playtest/climb/AUDIO.md.
const TAU = Math.PI * 2;

/** Private mulberry32 stream. Audio must never draw from util.js rand(). */
export function makeRng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ t >>> 15, 1 | t);
    r ^= r + Math.imul(r ^ r >>> 7, 61 | r);
    return ((r ^ r >>> 14) >>> 0) / 4294967296;
  };
}

// --- primitives ---------------------------------------------------------------
// RBJ biquad, in place. `circular` runs the array twice and keeps the second
// pass, which is the periodic steady state a seamless loop needs.
function bq(x, sr, type, f, q = .707, db = 0, circular = false) {
  const w = TAU * Math.min(f, sr * .45) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  if (type === 'lp') { b1 = 1 - c; b0 = b2 = b1 / 2; }
  else if (type === 'hp') { b1 = -(1 + c); b0 = b2 = (1 + c) / 2; }
  else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; }
  else { const A = Math.pow(10, db / 40); b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a2 = 1 - al / A; }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let pass = circular ? 0 : 1; pass < 2; pass++) for (let i = 0; i < x.length; i++) {
    const v = x[i], y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = y;
    if (pass) x[i] = y;
  }
  return x;
}
function white(n, rng) { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = rng() * 2 - 1; return x; }
function rmsOf(x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, x.length)); }

// Filtered noise with an attack/decay envelope, mixed into `out` at time t.
// The filtered noise is scaled to unit RMS first, so `g` is a level, whatever the band.
function noise(out, sr, rng, { t = 0, dur, a = .001, d, lp, hp, bp, q = 1, g = 1, am }) {
  const i0 = Math.round(t * sr), n = Math.min(out.length - i0, Math.ceil(dur * sr));
  if (n <= 8) return;
  const x = white(n, rng);
  if (hp) bq(x, sr, 'hp', hp); if (lp) bq(x, sr, 'lp', lp); if (bp) bq(x, sr, 'bp', bp, q);
  const k = g / (rmsOf(x) || 1), fade = Math.min(n / 2, .004 * sr);
  for (let i = 0; i < n; i++) {
    const ts = i / sr;
    let e = Math.min(1, ts / a) * Math.min(1, (n - 1 - i) / fade);
    if (d) e *= Math.exp(-ts / d);
    if (am) e *= am(ts);
    out[i0 + i] += k * x[i] * e;
  }
}
// A pitched partial gliding from f0 to f1 (time constant ft), optional harmonics.
function tone(out, sr, { t = 0, dur, f0, f1 = f0, ft = .05, a = .001, d, g = 1, h = [1], vib = 0, vibHz = 6 }) {
  const i0 = Math.round(t * sr), n = Math.min(out.length - i0, Math.ceil(dur * sr)), fade = Math.min(n / 2, .004 * sr);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const ts = i / sr, f = (f1 + (f0 - f1) * Math.exp(-ts / ft)) * (1 + vib * Math.sin(TAU * vibHz * ts));
    ph += TAU * f / sr;
    let e = Math.min(1, ts / a) * Math.min(1, (n - 1 - i) / fade);
    if (d) e *= Math.exp(-ts / d);
    let s = 0;
    for (let k = 0; k < h.length; k++) if (h[k] && f * (k + 1) < sr * .45) s += h[k] * Math.sin(ph * (k + 1));
    out[i0 + i] += g * e * s;
  }
}
// Struck-object modes: a bank of decaying sines [frequency, decay seconds, gain].
function modes(out, sr, { t = 0, list, g = 1, wrap = false }) {
  const i0 = Math.round(t * sr), N = out.length;
  for (const [f, tau, mg] of list) {
    if (f > sr * .45) continue;
    const n = Math.ceil(tau * 7 * sr), w = TAU * f / sr;
    for (let i = 0; i < n; i++) {
      let j = i0 + i;
      if (j >= N) { if (!wrap) break; j %= N; }
      out[j] += g * mg * Math.exp(-i / (tau * sr)) * Math.sin(w * i) * Math.min(1, i / 6);
    }
  }
}
// Noise through a band-pass whose centre sweeps f0 → f1 (TPT state-variable filter).
function sweep(out, sr, rng, { t = 0, dur, f0, f1, q = 4, g = 1, a = .01, d }) {
  const i0 = Math.round(t * sr), n = Math.min(out.length - i0, Math.ceil(dur * sr)), fade = Math.min(n / 2, .006 * sr);
  let ic1 = 0, ic2 = 0;
  const tmp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / n, f = f0 * Math.pow(f1 / f0, u), gg = Math.tan(Math.PI * Math.min(f, sr * .45) / sr), k = 1 / q;
    const a1 = 1 / (1 + gg * (gg + k)), a2 = gg * a1, a3 = gg * a2, v0 = rng() * 2 - 1;
    const v3 = v0 - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    const ts = i / sr;
    let e = Math.min(1, ts / a) * Math.min(1, (n - 1 - i) / fade);
    if (d) e *= Math.exp(-Math.max(0, ts - a) / d);
    tmp[i] = v1 * e;
  }
  const k = g / (rmsOf(tmp) * 2.5 || 1);
  for (let i = 0; i < n; i++) out[i0 + i] += tmp[i] * k;
}
function saturate(x, drive) { const k = 1 / Math.tanh(drive); for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive) * k; return x; }
// Peak-normalise and close with a short fade so a buffer never ends on a step.
function finish(x, sr, peak) {
  let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  const k = peak / (m || 1), fade = Math.min(x.length, Math.round(.012 * sr));
  for (let i = 0; i < x.length; i++) x[i] *= k * Math.min(1, (x.length - 1 - i) / fade);
  return x;
}
const mk = (sr, sec) => new Float32Array(Math.ceil(sr * sec));
const jit = (rng, amount) => 1 + (rng() * 2 - 1) * amount;

// --- guns -----------------------------------------------------------------------
// One .50-cal report heard from the cockpit: supersonic crack, muzzle blast
// body, then the bolt slamming home a few hundredths later.
function report(out, sr, rng, t, g, tune) {
  noise(out, sr, rng, { t, dur: .022, a: .0003, d: .0034, hp: 1300, bp: 2500 * tune, q: .7, g: .95 * g });
  tone(out, sr, { t, dur: .07, f0: 240 * tune, f1: 105, ft: .013, a: .0006, d: .018, g: .8 * g });
  noise(out, sr, rng, { t, dur: .05, a: .0008, d: .015, bp: 520 * tune, q: .6, g: .75 * g });
  modes(out, sr, { t: t + .026 + rng() * .007, g: .17 * g, list: [[2150 * tune, .007, 1], [3450 * tune, .005, .7], [5300 * jit(rng, .06), .004, .5]] });
}
// A trigger-pull's worth of battery fire: `pairs` of guns, each at its own
// rate near 13 rounds/s and never synchronised. Slices tile at the game's fire cadence.
function gunSlice(sr, rng, dur, pairs) {
  const out = mk(sr, dur + .27);
  pairs.forEach(([rate, gain, tune], p) => {
    let t = p ? rng() / rate : 0;                     // the first report lands on the trigger
    while (t < dur - .004) { report(out, sr, rng, t, gain * jit(rng, .12), tune * jit(rng, .035)); t += jit(rng, .05) / rate; }
  });
  noise(out, sr, rng, { dur: dur + .06, a: .008, d: dur * 1.4, lp: 120, hp: 35, g: .14 });           // wing structure drumming
  noise(out, sr, rng, { t: dur * .5, dur: .24, a: .03, d: .06, lp: 1700, hp: 220, g: .1 });          // air closing behind the burst
  bq(out, sr, 'lp', 4600);                              // leave the top octaves to the strikes
  return finish(saturate(out, 1.5), sr, .92);
}
function gunTail(sr, rng) {
  const out = mk(sr, .85);
  modes(out, sr, { t: .012, g: .4, list: [[1900 * jit(rng, .05), .012, 1], [3100, .008, .6], [640, .02, .5]] });  // last bolt home
  noise(out, sr, rng, { dur: .8, a: .015, d: .15, lp: 1500, hp: 160, g: .55 });                      // report rolling away
  noise(out, sr, rng, { t: .1 + rng() * .03, dur: .3, a: .01, d: .05, lp: 800, hp: 120, g: .22 });   // slap back off the water
  for (let i = 0; i < 4; i++)                                                                        // spent brass
    modes(out, sr, { t: .08 + rng() * .45, g: .035, list: [[5200 * jit(rng, .15), .012, 1], [7900 * jit(rng, .1), .008, .6]] });
  return finish(out, sr, .55);
}
function overheat(sr, rng) {
  const out = mk(sr, 1.15);
  modes(out, sr, { g: 1, list: [[410 * jit(rng, .05), .035, 1], [930, .022, .7], [1720, .012, .5], [2900, .006, .3]] }); // bolts stop
  noise(out, sr, rng, { dur: .012, a: .0004, d: .003, hp: 1500, g: .7 });
  const flutter = rng() * TAU;
  noise(out, sr, rng, { t: .03, dur: 1.1, a: .04, d: .34, hp: 3200, lp: 9000, g: .34, am: ts => .7 + .3 * Math.sin(41 * ts + flutter) }); // hot barrels hissing
  for (let i = 0; i < 7; i++) noise(out, sr, rng, { t: .1 + rng() * .85, dur: .008, a: .0003, d: .002, hp: 2500, g: .16 });  // metal ticking
  return finish(out, sr, .7);
}
function gunReady(sr, rng) {
  const out = mk(sr, .34);
  for (const [t, tune] of [[0, 1], [.085 + rng() * .02, 1.22]]) {                                    // charging handle back, then home
    modes(out, sr, { t, g: 1, list: [[520 * tune * jit(rng, .05), .02, 1], [1250 * tune, .012, .8], [2600 * tune, .006, .5]] });
    noise(out, sr, rng, { t, dur: .01, a: .0004, d: .0025, hp: 1800, g: .5 });
  }
  return finish(out, sr, .5);
}

// --- hits -----------------------------------------------------------------------
// A round through aluminium skin: a bright click and a short sheet-metal ring.
function hitDealt(sr, rng) {
  // Pitched above the guns' own crack (2–3 kHz) so a strike reads through a held burst.
  const out = mk(sr, .14), base = 4300 * jit(rng, .18);
  noise(out, sr, rng, { dur: .006, a: .0002, d: .0013, hp: 4000, g: 1 });
  modes(out, sr, { g: .8, list: [[base, .024, 1], [base * 1.59 * jit(rng, .05), .03, .8], [base * 2.31 * jit(rng, .05), .02, .6], [base * 3.2 * jit(rng, .05), .012, .4]] });
  tone(out, sr, { dur: .03, f0: 420, f1: 250, ft: .01, d: .008, g: .25 });
  return finish(out, sr, .8);
}
// Rounds on a steel hull: lower, duller, sometimes a ricochet.
function hitHull(sr, rng) {
  const out = mk(sr, .3), base = 720 * jit(rng, .15);
  noise(out, sr, rng, { dur: .008, a: .0003, d: .002, hp: 1200, g: .8 });
  modes(out, sr, { g: .8, list: [[base, .05, 1], [base * 1.72, .035, .7], [base * 2.9, .02, .5]] });
  if (rng() < .5) tone(out, sr, { t: .01, dur: .22, f0: 3600 * jit(rng, .2), f1: 1500, ft: .09, a: .004, d: .06, g: .12 });
  return finish(out, sr, .7);
}
// Being hit is felt, not seen: a punch through your own airframe, low and
// crunching, with loose structure rattling afterwards.
function hitTaken(sr, rng) {
  const out = mk(sr, .4), gap = .042 + rng() * .02;
  for (const [t, g] of [[0, 1], [gap, .75]]) {                                                       // in one side, out the other
    tone(out, sr, { t, dur: .12, f0: 330 * jit(rng, .1), f1: 150, ft: .012, a: .0008, d: .03, g });
    noise(out, sr, rng, { t, dur: .07, a: .0008, d: .016, bp: 420 * jit(rng, .15), q: 1.1, g: .8 * g });
  }
  const plate = 1150 * jit(rng, .12);                                                                // the armour plate behind the seat rings
  modes(out, sr, { t: .003, g: .45, list: [[plate, .06, 1], [plate * 1.47, .045, .8], [plate * 2.09, .03, .5]] });
  modes(out, sr, { t: .02, g: .3, list: [[310 * jit(rng, .08), .06, 1], [455 * jit(rng, .08), .05, .8], [735 * jit(rng, .08), .04, .6]] });
  return finish(saturate(out, 2.2), sr, .9);
}
function collision(sr, rng) {
  const out = mk(sr, .8);
  tone(out, sr, { dur: .35, f0: 140, f1: 48, ft: .04, d: .1, g: 1 });
  noise(out, sr, rng, { dur: .4, a: .002, d: .09, bp: 900, q: .6, g: .9, am: ts => .6 + .4 * Math.sin(170 * ts) });   // skin tearing
  sweep(out, sr, rng, { t: .03, dur: .3, f0: 2600, f1: 700, q: 6, g: .35, a: .02, d: .1 });                       // metal scraping
  modes(out, sr, { t: .01, g: .4, list: [[265, .16, 1], [530, .1, .7], [845, .07, .6], [1420, .04, .4]] });
  return finish(saturate(out, 2.5), sr, .9);
}

// --- other people's guns --------------------------------------------------------
// Rifle-calibre cowl guns heard across open air: a thin, hollow, fast triple.
function enemyGun(sr, rng) {
  const out = mk(sr, .55), rate = 17 * jit(rng, .1), bp = 1900 * jit(rng, .12);
  for (let k = 0; k < 4; k++) {
    const t = k / rate * jit(rng, .04), g = 1 - k * .08;
    noise(out, sr, rng, { t, dur: .04, a: .0004, d: .009, bp, q: 1.2, g });
    noise(out, sr, rng, { t, dur: .012, a: .0003, d: .003, hp: 2600, g: .5 * g });
  }
  noise(out, sr, rng, { t: .06, dur: .48, a: .04, d: .11, bp: 1100, q: .6, g: .13 });               // the burst echoing off the sea
  return finish(bq(out, sr, 'lp', 5200), sr, .8);
}
// A round passing close: no report, just the air being torn, falling in pitch.
function whiz(sr, rng) {
  const out = mk(sr, .36), dur = .2 + rng() * .1;
  sweep(out, sr, rng, { dur, f0: 3800 * jit(rng, .15), f1: 700 * jit(rng, .2), q: 4, g: 1, a: dur * .3, d: dur * .25 });
  noise(out, sr, rng, { t: dur * .28, dur: .012, a: .0005, d: .003, hp: 3000, g: .5 });               // the tiny shock as it passes
  return finish(out, sr, .7);
}
// Ship's AA mount: slow, deep, with the report rolling across the water.
function shipGun(sr, rng) {
  const out = mk(sr, .95);
  tone(out, sr, { dur: .4, f0: 115 * jit(rng, .08), f1: 44, ft: .04, d: .13, g: 1 });
  noise(out, sr, rng, { dur: .04, a: .0005, d: .01, bp: 900, q: .7, g: .8 });
  noise(out, sr, rng, { dur: .25, a: .002, d: .06, lp: 380, g: .7 });
  noise(out, sr, rng, { t: .07, dur: .85, a: .05, d: .2, lp: 700, hp: 100, g: .22 });
  return finish(saturate(out, 1.6), sr, .85);
}

// --- explosions -----------------------------------------------------------------
// An aircraft coming apart: fuel going up, then pieces of it.
function boomSmall(sr, rng) {
  const out = mk(sr, 1.05);
  noise(out, sr, rng, { dur: .03, a: .0003, d: .006, hp: 1500, g: 1 });
  tone(out, sr, { dur: .35, f0: 150 * jit(rng, .1), f1: 62, ft: .04, d: .09, g: .7 });
  noise(out, sr, rng, { dur: .45, a: .002, d: .09, bp: 480, q: .5, g: 1 });                         // fuel going up: a whump, not a thud
  const rate = 15 + rng() * 8, ph = rng() * TAU;
  noise(out, sr, rng, { t: .04, dur: .95, a: .04, d: .22, lp: 2200, hp: 350, g: .38, am: ts => .6 + .4 * Math.sin(rate * TAU * ts + ph) }); // burning
  for (let i = 0; i < 8; i++) {                                                                      // torn metal
    const f = 700 + rng() * 2600;
    modes(out, sr, { t: .05 + rng() * .45, g: .13, list: [[f, .03 + rng() * .04, 1], [f * 1.63, .02, .6]] });
  }
  return finish(saturate(out, 1.8), sr, .9);
}
// A 500 lb bomb or a magazine: the thump in the chest, the crack, a long rumble.
function boomBig(sr, rng) {
  const out = mk(sr, 2.6);
  noise(out, sr, rng, { dur: .03, a: .0003, d: .005, hp: 1200, g: 1 });
  noise(out, sr, rng, { dur: .2, a: .001, d: .05, bp: 1400, q: .6, g: 1 });
  tone(out, sr, { dur: 1.2, f0: 70 * jit(rng, .08), f1: 27, ft: .11, a: .002, d: .4, g: 1.25 });
  tone(out, sr, { dur: .6, f0: 150, f1: 62, ft: .05, a: .001, d: .14, g: .7 });                      // the part a small speaker can carry
  noise(out, sr, rng, { dur: .9, a: .003, d: .2, lp: 420, hp: 40, g: 1 });
  const ph = rng() * TAU;
  noise(out, sr, rng, { t: .1, dur: 2.45, a: .12, d: .65, lp: 190, hp: 30, g: .55, am: ts => .7 + .3 * Math.sin(5.3 * ts + ph) });
  noise(out, sr, rng, { t: .08, dur: 1.6, a: .1, d: .38, lp: 1300, hp: 300, g: .3 });
  return finish(saturate(out, 2), sr, .95);
}
// Earth and coral coming back down.
function debrisLand(sr, rng) {
  const out = mk(sr, 2);
  for (let i = 0; i < 46; i++) {
    const t = .25 + Math.pow(rng(), .7) * 1.6, g = .5 * (1 - (t - .25) / 1.9) * (.4 + rng() * .6);
    noise(out, sr, rng, { t, dur: .03 + rng() * .04, a: .001, d: .008 + rng() * .012, bp: 900 + rng() * 2600, q: 1.2, g });
  }
  noise(out, sr, rng, { t: .2, dur: 1.7, a: .25, d: .5, bp: 1800, q: .5, g: .16 });
  return finish(out, sr, .5);
}
// The column of water a near miss throws up, hanging, then collapsing as hiss.
function plume(sr, rng) {
  const out = mk(sr, 2.6);
  noise(out, sr, rng, { dur: .25, a: .004, d: .07, bp: 1500, q: .5, g: .7 });
  noise(out, sr, rng, { t: .15, dur: 2.4, a: .35, d: .55, hp: 1600, lp: 7500, g: .8 });
  noise(out, sr, rng, { t: .1, dur: 2, a: .3, d: .5, bp: 700, q: .6, g: .3 });
  for (let i = 0; i < 24; i++) noise(out, sr, rng, { t: .7 + rng() * 1.5, dur: .03, a: .002, d: .01, bp: 2500 + rng() * 3000, q: 2, g: .12 });
  return finish(out, sr, .6);
}
// A bomb that missed: the detonation is under water, so the crack never arrives.
function bombWater(sr, rng) {
  const out = plume(sr, rng);
  tone(out, sr, { dur: .7, f0: 82 * jit(rng, .1), f1: 30, ft: .09, a: .004, d: .22, g: .5 });
  noise(out, sr, rng, { dur: .5, a: .006, d: .12, lp: 260, g: .4 });
  tone(out, sr, { dur: .4, f0: 190, f1: 90, ft: .05, a: .003, d: .09, g: .35 });
  return finish(out, sr, .85);
}
// Plating: what a ship adds to a hit.
function debrisShip(sr, rng) {
  const out = mk(sr, 2.2), base = 150 * jit(rng, .12);
  modes(out, sr, { g: .9, list: [[base, .5, 1], [base * 1.58, .38, .8], [base * 2.44, .3, .7], [base * 3.9, .2, .5], [base * 6.2, .1, .35]] });
  for (let i = 0; i < 5; i++) { const f = 400 + rng() * 1500; modes(out, sr, { t: .15 + rng() * .8, g: .12, list: [[f, .07, 1], [f * 1.7, .05, .6]] }); }
  noise(out, sr, rng, { t: .1, dur: 2, a: .2, d: .5, hp: 2200, lp: 8000, g: .14 });
  return finish(out, sr, .6);
}
// A hull going down: steam venting and the structure groaning.
function shipSink(sr, rng) {
  const out = mk(sr, 3.4), ph = rng() * TAU;
  noise(out, sr, rng, { dur: 3.3, a: .3, d: 1.1, hp: 1900, lp: 8500, g: .5, am: ts => .65 + .35 * Math.sin(3.1 * ts + ph) * Math.sin(17 * ts) });
  tone(out, sr, { t: .3, dur: 2.6, f0: 92 * jit(rng, .1), f1: 54, ft: 1.1, a: .4, d: 1.2, g: .6, h: [1, .6, .45, .3, .2, .12], vib: .03, vibHz: 2.3 });
  for (let i = 0; i < 5; i++) { const f = 180 + rng() * 300; modes(out, sr, { t: .4 + rng() * 2, g: .16, list: [[f, .22, 1], [f * 1.5, .15, .6], [f * 2.76, .08, .4]] }); }
  noise(out, sr, rng, { t: .5, dur: 2.6, a: .5, d: .9, lp: 300, hp: 40, g: .4 });
  return finish(out, sr, .6);
}

// --- ordnance -------------------------------------------------------------------
function bombRelease(sr, rng) {
  const out = mk(sr, 1);
  modes(out, sr, { g: 1, list: [[300 * jit(rng, .06), .035, 1], [655, .022, .8], [1120, .014, .6], [2400, .006, .3]] });   // shackle opening
  noise(out, sr, rng, { dur: .012, a: .0004, d: .003, hp: 1500, g: .6 });
  // Film convention rather than cockpit reality: the fall marked by a dropping whistle.
  tone(out, sr, { t: .06, dur: .78, f0: 2500 * jit(rng, .06), f1: 1150, ft: .45, a: .08, d: .42, g: .16, h: [1, .25, .1], vib: .006, vibHz: 31 });
  sweep(out, sr, rng, { t: .06, dur: .78, f0: 2600, f1: 1300, q: 9, g: .1, a: .1, d: .4 });
  return finish(out, sr, .6);
}
// Shackle, the splash of entry, then the torpedo running away from you.
function torpedoDrop(sr, rng) {
  const out = mk(sr, 3);
  modes(out, sr, { g: .8, list: [[240 * jit(rng, .06), .04, 1], [520, .025, .8], [980, .014, .5]] });
  noise(out, sr, rng, { t: .16, dur: .5, a: .004, d: .1, bp: 1700, q: .5, g: .8 });
  tone(out, sr, { t: .16, dur: .35, f0: 120, f1: 50, ft: .05, d: .09, g: .8 });
  const f = 300 * jit(rng, .05), ph = rng() * TAU;
  tone(out, sr, { t: .3, dur: 2.6, f0: f, f1: f * .97, ft: 1, a: .15, d: .9, g: .22, h: [1, .5, .35, .2, .1], vib: .004, vibHz: 23 });
  tone(out, sr, { t: .3, dur: 2.6, f0: f * 1.027, f1: f, ft: 1, a: .15, d: .9, g: .16, h: [1, .4, .25] });   // contra-rotating screws beating
  noise(out, sr, rng, { t: .3, dur: 2.6, a: .2, d: .8, lp: 650, hp: 120, g: .22, am: ts => .6 + .4 * Math.sin(24 * TAU * ts + ph) });
  return finish(out, sr, .6);
}
function torpedoHit(sr, rng) {
  const out = plume(sr, rng), base = 138 * jit(rng, .1);
  tone(out, sr, { dur: 1.2, f0: 56 * jit(rng, .08), f1: 24, ft: .12, a: .006, d: .42, g: 1.5 });
  tone(out, sr, { dur: .5, f0: 160, f1: 70, ft: .05, a: .004, d: .12, g: .6 });
  noise(out, sr, rng, { dur: .8, a: .008, d: .2, lp: 210, g: 1 });
  modes(out, sr, { t: .02, g: .5, list: [[base, .55, 1], [base * 1.69, .4, .8], [base * 2.83, .28, .6], [base * 4.4, .15, .4]] });   // the hull rings
  return finish(saturate(out, 1.6), sr, .92);
}

// --- deck and runway ------------------------------------------------------------
// Wheels on the planks, then the hook taking a wire: steel cable paying out against the brake.
function arrestWire(sr, rng) {
  const out = mk(sr, 1.5);
  tone(out, sr, { dur: .25, f0: 110, f1: 55, ft: .03, d: .07, g: 1 });
  modes(out, sr, { g: .5, list: [[185 * jit(rng, .08), .07, 1], [330, .05, .7], [610, .03, .5]] });
  sweep(out, sr, rng, { t: .05, dur: .85, f0: 3300 * jit(rng, .1), f1: 850, q: 8, g: .5, a: .04, d: .3 });
  tone(out, sr, { t: .05, dur: .8, f0: 1900, f1: 520, ft: .25, a: .03, d: .25, g: .08, h: [1, .5, .3], vib: .02, vibHz: 37 });
  noise(out, sr, rng, { t: .05, dur: 1.2, a: .05, d: .3, lp: 300, hp: 40, g: .5 });
  modes(out, sr, { t: .9, g: .3, list: [[240, .08, 1], [480, .05, .6], [1300, .02, .3]] });           // hook drops the wire
  return finish(out, sr, .75);
}
// A strip landing: two chirps of rubber and the roll-out.
function touchdown(sr, rng) {
  const out = mk(sr, 1.4);
  for (const t of [0, .09 + rng() * .05]) {
    sweep(out, sr, rng, { t, dur: .09, f0: 2300 * jit(rng, .1), f1: 1300, q: 7, g: .5, a: .004, d: .03 });
    tone(out, sr, { t, dur: .2, f0: 95, f1: 50, ft: .03, d: .06, g: .8 });
  }
  noise(out, sr, rng, { t: .05, dur: 1.3, a: .06, d: .4, lp: 260, hp: 35, g: .7, am: ts => .75 + .25 * Math.sin(TAU * (26 - 12 * ts) * ts) });
  noise(out, sr, rng, { t: .05, dur: 1.2, a: .05, d: .3, bp: 900, q: .5, g: .1 });
  return finish(out, sr, .7);
}
// Chocks away and the run: wheels drumming faster until they leave the ground.
function takeoffRoll(sr, rng) {
  const out = mk(sr, 2.6);
  modes(out, sr, { g: .5, list: [[210 * jit(rng, .08), .05, 1], [470, .03, .7], [1050, .012, .4]] });
  let t = .12, gap = .16;
  while (t < 1.9) {
    const g = .5 * Math.min(1, t / .4) * Math.min(1, (1.95 - t) / .5);
    tone(out, sr, { t, dur: .06, f0: 120, f1: 70, ft: .01, d: .015, g });
    noise(out, sr, rng, { t, dur: .03, a: .001, d: .008, bp: 600, q: 1, g: g * .4 });
    gap = Math.max(.028, gap * .9); t += gap * jit(rng, .08);
  }
  noise(out, sr, rng, { t: .1, dur: 2.1, a: .5, d: .9, lp: 240, hp: 35, g: .45 });
  return finish(out, sr, .6);
}

// --- signals --------------------------------------------------------------------
// A ship's bell: inharmonic partials over a hum note, struck with a clapper.
function bellStrike(out, sr, rng, t, f, g) {
  const ratios = [.5, 1, 1.19, 1.5, 2, 2.51, 3.01, 4.16, 5.43], amps = [.45, 1, .6, .3, .75, .32, .28, .14, .08];
  modes(out, sr, { t, g, list: ratios.map((r, i) => [f * r * jit(rng, .002), 1.5 / Math.pow(r, .85), amps[i]]) });
  noise(out, sr, rng, { t, dur: .012, a: .0004, d: .003, bp: 3200, q: .8, g: g * .5 });
}
function bells(sr, rng, strikes, f, sec) {
  const out = mk(sr, sec);
  for (const [t, g] of strikes) bellStrike(out, sr, rng, t, f * jit(rng, .003), g);
  return finish(out, sr, .6);
}
// Radio: the squelch opening on a carrier, band-limited static, and closing.
function squelch(sr, rng) {
  const out = mk(sr, .3), dur = .13 + rng() * .05;
  noise(out, sr, rng, { dur, a: .003, hp: 500, bp: 1900, q: .6, g: .5, am: ts => .8 + .2 * Math.sin(310 * ts) });
  for (const t of [0, dur]) { noise(out, sr, rng, { t, dur: .01, a: .0003, d: .002, bp: 1500, q: .8, g: 1 }); tone(out, sr, { t, dur: .02, f0: 900, f1: 500, ft: .004, d: .005, g: .4 }); }
  return finish(out, sr, .4);
}
// Hand-cranked air-raid siren: two rotors a minor third apart winding up and running down.
function siren(sr, rng) {
  const out = mk(sr, 3), n = out.length;
  let p1 = 0, p2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, up = 1 - Math.exp(-t / .45), down = t > 1.7 ? Math.exp(-(t - 1.7) / .9) : 1;
    const f = (210 + 330 * up) * (.45 + .55 * down), e = Math.min(1, t / .25) * (t > 1.7 ? Math.exp(-(t - 1.7) / .55) : 1);
    p1 += TAU * f / sr; p2 += TAU * f * 1.2 / sr;
    let s = 0;
    for (let h = 1; h <= 9; h++) s += (Math.sin(p1 * h) + .6 * Math.sin(p2 * h)) / Math.pow(h, 1.05);
    out[i] = s * e * (.9 + .1 * Math.sin(TAU * 11 * t));
  }
  noise(out, sr, rng, { dur: 2.9, a: .3, d: 1.4, bp: 1200, q: .5, g: .12 });
  bq(out, sr, 'lp', 2600); bq(out, sr, 'hp', 180);
  return finish(out, sr, .5);
}
// A cockpit toggle switch.
function switchClick(sr, rng) {
  const out = mk(sr, .07);
  noise(out, sr, rng, { dur: .006, a: .0002, d: .0012, hp: 1500, g: 1 });
  modes(out, sr, { g: .6, list: [[1380 * jit(rng, .1), .007, 1], [2650 * jit(rng, .1), .005, .7], [620, .01, .5]] });
  modes(out, sr, { t: .022, g: .25, list: [[1700 * jit(rng, .1), .005, 1], [3300, .003, .6]] });
  return finish(out, sr, .4);
}
// The player's aircraft going in: the engine over-revving in the dive, wind rising.
function playerDown(sr, rng) {
  const out = mk(sr, 2.2);
  tone(out, sr, { dur: 2.1, f0: 150, f1: 420, ft: 1.3, a: .1, d: 1.6, g: .5, h: [1, .7, .5, .4, .3, .2, .15, .1], vib: .02, vibHz: 9 });
  noise(out, sr, rng, { dur: 2.1, a: .8, d: 1.5, bp: 1300, q: .5, g: .35 });
  for (let i = 0; i < 9; i++) noise(out, sr, rng, { t: .1 + rng() * 1.6, dur: .05, a: .001, d: .012, lp: 700, g: .5 });  // dying cylinders
  return finish(out, sr, .55);
}

/** Every one-shot bank: how many variations and how to make one. */
export const BANKS = {
  gunHeavy: { n: 6, make: (sr, r) => gunSlice(sr, r, .13, [[12.7, 1, 1], [13.5, .82, 1.07], [14.3, .66, .93]]) },
  gunLight: { n: 5, make: (sr, r) => gunSlice(sr, r, .23, [[12.9, 1, 1.05], [13.8, .8, .97]]) },
  gunTail: { n: 3, make: gunTail },
  overheat: { n: 2, make: overheat },
  gunReady: { n: 2, make: gunReady },
  hitDealt: { n: 8, make: hitDealt },
  hitHull: { n: 5, make: hitHull },
  hitTaken: { n: 5, make: hitTaken },
  collision: { n: 2, make: collision },
  enemyGun: { n: 5, make: enemyGun },
  whiz: { n: 6, make: whiz },
  shipGun: { n: 4, make: shipGun },
  boomSmall: { n: 4, make: boomSmall },
  boomBig: { n: 3, make: boomBig },
  debrisLand: { n: 2, make: debrisLand },
  debrisShip: { n: 2, make: debrisShip },
  bombWater: { n: 2, make: bombWater },
  shipSink: { n: 2, make: shipSink },
  bombRelease: { n: 2, make: bombRelease },
  torpedoDrop: { n: 2, make: torpedoDrop },
  torpedoHit: { n: 2, make: torpedoHit },
  arrestWire: { n: 2, make: arrestWire },
  touchdown: { n: 2, make: touchdown },
  takeoffRoll: { n: 2, make: takeoffRoll },
  capture: { n: 2, make: (sr, r) => bells(sr, r, [[0, 1], [.3, .9]], 640, 2.4) },
  objective: { n: 2, make: (sr, r) => bells(sr, r, [[0, 1]], 852, 1.5) },
  loss: { n: 2, make: (sr, r) => bells(sr, r, [[0, 1], [.75, .8]], 322, 3) },
  radio: { n: 3, make: squelch },
  raid: { n: 1, make: siren },
  ui: { n: 3, make: switchClick },
  playerDown: { n: 1, make: playerDown },
};
/** Variation `i` of a bank, deterministic in (seed, name, i). */
export function buildCue(name, i, sr, seed) {
  let h = seed >>> 0;
  for (let k = 0; k < name.length; k++) h = Math.imul(h ^ name.charCodeAt(k), 0x01000193);
  return BANKS[name].make(sr, makeRng((h ^ Math.imul(i + 1, 0x9E3779B1)) >>> 0));
}

// --- loops ----------------------------------------------------------------------
// One loop is `cycles` engine cycles (two crank revolutions each) at `rev`
// revolutions/s; playbackRate then scales every order together, as rpm does.
// Cylinders differ in strength and timing (collector grouping, wear), which is
// what puts the lumpy half-orders of a radial under its firing note.
export function exhaustLoop(sr, seed, { cyl, rev, cycles = 32, uneven = .35, rough = 0, pipe = 210 }) {
  const rng = makeRng(seed), P = Math.round(sr * 2 / rev), N = P * cycles, out = new Float32Array(N);
  const p1 = rng() * TAU, p2 = rng() * TAU, p3 = rng() * TAU, cg = [], ct = [], cf = [];
  for (let k = 0; k < cyl; k++) {
    const u = TAU * k / cyl;
    cg[k] = Math.max(.15, 1 + uneven * (.55 * Math.cos(u + p1) + .45 * Math.cos(2 * u + p2) + .4 * Math.cos(3 * u + p3) + (rng() - .5) * .6));
    ct[k] = (k + (rng() - .5) * uneven * .6) / cyl;
    cf[k] = pipe * (1 + (rng() - .5) * .3);
  }
  const tau = .0036 * sr, len = Math.ceil(tau * 6);
  for (let c = 0; c < cycles; c++) for (let k = 0; k < cyl; k++) {
    if (rng() < rough) continue;                                   // a dead cylinder this cycle
    const g = cg[k] * (1 + (rng() - .5) * .25) * (rough && rng() < rough * .5 ? 2.4 : 1);   // or a backfire
    const i0 = c * P + Math.round(((ct[k] % 1) + 1) % 1 * P), w = TAU * cf[k] / sr;
    for (let j = 0; j < len; j++) out[(i0 + j) % N] += g * Math.exp(-j / tau) * Math.sin(w * j);
  }
  const hiss = bq(bq(white(N, rng), sr, 'lp', 2200, .707, 0, true), sr, 'hp', 300, .707, 0, true);
  for (let i = 0; i < N; i++) out[i] += hiss[i] * (.25 + 1.1 * Math.abs(out[i]));   // gas noise riding each pulse
  bq(out, sr, 'hp', 48, .707, 0, true);
  const k = .2 / (rmsOf(out) || 1);
  for (let i = 0; i < N; i++) out[i] = Math.tanh(out[i] * k * 1.6) / 1.6;
  return out;
}
// Propeller: blade-passage harmonics (the prop turns once per engine cycle at
// 2:1 reduction) plus the tearing noise each blade drags round with it.
export function propLoop(sr, seed, { rev, blades, cycles = 32 }) {
  const rng = makeRng(seed), P = Math.round(sr * 2 / rev), N = P * cycles, out = new Float32Array(N);
  const ph = [], bladePhase = rng() * TAU;
  for (let h = 1; h <= 14; h++) ph[h] = rng() * .6;
  const tear = bq(bq(white(N, rng), sr, 'lp', 3200, .707, 0, true), sr, 'hp', 350, .707, 0, true);
  for (let i = 0; i < N; i++) {
    const th = TAU * i / P;
    let s = 0;
    for (let h = 1; h <= 14; h++) s += Math.sin(h * blades * th + ph[h]) / Math.pow(h, 1.15);
    const pass = .5 + .5 * Math.cos(blades * th);
    out[i] = s * (1 + .12 * Math.sin(th + bladePhase)) + tear[i] * pass * pass * 1.1;
  }
  const k = .2 / (rmsOf(out) || 1);
  for (let i = 0; i < N; i++) out[i] *= k;
  return out;
}
// Slipstream over the canopy and airframe: broadband, gusting slowly.
export function windLoop(sr, seed, sec = 3.2) {
  const rng = makeRng(seed), N = Math.round(sr * sec);
  const out = bq(bq(white(N, rng), sr, 'lp', 4200, .5, 0, true), sr, 'hp', 140, .707, 0, true);
  const a = rng() * TAU, b = rng() * TAU, k = .2 / rmsOf(out);
  for (let i = 0; i < N; i++) { const u = TAU * i / N; out[i] *= k * (1 + .18 * Math.sin(2 * u + a) + .12 * Math.sin(5 * u + b)); }
  return out;
}
// Buffet in a hard turn: the airflow breaking away from the wing in low thumps.
export function buffetLoop(sr, seed, sec = 2) {
  const rng = makeRng(seed), N = Math.round(sr * sec);
  const out = bq(bq(white(N, rng), sr, 'lp', 210, .707, 0, true), sr, 'hp', 45, .707, 0, true);
  const a = rng() * TAU, b = rng() * TAU, k = .2 / rmsOf(out);
  for (let i = 0; i < N; i++) { const u = TAU * i / N; out[i] *= k * Math.pow(.5 + .5 * Math.sin(19 * u + a + 1.3 * Math.sin(3 * u + b)), 2) * 2; }
  return out;
}
// A damaged airframe: loose panels and fittings chattering.
export function rattleLoop(sr, seed, sec = 2.4) {
  const rng = makeRng(seed), N = Math.round(sr * sec), out = new Float32Array(N);
  let t = 0;
  while (t < sec) {
    const f = 380 + rng() * 900;
    modes(out, sr, { t, g: .4 + rng() * .6, wrap: true, list: [[f, .012 + rng() * .02, 1], [f * 2.3, .008, .5], [f * 3.7, .005, .3]] });
    t += .03 + rng() * rng() * .22;
  }
  const k = .15 / (rmsOf(out) || 1);
  for (let i = 0; i < N; i++) out[i] *= k;
  return out;
}
/** Open air over water: a surface reflection or two and a short, dark, diffuse tail. Stereo. */
export function impulseResponse(sr, seed, sec, decay) {
  const rng = makeRng(seed), N = Math.round(sr * sec), chans = [];
  for (let c = 0; c < 2; c++) {
    const x = new Float32Array(N);
    let lp = 0;
    for (let i = 0; i < N; i++) {
      const t = i / sr, cut = .5 * Math.exp(-t / (sec * .6)) + .06;        // the tail darkens as it decays
      lp += cut * ((rng() * 2 - 1) - lp);
      x[i] = lp * Math.exp(-t / decay) * Math.min(1, t / .012);
    }
    for (let k = 0; k < 5; k++) { const i = Math.round((.014 + rng() * .07) * sr); if (i < N) x[i] += (rng() < .5 ? -1 : 1) * (.5 - k * .07); }
    bq(x, sr, 'hp', 160);
    let e = 0; for (let i = 0; i < N; i++) e += x[i] * x[i];
    const k = 1 / Math.sqrt(e || 1);
    for (let i = 0; i < N; i++) x[i] *= k * Math.min(1, (N - 1 - i) / (.03 * sr));
    chans.push(x);
  }
  return chans;
}
