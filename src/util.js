// Math helpers and the gameplay RNG.
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// stable per-cell noise for ocean glints and island placement
export function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// The gameplay RNG is seedable (mulberry32) so playtests can be
// deterministic; defaults to Math.random for normal play.
let random = Math.random;
export function setSeed(seed) {
  let t = seed >>> 0;
  random = function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ t >>> 15, 1 | t);
    r ^= r + Math.imul(r ^ r >>> 7, 61 | r);
    return ((r ^ r >>> 14) >>> 0) / 4294967296;
  };
}
export const rand = (a, b) => a + random() * (b - a);
