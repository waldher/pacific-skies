// One tileable value-noise field shared by the shaders and the land generator.
//
// Shaders used to hash-and-sin four corners per noise sample, so an ocean
// pixel cost ~24 sines. Sampling a pre-smoothed texture is one tap, and the
// same grid is readable from JS, so forests and villages can follow the
// exact hills the ground shader shades. Coordinates are in cells: the grid
// is CELLS wide and tiles, and one cell spans TEXELS texels.
//
// Texture layout: R is noise field 0, G and B its analytic gradient (per
// cell, packed into 0..1), A is field 1. Lighting uses the stored gradient
// rather than screen-space derivatives: a bilinear texture's derivative is
// constant across each texel, which shows as facets, while the interpolated
// gradient stays continuous.
import * as THREE from 'three';

export const CELLS = 64;
const TEXELS = 8, SIZE = CELLS * TEXELS, CHANNELS = 2, GRADIENT_RANGE = 1.5;
const grid = new Float32Array(CELLS * CELLS * CHANNELS);
{
  // Fixed seed: the same world looks identical on every device and reload.
  let state = 0x9e3779b9;
  for (let i = 0; i < grid.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    grid[i] = state / 4294967296;
  }
}
const cell = (x, y, channel) => grid[(((y % CELLS) + CELLS) % CELLS * CELLS + ((x % CELLS) + CELLS) % CELLS) * CHANNELS + channel];
const smooth = t => t * t * (3 - 2 * t), slope = t => 6 * t * (1 - t);

// Smooth value noise in [0, 1) at a point in cell units.
export function noise(x, y, channel = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const a = cell(ix, iy, channel), b = cell(ix + 1, iy, channel), c = cell(ix, iy + 1, channel), d = cell(ix + 1, iy + 1, channel);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
// Partial derivatives of noise() per cell unit.
function gradient(x, y, channel = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy, fx = smooth(tx), fy = smooth(ty);
  const a = cell(ix, iy, channel), b = cell(ix + 1, iy, channel), c = cell(ix, iy + 1, channel), d = cell(ix + 1, iy + 1, channel);
  return [((b - a) + (a - b - c + d) * fy) * slope(tx), ((c - a) + (a - b - c + d) * fx) * slope(ty)];
}

let texture = null;
export function noiseTexture() {
  if (texture) return texture;
  const data = new Uint8Array(SIZE * SIZE * 4);
  const pack = v => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const u = (x + .5) / TEXELS, v = (y + .5) / TEXELS, [gx, gy] = gradient(u, v, 0), o = (y * SIZE + x) * 4;
    data[o] = pack(noise(u, v, 0));
    data[o + 1] = pack(gx / (2 * GRADIENT_RANGE) + .5);
    data[o + 2] = pack(gy / (2 * GRADIENT_RANGE) + .5);
    data[o + 3] = pack(noise(u, v, 1));
  }
  texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  // Bilinear with a nearest mip: half the texel fetches of trilinear, and the
  // smoothed data hides the mip transitions.
  texture.minFilter = THREE.LinearMipmapNearestFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// GLSL: `vnoise(p)` matches noise(p.x, p.y, 0) and vnoise2 matches channel 1;
// vnoiseGrad returns (value, d/dx, d/dy) of field 0 in cell units.
export const NOISE_GLSL = `
  uniform sampler2D noiseTex;
  const float NOISE_CELLS = ${CELLS}.0, NOISE_SIZE = ${SIZE}.0;
  // Smoothstep the fraction between texels so magnified samples do not show
  // bilinear's lattice; the data is already smooth at texel scale.
  vec4 vnoise4(vec2 p) {
    vec2 uv = p * ${TEXELS}.0 - .5, i = floor(uv), f = fract(uv);
    f = f * f * (3.0 - 2.0 * f);
    return texture2D(noiseTex, (i + f + .5) / NOISE_SIZE);
  }
  float vnoise(vec2 p) { return vnoise4(p).r; }
  float vnoise2(vec2 p) { return vnoise4(p).a; }
  vec3 vnoiseGrad(vec2 p) { vec4 s = vnoise4(p); return vec3(s.r, (s.gb - .5) * ${2 * GRADIENT_RANGE}.0); }`;
