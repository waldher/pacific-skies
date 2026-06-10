// Tiny procedural audio: gunfire and explosions, no assets.
import { rand } from './util.js';

let AC = null;

export function audioInit() {
  if (!AC) {
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
  }
  if (AC && AC.state === 'suspended') AC.resume();
}

export function sfxGun() {
  if (!AC) return;
  const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
  o.type = 'square'; o.frequency.setValueAtTime(rand(620, 700), t);
  o.frequency.exponentialRampToValueAtTime(140, t + 0.06);
  g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  o.connect(g).connect(AC.destination); o.start(t); o.stop(t + 0.08);
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
  if (!AC) return;
  const t = AC.currentTime, len = big ? 0.7 : 0.4;
  const buf = AC.createBuffer(1, AC.sampleRate * len, AC.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
  const src = AC.createBufferSource(); src.buffer = buf;
  const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(big ? 900 : 1400, t);
  const g = AC.createGain(); g.gain.setValueAtTime(big ? 0.35 : 0.2, t);
  src.connect(f).connect(g).connect(AC.destination); src.start(t);
}
