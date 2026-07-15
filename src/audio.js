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

// bright two-note chirp: capture, touch down, rearm complete
export function sfxDing() {
  if (!AC) return;
  const t = AC.currentTime;
  [523, 784].forEach((hz, i) => {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(hz, t + i * 0.09);
    g.gain.setValueAtTime(0.0001, t + i * 0.09);
    g.gain.exponentialRampToValueAtTime(0.09, t + i * 0.09 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.22);
    o.connect(g).connect(AC.destination);
    o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.25);
  });
}

// low two-tone klaxon: raid inbound, island lost
export function sfxAlarm() {
  if (!AC) return;
  const t = AC.currentTime;
  [0, 0.18].forEach(off => {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(196, t + off);
    o.frequency.setValueAtTime(147, t + off + 0.09);
    g.gain.setValueAtTime(0.0001, t + off);
    g.gain.exponentialRampToValueAtTime(0.07, t + off + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + off + 0.17);
    o.connect(g).connect(AC.destination);
    o.start(t + off); o.stop(t + off + 0.2);
  });
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
