// Tiny procedural audio: gunfire and explosions, no assets.
let AC = null;
let gunShots;
let nextGunShot = 0;
let blasts;
let activeBlasts = 0;
let activeSmallBlasts = 0;

const SAMPLE_RATE = 24000;
const GUN_DURATION = .075;
const GUN_PEAK = .08;
const MAX_BLASTS = 3;

function noiseStep(seed) {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

function filterStep(frequency) {
  return 1 - Math.exp(-2 * Math.PI * frequency / SAMPLE_RATE);
}

function normalizePeak(samples, peak, target) {
  const scale = target / peak;
  for (let i = 0; i < samples.length; i++) samples[i] *= scale;
}

function createGunShot(context, seed) {
  const length = Math.round(GUN_DURATION * SAMPLE_RATE);
  const buffer = context.createBuffer(1, length, SAMPLE_RATE);
  const samples = buffer.getChannelData(0);
  const pressureBand = filterStep(430);
  const reportBand = filterStep(2600);
  let pressure = 0;
  let report = 0;
  let peak = 0;

  for (let i = 0; i < length; i++) {
    // Each buffer has its own repeatable noise. Firing never draws from the
    // gameplay random stream, regardless of whether audio has been unlocked.
    seed = noiseStep(seed);
    const noise = seed / 2147483648 - 1;
    pressure += pressureBand * (noise - pressure);
    report += reportBand * (noise - report);
    const t = i / SAMPLE_RATE;
    const crack = (report - pressure) * Math.exp(-t / .005);
    const body = pressure * Math.exp(-t / .014);
    const returnTime = t - .014;
    const action = returnTime < 0 ? 0 :
      (noise - report) * Math.min(1, returnTime / .001) * Math.exp(-returnTime / .002);
    const edge = Math.min(1, t / .0005, (length - 1 - i) / 96);
    const sample = edge * (.7 * crack + body + .14 * action);
    samples[i] = sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  normalizePeak(samples, peak, GUN_PEAK);
  return buffer;
}

function createBlast(context, seed, big) {
  const length = Math.round((big ? .62 : .27) * SAMPLE_RATE);
  const buffer = context.createBuffer(1, length, SAMPLE_RATE);
  const samples = buffer.getChannelData(0);
  // Keep the body in a band audible on small speakers. A brief higher crack
  // leads each blast, and a slower, lower tail distinguishes the large cue.
  const lowBand = filterStep(big ? 85 : 160);
  const bodyBand = filterStep(big ? 390 : 730);
  const debrisBand = filterStep(big ? 1300 : 2200);
  let low = 0;
  let body = 0;
  let debris = 0;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    seed = noiseStep(seed);
    const noise = seed / 2147483648 - 1;
    low += lowBand * (noise - low);
    body += bodyBand * (noise - body);
    debris += debrisBand * (noise - debris);
    const t = i / SAMPLE_RATE;
    const crack = (debris - body) * Math.exp(-t / .012);
    const pressure = (body - low) * Math.exp(-t / (big ? .118 : .044));
    const tail = (debris - low) * Math.min(1, t / .035) * Math.exp(-t / (big ? .16 : .07));
    const edge = Math.min(1, t / .001, (length - 1 - i) / (.025 * SAMPLE_RATE));
    const sample = edge * (.55 * crack + pressure + .22 * tail);
    samples[i] = sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  normalizePeak(samples, peak, big ? .23 : .16);
  return buffer;
}

export function audioInit() {
  if (!AC) {
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    if (AC) {
      gunShots = [1942, 1943, 1944, 1945].map(seed => createGunShot(AC, seed));
      blasts = [false, true].map(big => ({
        buffers: [3221, 7319].map(seed => createBlast(AC, seed, big)),
        next: 0,
      }));
    }
  }
  if (AC && AC.state === 'suspended') AC.resume();
}

export function sfxGun() {
  if (!AC) return;
  const source = AC.createBufferSource();
  source.buffer = gunShots[nextGunShot];
  nextGunShot = (nextGunShot + 1) % gunShots.length;
  source.connect(AC.destination);
  source.start(AC.currentTime);
}

export function sfxOverheat() {
  if (!AC) return;
  const t = AC.currentTime, len = 0.5;
  const buf = AC.createBuffer(1, AC.sampleRate * len, AC.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.5);
  const src = AC.createBufferSource(); src.buffer = buf;
  const f = AC.createBiquadFilter(); f.type = 'highpass'; f.frequency.setValueAtTime(3200, t);
  const g = AC.createGain(); g.gain.setValueAtTime(0.12, t);
  src.connect(f).connect(g).connect(AC.destination); src.start(t);
}

export function sfxBoom(big) {
  // Leave one voice available for a large blast when small cues overlap.
  // Even three full-scale blast voices sum to at most .69 before resampling.
  if (!AC || AC.state !== 'running' || activeBlasts >= MAX_BLASTS ||
      (!big && activeSmallBlasts >= MAX_BLASTS - 1)) return;
  const bank = blasts[big ? 1 : 0];
  const source = AC.createBufferSource();
  source.buffer = bank.buffers[bank.next];
  bank.next = (bank.next + 1) % bank.buffers.length;
  activeBlasts++;
  if (!big) activeSmallBlasts++;
  source.onended = () => {
    activeBlasts--;
    if (!big) activeSmallBlasts--;
    source.disconnect();
  };
  source.connect(AC.destination);
  source.start(AC.currentTime);
}
