// Sound: a synthesised engine and airframe bed, pre-rendered one-shot banks,
// and a mix bus with ducking, a limiter and one shared space. No assets.
//
// The DSP is in audio-synth.js; every tuning number is in CONFIG.audio.
// All exports are no-ops until audioInit() (a user gesture) or audioAttach()
// (tests, offline rendering) has given the module an AudioContext, so the
// Node harnesses that import gameplay modules never touch audio.
// Audio never draws from the gameplay RNG.
import { CONFIG } from './config.js';
import { makeRng, BANKS, buildCue, exhaustLoop, propLoop, windLoop, buffetLoop, rattleLoop, impulseResponse } from './audio-synth.js';

const MAKE = { cue: buildCue, exhaust: exhaustLoop, prop: propLoop, wind: windLoop, buffet: buffetLoop, rattle: rattleLoop };

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Build the whole sound system on `ctx` (an AudioContext or OfflineAudioContext).
 * `sync` synthesises every buffer immediately instead of spreading the work
 * over idle slices: right for offline rendering, wrong for a tablet.
 */
export function createAudio(ctx, { sync = false, config = CONFIG.audio } = {}) {
  const C = config, SR = C.sampleRate, rng = makeRng(C.seed);
  const gainNode = (value, to) => { const g = ctx.createGain(); g.gain.value = value; if (to) g.connect(to); return g; };
  const toBuffer = (data, rate = SR) => { const b = ctx.createBuffer(1, data.length, rate); b.getChannelData(0).set(data); return b; };

  // --- bus: categories → (bed ducker) → sum → limiter → ceiling → out -----------
  const ceiling = ctx.createWaveShaper(), L = C.limiter;
  const curve = new Float32Array(2049);
  for (let i = 0; i < curve.length; i++) {
    // Linear to the knee, then a tanh shoulder that can never pass the ceiling.
    const x = i / 1024 - 1, a = Math.abs(x), k = L.ceiling - L.clipKnee;
    curve[i] = Math.sign(x) * (a <= L.clipKnee ? a : L.clipKnee + k * Math.tanh((a - L.clipKnee) / k));
  }
  ceiling.curve = curve; ceiling.connect(ctx.destination);
  const master = gainNode(C.master, ceiling);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = L.threshold; limiter.knee.value = L.knee; limiter.ratio.value = L.ratio;
  limiter.attack.value = L.attack; limiter.release.value = L.release; limiter.connect(master);
  const sum = gainNode(1, limiter);
  const life = gainNode(0, sum);                 // the bed only exists while flying
  const bed = gainNode(1, life);                 // ducked under guns and danger
  let space = null;
  if (C.space.seconds > 0 && ctx.createConvolver) {
    space = ctx.createConvolver();
    const ir = impulseResponse(ctx.sampleRate, C.seed + 7, C.space.seconds, C.space.decay);
    const b = ctx.createBuffer(2, ir[0].length, ctx.sampleRate);
    b.getChannelData(0).set(ir[0]); b.getChannelData(1).set(ir[1]);
    space.normalize = false; space.buffer = b; space.connect(gainNode(C.space.wet, sum));
  }
  const cats = {};
  for (const [name, def] of Object.entries(C.bus)) {
    const input = gainNode(def.gain, def.bed ? bed : sum);
    if (space && def.send) input.connect(gainNode(def.send, space));
    cats[name] = { in: input, cap: def.cap ?? 8, voices: [] };
  }
  let duckDepth = 1, duckUntil = 0;
  function duck([depth, hold], t) {
    if (t < duckUntil) depth = Math.min(depth, duckDepth);
    duckDepth = depth; duckUntil = Math.max(duckUntil, t + hold);
    bed.gain.cancelScheduledValues(t);
    bed.gain.setTargetAtTime(depth, t, C.duck.attack);
    bed.gain.setTargetAtTime(1, duckUntil, C.duck.release);
  }

  // --- synthesis: in a module worker where the browser has them, so the main
  // thread never stalls; otherwise on the main thread, one buffer per idle slice.
  const jobs = [];
  let worker = null, current = null, busy = false;
  if (!sync && typeof Worker === 'function') {
    try {
      worker = new Worker(new URL('./audio-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = e => { const job = current; current = null; busy = false; if (job) job.done(e.data); next(); };
      worker.onerror = () => { worker = null; busy = false; if (current) { jobs.unshift(current); current = null; } next(); };
    } catch (e) { worker = null; }
  }
  function next() {
    if (busy || !jobs.length) return;
    busy = true;
    const job = jobs.shift();
    if (worker) { current = job; worker.postMessage({ kind: job.kind, args: job.args }); }
    else setTimeout(() => { busy = false; job.done(MAKE[job.kind](...job.args)); next(); }, C.build.gapMs);
  }
  function synth(kind, args, done, urgent) {
    if (sync) { done(MAKE[kind](...args)); return; }
    if (urgent) jobs.unshift({ kind, args, done }); else jobs.push({ kind, args, done });
    next();
  }
  // One variation of everything first, most needed first (so every cue can
  // sound early), then the remaining variations.
  const banks = {};
  for (const name of Object.keys(BANKS)) banks[name] = { ready: [], asked: 0, early: false, last: -1 };
  function ask(name) {
    const bank = banks[name], i = bank.asked++;
    synth('cue', [name, i, SR, C.seed], data => { if (i || !bank.early) bank.ready.push(toBuffer(data)); });
  }
  function queueBanks() {
    const order = [...C.build.first, ...Object.keys(BANKS).filter(n => !C.build.first.includes(n))];
    for (let i = 0; i < 8; i++) for (const name of order) if (i < BANKS[name].n) ask(name);
  }

  // --- one-shots ----------------------------------------------------------------
  const listener = { x: 0, y: 0, w: 900 }, lastAt = {}, played = {};
  function cue(name, o = {}) {
    const def = C.cues[name];
    if (!def) return false;
    const now = ctx.currentTime, t = now + (o.delay || 0);
    if (def.every && now - (lastAt[name] ?? -99) < def.every) return false;
    let g = def.gain * (o.gain ?? 1), pan = 0, far = 0;
    if (o.x !== undefined) {
      const dx = o.x - listener.x, d = Math.hypot(dx, o.y - listener.y), W = C.world;
      pan = clamp(dx / (listener.w * W.panWidth), -1, 1) * W.pan;
      if (!def.near) {
        if (d > W.cull) return false;
        g /= 1 + (d / W.ref) ** 2; far = d;
      }
    }
    if (g < .004) return false;
    const cat = cats[def.cat];
    cat.voices = cat.voices.filter(v => v.end > now);
    if (cat.voices.length >= cat.cap) {
      if (!def.steal) return false;
      const old = cat.voices.shift();
      try { old.src.stop(now + .01); } catch (e) {}
    }
    const bankName = def.bank || name, bank = banks[bankName];
    if (!bank.ready.length) {
      // Not synthesised yet: short urgent cues are made on the spot, the rest stay silent until they arrive.
      if (!def.urgent) return false;
      bank.early = true; bank.ready.push(toBuffer(buildCue(bankName, 0, SR, C.seed)));
    }
    let i = Math.floor(rng() * bank.ready.length);
    if (i === bank.last && bank.ready.length > 1) i = (i + 1 + Math.floor(rng() * (bank.ready.length - 1))) % bank.ready.length;
    bank.last = i; lastAt[name] = now;
    const src = ctx.createBufferSource(), rate = (o.rate || 1) * (def.rate || 1) * (1 + (rng() * 2 - 1) * (def.detune ?? C.vary.rate));
    src.buffer = bank.ready[i]; src.playbackRate.value = rate;
    let node = src;
    const lp = Math.min(def.lp || 1e9, far > C.world.airRef ? C.world.airHz * C.world.airRef / far : 1e9);
    if (lp < 1e8) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = .5; node.connect(f); node = f; }
    const voice = gainNode(g * (1 + (rng() * 2 - 1) * C.vary.gain));
    node.connect(voice); node = voice;
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; node.connect(p); node = p; }
    node.connect(cat.in);
    src.start(t);
    cat.voices.push({ end: t + src.buffer.duration / rate, src });
    if (def.duck) duck(def.duck, t);
    played[name] = (played[name] || 0) + 1;
    return true;
  }

  // --- engine, wind and airframe: long-lived loops with parameter ramps ----------
  const E = C.engine, loops = {};
  const target = (param, value, tc) => param.setTargetAtTime(value, ctx.currentTime, tc);
  function loopSource(buffer, to, rate = 1) {
    const s = ctx.createBufferSource(); s.buffer = buffer; s.loop = true; s.playbackRate.value = rate; s.connect(to); s.start(); return s;
  }
  function layoutLoops(key) {
    if (loops[key]) return loops[key];
    const lay = E.layouts[key], seed = C.seed + key.length * 131 + lay.cyl, set = loops[key] = { pending: 3 };
    const got = part => data => { set[part] = toBuffer(data); set.pending--; };
    synth('exhaust', [SR, seed, lay], got('exhaust'), true);
    synth('exhaust', [SR, seed, { ...lay, rough: E.roughMisfire }], got('rough'), true);
    synth('prop', [SR, seed + 1, lay], got('prop'), true);
    return set;
  }
  const bedBuffers = { pending: 3 };
  for (const [kind, i] of [['wind', 11], ['buffet', 12], ['rattle', 13]])
    synth(kind, [SR, C.seed + i], data => { bedBuffers[kind] = toBuffer(data); bedBuffers.pending--; }, true);
  let engine = null, bedLoops = null, flyby = null;
  function startEngine(aircraft) {
    const spec = E.aircraft[aircraft] || E.aircraft.corsair, set = layoutLoops(spec.layout);
    if (set.pending) return;
    if (engine) {                                  // aircraft changed on the ground: swap sets
      const old = engine;
      target(old.out.gain, 0, .08);
      for (const s of old.sources) try { s.stop(ctx.currentTime + .6); } catch (e) {}
    }
    const out = gainNode(0, cats.engine.in), body = ctx.createBiquadFilter(), tone = ctx.createBiquadFilter();
    body.type = 'peaking'; body.frequency.value = E.bodyHz; body.Q.value = .9; body.gain.value = E.bodyDb; body.connect(out);
    tone.type = 'lowpass'; tone.frequency.value = E.tone[0]; tone.Q.value = .6; tone.connect(body);
    const gEx = gainNode(0, tone), gRough = gainNode(0, tone), gProp = gainNode(0, tone);
    const sources = [loopSource(set.exhaust, gEx), loopSource(set.rough, gRough), loopSource(set.prop, gProp)];
    const detuned = [];
    if (spec.twin) for (const [buffer, to] of [[set.exhaust, gEx], [set.prop, gProp]]) { const s = loopSource(buffer, to); sources.push(s); detuned.push(s); }
    target(out.gain, 1, .1);
    engine = { aircraft, spec, out, tone, gEx, gRough, gProp, sources, detuned, rate: E.rate.idle, power: 0 };
  }
  function startBed() {
    if (bedLoops || bedBuffers.pending) return;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 600; filter.Q.value = .4;
    const gWind = gainNode(0, cats.wind.in), gBuffet = gainNode(0, cats.wind.in), gRattle = gainNode(0, cats.engine.in);
    filter.connect(gWind);
    bedLoops = { filter, gWind, gBuffet, gRattle,
      sources: [loopSource(bedBuffers.wind, filter), loopSource(bedBuffers.buffet, gBuffet), loopSource(bedBuffers.rattle, gRattle)] };
  }
  function startFlyby() {
    const set = layoutLoops(C.flyby.layout);
    if (flyby || set.pending) return;
    const mix = new Float32Array(set.exhaust.length), a = set.exhaust.getChannelData(0), b = set.prop.getChannelData(0);
    for (let i = 0; i < mix.length; i++) mix[i] = .6 * a[i] + .8 * b[i];
    const buffer = toBuffer(mix);
    flyby = [];
    for (let i = 0; i < C.flyby.slots; i++) {
      const gain = gainNode(0), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : gainNode(1);
      gain.connect(pan); pan.connect(cats.world.in);
      flyby.push({ who: null, gain, pan, src: loopSource(buffer, gain), d: 0 });
    }
  }

  // --- per-frame: read the game, move parameters, notice edges -------------------
  const seen = new WeakSet();
  let lastFrame = -1, prev = { speed: 0, mode: '', overheated: false, waypoint: undefined, raid: false, flight: '' };
  let firing = false, lastGun = 0, gunGap = .3, playTime = 0;
  function frame(game, view) {
    const now = ctx.currentTime;
    if (lastFrame >= 0 && now - lastFrame < 1 / C.updateHz) return;
    const step = lastFrame < 0 ? 1 / C.updateHz : Math.min(.25, now - lastFrame);
    lastFrame = now;
    const p = game.player, mode = game.mode, playing = mode === 'play' && !game.paused && !!p;
    if (mode !== prev.mode) {
      if (prev.mode === 'play' && (mode === 'recovery' || mode === 'over')) cue('playerDown');
      if (prev.mode === 'play' && mode === 'victory') for (let i = 0; i < 4; i++) cue('victory', { delay: i * .62 });
      prev.mode = mode; playTime = 0;
    }
    if (firing) {
      // Released when the game's own fire timer says so (slow frames must not fake a release);
      // out of play, when real time does.
      const flying = mode === 'play' && p?.flight === 'flying' && p.fireCd !== undefined;
      if (flying ? p.fireCd < -gunGap * (C.gunTailAfter - 1) : now - lastGun > gunGap * C.gunTailAfter) { firing = false; cue('gunTail'); }
    }
    target(life.gain, playing ? 1 : mode === 'play' ? C.pausedBed : 0, .12);
    if (!playing) return;
    playTime += step;
    listener.x = game.cam.x; listener.y = game.cam.y; listener.w = view?.W || 900;

    const P = { ...CONFIG.player, ...CONFIG.aircraft[p.aircraft] };
    if (!engine || engine.aircraft !== p.aircraft) startEngine(p.aircraft);
    startBed(); startFlyby();
    if (!bedLoops) return;
    const flying = p.flight === 'flying';
    const sn = clamp((p.speed - P.speedBrake) / Math.max(1, P.speedBoost - P.speedBrake), 0, 1);
    const accel = clamp((p.speed - prev.speed) / step / E.accelRef, -1, 1); prev.speed = p.speed;
    const load = flying ? clamp(Math.abs(p.omega || 0) / P.turnRate, 0, 1.3) : 0;
    const hurt = flying ? clamp(1 - p.hp / P.smokeBelowHp, 0, 1) : 0;
    if (engine) {
      // rpm follows airspeed (which follows throttle), leads it a little on a
      // throttle change, and sags under a hard turn.
      let rate, power;
      if (flying) { rate = lerp(E.rate.brake, E.rate.boost, sn) + E.rate.lead * accel - E.rate.sag * load; power = clamp(.3 + .6 * sn + .4 * accel + .15 * load, .12, 1.15); }
      else if (p.flight === 'takeoff') { rate = E.rate.takeoff; power = 1.15; }
      else if (p.flight === 'landing') { rate = E.rate.idle * 1.25; power = .16; }
      else { rate = E.rate.idle; power = .1; }
      rate *= engine.spec.pitch;
      const tc = flying ? E.spool : E.groundSpool;
      for (const s of engine.sources) target(s.playbackRate, rate, tc);
      for (const s of engine.detuned) target(s.playbackRate, rate * engine.spec.twin, tc);
      const ex = lerp(E.exhaust[0], E.exhaust[1], clamp(power, 0, 1)) * (1 + .2 * load);
      target(engine.gEx.gain, ex * (1 - E.roughMix * hurt), tc);
      target(engine.gRough.gain, ex * E.roughMix * hurt * 1.3, tc);
      target(engine.gProp.gain, E.prop * Math.pow(clamp(power, 0, 1.15), 1.5), tc);
      target(engine.tone.frequency, lerp(E.tone[0], E.tone[1], clamp(power, 0, 1)), tc);
      engine.rate = rate; engine.power = power;
    }
    const air = flying || p.flight === 'takeoff' ? p.speed / P.speedBoost : p.flight === 'landing' ? p.speed / P.speedBoost * .7 : 0;
    target(bedLoops.gWind.gain, C.wind.gain * air * air + C.wind.ground, .15);
    target(bedLoops.filter.frequency, lerp(C.wind.tone[0], C.wind.tone[1], clamp(air, 0, 1)), .15);
    target(bedLoops.gBuffet.gain, C.wind.buffet * load * load * air, .1);
    target(bedLoops.gRattle.gain, C.hull.rattle * hurt * (.6 + .4 * load), .2);

    // Edges the game does not announce.
    if (prev.overheated && !p.overheated && flying) cue('gunReady');
    prev.overheated = p.overheated;
    const wp = game.waypoint ? (game.waypoint.siteId ?? game.waypoint.name ?? 'point') : null;
    if (prev.waypoint !== undefined && wp !== prev.waypoint && wp !== null && playTime > 1.5) cue('objective');
    prev.waypoint = wp;
    let raid = false;
    for (const e of game.enemies) if (e.strike && e.detected && e.phase === 'attack' && e.hp > 0) { raid = true; break; }
    if (raid && !prev.raid) cue('raid');
    prev.raid = raid;

    // Rounds that pass close without hitting.
    if (flying) for (const b of game.ebullets) {
      if (seen.has(b) || b.life <= 0) continue;
      const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
      if (d > C.nearMiss.radius) continue;
      if (dx * b.vx + dy * b.vy < 0 && d > C.nearMiss.radius * .4) continue;    // still inbound: wait for the pass
      seen.add(b); cue('whiz', { x: b.x, y: b.y, gain: 1.2 - d / C.nearMiss.radius * .6 });
    }

    // Other aircraft near enough to hear: a few shared voices, panned, with
    // an exaggerated Doppler so a pass sweeps down in pitch.
    if (flyby) {
      const F = C.flyby, near = [];
      for (const list of [game.enemies, game.allies]) for (const f of list) {
        if (f.hp <= 0) continue;
        const d = Math.hypot(f.x - p.x, f.y - p.y);
        if (d < F.range) near.push({ f, d });
      }
      near.sort((a, b) => a.d - b.d); near.length = Math.min(near.length, flyby.length);
      for (const slot of flyby) if (slot.who && !near.some(n => n.f === slot.who)) { slot.who = null; target(slot.gain.gain, 0, .08); }
      for (const n of near) {
        let slot = flyby.find(s => s.who === n.f);
        const rx = n.f.x - p.x, ry = n.f.y - p.y;
        if (!slot) { slot = flyby.find(s => !s.who); if (!slot) continue; slot.who = n.f; slot.d = n.d; slot.rx = rx; slot.ry = ry; slot.motion = F.relFloor; }
        const closure = clamp((slot.d - n.d) / step, -F.maxClosure, F.maxClosure); slot.d = n.d;
        // What is heard is the pass: an aircraft holding station beside you (a wingman) is almost silent.
        const moving = clamp(Math.hypot(rx - slot.rx, ry - slot.ry) / step / F.relRef, F.relFloor, 1); slot.rx = rx; slot.ry = ry;
        slot.motion += (moving - slot.motion) * Math.min(1, step / F.relSmooth);
        const u = 1 - n.d / F.range;
        target(slot.gain.gain, F.gain * slot.motion * u * u / (1 + (n.d / F.ref) ** 2), .06);
        target(slot.src.playbackRate, (n.f.team === 'us' || n.f.role ? F.allyRate : F.enemyRate) * (1 + closure / F.soundSpeed), .08);
        if (slot.pan.pan) target(slot.pan.pan, clamp((n.f.x - listener.x) / (listener.w * C.world.panWidth), -1, 1) * C.world.pan, .06);
      }
    }
  }

  function gun(aircraft, cooldown) {
    const light = (E.aircraft[aircraft] || E.aircraft.corsair).guns === 'light';
    if (cue(light ? 'gunLight' : 'gun')) { firing = true; lastGun = ctx.currentTime; gunGap = cooldown || .13; }
  }
  queueBanks();
  return { ctx, cue, gun, frame,
    debug: () => ({ state: ctx.state, time: ctx.currentTime, sampleRate: ctx.sampleRate, pending: jobs.length + (busy ? 1 : 0), worker: !!worker, played: { ...played },
      buffers: Object.fromEntries(Object.entries(banks).map(([n, b]) => [n, b.ready.length])),
      voices: Object.fromEntries(Object.entries(cats).map(([n, c]) => [n, c.voices.filter(v => v.end > ctx.currentTime).length])),
      engine: engine && { aircraft: engine.aircraft, rate: engine.rate, power: engine.power }, bed: !!bedLoops, flyby: flyby ? flyby.filter(s => s.who).length : null }) };
}

// --- the game's handle -----------------------------------------------------------
let A = null;

/** Attach to a given context (offline rendering, tests). Replaces any live instance. */
export function audioAttach(ctx, options) { A = ctx ? createAudio(ctx, options) : null; return A; }

/** Create or resume the context. Browsers only allow this inside a user gesture. */
export function audioInit() {
  if (!A) {
    if (typeof window === 'undefined') return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    try {
      A = createAudio(new Ctor({ latencyHint: 'interactive' }));
      // A hidden tab should not keep an engine droning.
      if (typeof document !== 'undefined') document.addEventListener?.('visibilitychange', () => {
        if (!A) return;
        if (document.hidden) A.ctx.suspend?.(); else A.ctx.resume?.();
      });
    } catch (e) { A = null; }
  }
  if (A && A.ctx.state === 'suspended' && !(typeof document !== 'undefined' && document.hidden)) A.ctx.resume?.();
}

/** Live state for tests and the console (window.__game.audio()). Null until audio is initialised. */
export function audioDebug() { return A ? A.debug() : null; }
/** Once per rendered frame: engine, wind, flybys, near misses, edge-triggered cues. */
export function audioFrame(game, view) { if (A) A.frame(game, view); }
/** Any cue by name; see CONFIG.audio.cues. `x, y` are world coordinates. */
export function sfx(name, options) { if (A) A.cue(name, options); }

export function sfxGun(aircraft, cooldown) { if (A) A.gun(aircraft, cooldown); }
export function sfxOverheat() { sfx('overheat'); }
/** Explosions are world events: small is an aircraft, big is ordnance or a ship. */
export function sfxBoom(big, x, y) { sfx(big ? 'boomBig' : 'boomSmall', { x, y }); }
/** A round striking a target. `own` rounds are feedback and stay readable at any range. */
export function sfxHit(x, y, own = true, hull = false) { sfx(own ? (hull ? 'hitHull' : 'hitDealt') : 'hitFar', { x, y }); }
export function sfxPlayerHit(amount = 12) { sfx('hitTaken', { gain: clamp(amount / 12, .7, 1.25) }); }
export function sfxCollision() { sfx('collision'); }
export function sfxEnemyGun(x, y) { sfx('enemyGun', { x, y }); }
export function sfxAllyGun(x, y) { sfx('allyGun', { x, y }); }
export function sfxShipGun(x, y) { sfx('shipGun', { x, y }); }
export function sfxBombRelease(fallSeconds = .8) { sfx('bombRelease', { rate: .8 / fallSeconds }); }
/** `kind`: 'land' | 'ship' | 'water'. The blast itself comes from explosion(). */
export function sfxBombImpact(kind, x, y) { sfx(kind === 'water' ? 'bombWater' : kind === 'ship' ? 'debrisShip' : 'debrisLand', { x, y }); }
export function sfxTorpedoDrop() { sfx('torpedoDrop'); }
export function sfxTorpedoHit(x, y) { sfx('torpedoHit', { x, y }); }
export function sfxShipSunk(x, y) { sfx('shipSink', { x, y }); sfx('debrisShip', { x, y }); }
/** `carrier` true for a wire, false for a strip. */
export function sfxLanding(carrier) { sfx(carrier ? 'arrestWire' : 'touchdown'); }
export function sfxTakeoff() { sfx('takeoffRoll'); }
/** Signals: 'radio' | 'capture' | 'loss' | 'raid' | 'objective' | 'victory'. */
export function sfxSignal(kind = 'radio') { sfx(kind); }
export function sfxUi() { sfx('ui'); }
