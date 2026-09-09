#!/usr/bin/env node
// Procedural aircraft asset builder.
//
// Rebuilds the aircraft GLBs in assets/aircraft/ from dimensioned specs so
// each model can be checked against real three-view drawings and adjusted
// with a number change instead of hand-editing binary geometry.
//
//   node tools/build-aircraft.mjs            # writes F4U_Corsair.glb and Mitsubishi_Zero.glb
//
// Units are metres, matching the real aircraft. Fuselage stations ("x" in
// the spec) are measured aft from the propeller spinner tip; heights are
// relative to the thrust line; spans are from the centreline.
// The GLB is written +Y up, nose -Z, with the origin at the mid-point of
// the overall length. `Airframe` and `Propeller` nodes are required by
// src/aircraft.js, which scales the file to CONFIG.render.aircraftWingspan.
//
// No dependencies beyond the vendored Three.js runtime; the glTF writer
// below is deliberately minimal (positions, normals, indices, PBR colours).

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as THREE from '../vendor/three/three.module.min.js';

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'aircraft');

// ---------------------------------------------------------------------------
// Vought F4U-1 Corsair. Sources: published dimensions (span 41 ft 0 in,
// length 33 ft 4 in, wing area 314 sq ft, Hamilton Standard 13 ft 4 in
// three-blade propeller) and a scaled F4U-1 three-view drawing for the
// station data.
const CORSAIR = {
  name: 'F4U_Corsair',
  length: 10.16,
  span: 12.50,
  markings: 'us',
  // 1942–early 1943 US Navy scheme: non-specular Blue Gray (M-485, ≈FS 35189)
  // over Light Gray (M-495, ≈FS 36440), dark grey walkway panels on both
  // inner wings, black Hamilton Standard blades with yellow tips. See
  // tools/reference/F4U-1.md "Paint scheme".
  colors: {
    upper: '#556878', lower: '#bcbfb8', seam: '#6b7d8d', walkway: '#3a3f46', roundel: '#1c2b48',
    star: '#f0eee6', glass: '#67b9cc', cylinder: '#25372f', dark: '#161d24', hub: '#9aa0a6',
    blade: '#161d24', tip: '#e0b03a',
  },
  paint: {
    fuselage: c => (c.y > -0.32 + 0.02 * c.x ? 'upper' : 'lower'),   // demarcation low on the sides
    cowl: c => (c.y > -0.32 ? 'upper' : 'lower'),
    wing: (c, st) => (c.y > st.h ? 'upper' : 'lower'),
    tailplane: (c, st) => (c.y > st.h ? 'upper' : 'lower'),
    fin: () => 'upper',
    frames: 'upper',
  },
  // Fuselage cross-sections: x, half-width, top, bottom (heights vs thrust line).
  fuselage: [
    { x: 1.85, w: 0.72, top: 0.76, bot: -0.74 },
    { x: 2.40, w: 0.71, top: 0.79, bot: -0.86 },
    { x: 2.90, w: 0.69, top: 0.81, bot: -0.94 },
    { x: 3.60, w: 0.65, top: 0.86, bot: -0.95 },
    { x: 3.95, w: 0.62, top: 0.92, bot: -0.92 },
    { x: 4.30, w: 0.61, top: 0.95, bot: -0.86 },
    { x: 4.85, w: 0.60, top: 1.01, bot: -0.72 },
    { x: 5.20, w: 0.59, top: 1.09, bot: -0.66 },
    { x: 5.45, w: 0.58, top: 1.15, bot: -0.62 },
    { x: 5.95, w: 0.555, top: 1.10, bot: -0.58 },
    { x: 6.40, w: 0.515, top: 1.02, bot: -0.52 },
    { x: 6.90, w: 0.48, top: 0.94, bot: -0.46 },
    { x: 7.35, w: 0.43, top: 0.87, bot: -0.40 },
    { x: 7.85, w: 0.38, top: 0.80, bot: -0.32 },
    { x: 8.35, w: 0.32, top: 0.72, bot: -0.24 },
    { x: 8.85, w: 0.25, top: 0.62, bot: -0.14 },
    { x: 9.35, w: 0.17, top: 0.52, bot: -0.03 },
    { x: 9.80, w: 0.08, top: 0.45, bot: 0.08 },
    { x: 10.10, w: 0.02, top: 0.42, bot: 0.16 },
  ],
  fuselageExponent: 2.3,   // 2 = ellipse; higher = fuller, boxier sides
  // Engine cowling (round), x and radius.
  cowl: [
    { x: 0.50, r: 0.66 }, { x: 0.58, r: 0.71 }, { x: 0.75, r: 0.73 },
    { x: 1.55, r: 0.73 }, { x: 1.90, r: 0.715 },
  ],
  engineFace: { x: 0.52, r: 0.58 },
  cylinders: { count: 9, ring: 0.36, r: 0.085, x0: 0.40, x1: 0.56 },
  hub: [{ x: 0.00, r: 0.05 }, { x: 0.12, r: 0.14 }, { x: 0.30, r: 0.19 }, { x: 0.48, r: 0.19 }],
  // Propeller: pivot station, disc station, diameter, blade planform (radius, half-width).
  propeller: {
    pivot: 0.40, disc: 0.30, diameter: 4.06, blades: 3, yellowTip: 0.12,
    planform: [[0.19, 0.06], [0.45, 0.13], [0.90, 0.165], [1.40, 0.145], [1.80, 0.11], [2.03, 0.03]],
  },
  // Wing half-span stations: span y, leading/trailing edge x, mid height, thickness.
  wing: [
    { y: 0.00, le: 1.95, te: 4.85, h: -0.38, t: 0.44 },
    { y: 0.70, le: 2.15, te: 4.85, h: -0.45, t: 0.42 },
    { y: 1.60, le: 2.18, te: 4.84, h: -0.62, t: 0.40 },
    { y: 2.50, le: 2.22, te: 4.82, h: -0.79, t: 0.38 },
    { y: 3.50, le: 2.28, te: 4.70, h: -0.66, t: 0.30 },
    { y: 4.50, le: 2.34, te: 4.54, h: -0.53, t: 0.24 },
    { y: 5.40, le: 2.40, te: 4.36, h: -0.41, t: 0.18 },
    { y: 5.80, le: 2.46, te: 4.12, h: -0.35, t: 0.14 },
    { y: 6.05, le: 2.62, te: 3.80, h: -0.31, t: 0.10 },
    { y: 6.20, le: 2.85, te: 3.40, h: -0.29, t: 0.06 },
    { y: 6.25, le: 3.05, te: 3.15, h: -0.28, t: 0.02 },
  ],
  foldLine: 2.55,                 // outer panels fold here (also the gull joint)
  aileron: { y0: 3.30, y1: 6.00, chord: 0.22 },
  guns: { spans: [2.85, 3.20, 3.55], protrude: 0.22, r: 0.045 },
  // Non-slip walkway panels on both wings just inboard of the fold, mid-chord to the trailing edge over the flap, per the NASM F4U-1D.
  walkways: [{ side: 1, y0: 1.90, y1: 2.45, c0: 0.40, c1: 1.00 }, { side: -1, y0: 1.90, y1: 2.45, c0: 0.40, c1: 1.00 }],
  // National insignia to the AN-I-9b proportions: star inscribed in a disc
  // of radius r, white bars one radius long and half a radius tall on each
  // side, blue outline one eighth of a radius wide. Both upper wings.
  insignia: { y: 4.25, r: 0.55, sides: [-1, 1] },
  // Horizontal stabiliser half-span stations.
  tailplane: [
    { y: 0.00, le: 8.50, te: 9.90, h: 0.28, t: 0.16 },
    { y: 1.00, le: 8.66, te: 9.84, h: 0.28, t: 0.14 },
    { y: 2.00, le: 8.93, te: 9.70, h: 0.28, t: 0.10 },
    { y: 2.35, le: 9.10, te: 9.58, h: 0.28, t: 0.07 },
    { y: 2.50, le: 9.30, te: 9.45, h: 0.28, t: 0.03 },
  ],
  // Fin + rudder outline (x, height), thickness at base and tip.
  fin: {
    outline: [[7.50, 0.60], [7.75, 1.20], [8.05, 1.85], [8.35, 2.28], [8.60, 2.38], [8.95, 2.34],
      [9.45, 2.00], [9.90, 1.20], [10.16, 0.45], [10.16, 0.20], [9.50, 0.10]],
    thickness: 0.10,
  },
  // Canopy sections: x, half-width, top, sill.
  canopy: [
    { x: 3.95, w: 0.28, top: 0.94, sill: 0.90 },
    { x: 4.30, w: 0.40, top: 1.22, sill: 0.92 },
    { x: 4.85, w: 0.42, top: 1.27, sill: 0.94 },
    { x: 5.20, w: 0.40, top: 1.23, sill: 0.97 },
    { x: 5.50, w: 0.36, top: 1.16, sill: 1.00 },
  ],
  canopyFrames: [4.30, 4.85, 5.20],
  antenna: { x: 2.85, h0: 0.78, h1: 1.55, rake: 0.12 },
};

// ---------------------------------------------------------------------------
// Mitsubishi A6M2 Zero (Model 21, the 1942 carrier fighter). Sources:
// published dimensions (span 12.0 m, length 9.06 m, wing area 22.44 m²,
// Sumitomo-Hamilton 2.9 m three-blade propeller) and a scaled A6M2
// three-view drawing for the station data; see tools/reference/A6M2.md.
const ZERO = {
  name: 'Mitsubishi_Zero',
  length: 9.06,
  span: 12.00,
  markings: 'jp',
  // 1942 Mitsubishi factory finish: overall J3 grey-green ("ame-iro"),
  // blue-black cowling carried back over the nose as an anti-glare panel,
  // hinomaru without white borders, single red fuselage band (Akagi, 1st
  // Carrier Division), polished-metal propeller and spinner. See
  // tools/reference/A6M2.md "Paint scheme".
  colors: {
    airframe: '#a19f88', seam: '#8a8873', walkway: '#2b2d30', cowl: '#1b1d24', band: '#b3282e',
    hinomaru: '#b3282e', glass: '#67b9cc', cylinder: '#25372f', dark: '#161d24', hub: '#bfc3c8',
    blade: '#b3b7bd', tip: '#e0b03a',
  },
  paint: {
    fuselage: c => (c.x < 2.25 && c.y > 0.55 && Math.abs(c.z) < 0.4 ? 'cowl'
      : c.x > 6.30 && c.x < 6.55 ? 'band' : 'airframe'),
    cowl: () => 'cowl',
    wing: () => 'airframe',
    tailplane: () => 'airframe',
    fin: () => 'airframe',
    frames: 'airframe',
  },
  fuselage: [
    { x: 1.50, w: 0.57, top: 0.62, bot: -0.66 },
    { x: 1.95, w: 0.56, top: 0.64, bot: -0.62 },
    { x: 2.25, w: 0.55, top: 0.70, bot: -0.61 },
    { x: 2.60, w: 0.54, top: 0.72, bot: -0.61 },
    { x: 3.20, w: 0.52, top: 0.72, bot: -0.61 },
    { x: 3.90, w: 0.51, top: 0.72, bot: -0.59 },
    { x: 4.20, w: 0.50, top: 0.76, bot: -0.58 },
    { x: 4.55, w: 0.48, top: 0.70, bot: -0.57 },
    { x: 5.20, w: 0.455, top: 0.62, bot: -0.54 },
    { x: 5.80, w: 0.42, top: 0.56, bot: -0.50 },
    { x: 6.30, w: 0.38, top: 0.53, bot: -0.46 },   // fuselage band edges
    { x: 6.55, w: 0.36, top: 0.52, bot: -0.44 },
    { x: 7.00, w: 0.31, top: 0.52, bot: -0.40 },
    { x: 7.60, w: 0.24, top: 0.48, bot: -0.32 },
    { x: 8.20, w: 0.15, top: 0.40, bot: -0.22 },
    { x: 8.70, w: 0.07, top: 0.30, bot: -0.14 },
    { x: 9.00, w: 0.02, top: 0.22, bot: -0.10 },
  ],
  fuselageExponent: 2.2,
  cowl: [
    { x: 0.58, r: 0.50 }, { x: 0.66, r: 0.56 }, { x: 0.85, r: 0.585 },
    { x: 1.30, r: 0.585 }, { x: 1.55, r: 0.57 },
  ],
  engineFace: { x: 0.60, r: 0.46 },
  cylinders: { count: 7, ring: 0.29, r: 0.075, x0: 0.50, x1: 0.64 },
  hub: [{ x: 0.00, r: 0.03 }, { x: 0.15, r: 0.12 }, { x: 0.35, r: 0.19 }, { x: 0.55, r: 0.20 }],
  propeller: {
    pivot: 0.48, disc: 0.42, diameter: 2.90, blades: 3, yellowTip: 0,
    planform: [[0.19, 0.05], [0.40, 0.09], [0.75, 0.11], [1.10, 0.10], [1.35, 0.075], [1.45, 0.02]],
  },
  wing: [
    { y: 0.00, le: 1.72, te: 4.30, h: -0.30, t: 0.36 },
    { y: 0.60, le: 1.72, te: 4.27, h: -0.28, t: 0.36 },
    { y: 1.60, le: 1.80, te: 4.10, h: -0.23, t: 0.33 },
    { y: 2.60, le: 1.87, te: 3.93, h: -0.17, t: 0.29 },
    { y: 3.55, le: 1.94, te: 3.77, h: -0.10, t: 0.24 },
    { y: 4.50, le: 2.01, te: 3.59, h: -0.02, t: 0.19 },
    { y: 5.20, le: 2.07, te: 3.46, h: 0.04, t: 0.14 },
    { y: 5.55, le: 2.16, te: 3.32, h: 0.07, t: 0.10 },
    { y: 5.85, le: 2.38, te: 3.08, h: 0.10, t: 0.06 },
    { y: 6.00, le: 2.66, te: 2.84, h: 0.11, t: 0.02 },
  ],
  aileron: { y0: 3.40, y1: 5.75, chord: 0.24 },
  guns: { spans: [1.95], protrude: 0.28, r: 0.05 },
  walkways: [{ side: -1, y0: 0.60, y1: 0.95, c0: 0.15, c1: 0.95 }],
  insignia: { y: 4.05, r: 0.60, sides: [-1, 1] },
  tailplane: [
    { y: 0.00, le: 6.85, te: 8.20, h: 0.12, t: 0.14 },
    { y: 1.00, le: 7.02, te: 8.14, h: 0.12, t: 0.12 },
    { y: 1.80, le: 7.25, te: 8.04, h: 0.12, t: 0.09 },
    { y: 2.15, le: 7.45, te: 7.92, h: 0.12, t: 0.06 },
    { y: 2.32, le: 7.68, te: 7.80, h: 0.12, t: 0.02 },
  ],
  fin: {
    outline: [[6.95, 0.45], [7.25, 0.95], [7.60, 1.40], [7.95, 1.62], [8.25, 1.60], [8.55, 1.42],
      [8.85, 0.95], [9.06, 0.35], [9.06, 0.05], [8.50, 0.00]],
    thickness: 0.09,
  },
  canopy: [
    { x: 2.25, w: 0.27, top: 0.72, sill: 0.68 },
    { x: 2.60, w: 0.35, top: 0.98, sill: 0.69 },
    { x: 3.10, w: 0.36, top: 1.01, sill: 0.70 },
    { x: 3.60, w: 0.35, top: 0.97, sill: 0.70 },
    { x: 4.00, w: 0.32, top: 0.88, sill: 0.71 },
    { x: 4.25, w: 0.28, top: 0.78, sill: 0.73 },
  ],
  canopyFrames: [2.60, 3.10, 3.60, 4.00],
  antenna: { x: 4.20, h0: 0.74, h1: 1.48, rake: -0.10 },
};

// ---------------------------------------------------------------------------
// Geometry helpers. All build in "spec space" (x aft, y up, z starboard);
// toModel() converts to glTF space at the end.

const lerp = (a, b, t) => a + (b - a) * t;

function ring(points) { return points.map(p => new THREE.Vector3(p[0], p[1], p[2])); }

/** Skin consecutive rings (same point count) into an indexed surface. */
function loft(rings, { closed = true, capStart = false, capEnd = false, flat = false } = {}) {
  const n = rings[0].length;
  const positions = [], indices = [];
  rings.forEach(r => r.forEach(p => positions.push(p.x, p.y, p.z)));
  for (let s = 0; s < rings.length - 1; s++) {
    for (let k = 0; k < (closed ? n : n - 1); k++) {
      const a = s * n + k, b = s * n + (k + 1) % n, c = (s + 1) * n + k, d = (s + 1) * n + (k + 1) % n;
      indices.push(a, c, b, b, c, d);
    }
  }
  const cap = (s, reverse) => {
    const centre = rings[s].reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / n);
    const ci = positions.length / 3; positions.push(centre.x, centre.y, centre.z);
    for (let k = 0; k < n; k++) {
      const a = s * n + k, b = s * n + (k + 1) % n;
      indices.push(...(reverse ? [ci, b, a] : [ci, a, b]));
    }
  };
  if (capStart) cap(0, false);
  if (capEnd) cap(rings.length - 1, true);
  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  if (flat) geometry = geometry.toNonIndexed();
  geometry.computeVertexNormals();
  return geometry;
}

/** Superellipse cross-section with independent top/bottom heights. */
function fuselageRing(x, w, top, bot, e, segments) {
  const pts = [];
  for (let k = 0; k < segments; k++) {
    const a = (k / segments) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const z = Math.sign(c) * Math.pow(Math.abs(c), 2 / e) * w;
    const y = s >= 0 ? Math.pow(s, 2 / e) * top : Math.pow(-s, 2 / e) * bot;
    pts.push([x, y, z]);
  }
  return ring(pts);
}

function circleRing(x, r, segments, y0 = 0, z0 = 0) {
  const pts = [];
  for (let k = 0; k < segments; k++) {
    const a = (k / segments) * Math.PI * 2;
    pts.push([x, y0 + Math.sin(a) * r, z0 + Math.cos(a) * r]);
  }
  return ring(pts);
}

/** Upper-surface height of the lens airfoil, as a fraction of thickness, at chord fraction f. */
const UPPER = [[0, 0], [0.12, 0.40], [0.30, 0.50], [0.70, 0.45], [1, 0]];
function upperAt(f) {
  for (let i = 0; i < UPPER.length - 1; i++) {
    const [f0, h0] = UPPER[i], [f1, h1] = UPPER[i + 1];
    if (f >= f0 && f <= f1) return lerp(h0, h1, (f - f0) / (f1 - f0));
  }
  return 0;
}

/** Lens-shaped airfoil ring at a spanwise station; `side` = ±1 (starboard +). */
function airfoilRing(st, side) {
  const c = st.te - st.le, t = st.t, z = st.y * side;
  const at = (f, hf) => [st.le + c * f, st.h + t * hf, z];
  return ring([at(0, 0), at(0.12, 0.40), at(0.30, 0.50), at(0.70, 0.45), at(1, 0),
    at(0.70, -0.30), at(0.30, -0.50), at(0.12, -0.40)]);
}

/** A decal strip lying on the wing's upper surface between two span stations and two chord fractions. */
function surfaceStrip(stations, side, y0, y1, c0, c1, lift = 0.015, segments = 4) {
  const positions = [], indices = [];
  for (let j = 0; j <= segments; j++) {
    const f = lerp(c0, c1, j / segments);
    for (const y of [y0, y1]) {
      const st = wingAt(stations, y);
      positions.push(st.le + (st.te - st.le) * f, st.h + st.t * upperAt(f) + lift, y * side);
    }
  }
  for (let j = 0; j < segments; j++) { const o = j * 2; indices.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices); g.computeVertexNormals();
  return g;
}

/** Partition a geometry's triangles by the material key `paint(centroid)` returns. */
function splitByPaint(geometry, paint) {
  const pos = geometry.attributes.position, nor = geometry.attributes.normal;
  const index = geometry.index ? geometry.index.array : [...Array(pos.count).keys()];
  const parts = new Map(), centroid = new THREE.Vector3();
  for (let i = 0; i < index.length; i += 3) {
    const tri = [index[i], index[i + 1], index[i + 2]];
    centroid.set(0, 0, 0);
    for (const v of tri) centroid.add(new THREE.Vector3(pos.getX(v), pos.getY(v), pos.getZ(v)));
    centroid.multiplyScalar(1 / 3);
    const key = paint(centroid);
    if (!parts.has(key)) parts.set(key, { p: [], n: [] });
    const part = parts.get(key);
    for (const v of tri) { part.p.push(pos.getX(v), pos.getY(v), pos.getZ(v)); part.n.push(nor.getX(v), nor.getY(v), nor.getZ(v)); }
  }
  const out = new Map();
  for (const [key, { p, n }] of parts) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    g.setIndex([...Array(p.length / 3).keys()]);
    out.set(key, g);
  }
  return out;
}

function lofted(stations, side, opts) {
  return loft(stations.map(st => airfoilRing(st, side)), { capStart: true, flat: true, ...opts });
}

/** Height and upper-surface offset of a wing at span y (linear between stations). */
function wingAt(stations, y) {
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i], b = stations[i + 1];
    if (y >= a.y && y <= b.y) {
      const f = (y - a.y) / (b.y - a.y);
      return { le: lerp(a.le, b.le, f), te: lerp(a.te, b.te, f), h: lerp(a.h, b.h, f), t: lerp(a.t, b.t, f),
        slope: (b.h - a.h) / (b.y - a.y) };
    }
  }
  throw new Error(`span ${y} outside wing`);
}

function box(x0, x1, y0, y1, z0, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/** Thin extruded profile in the x/y plane, centred on z = 0. */
function extrudeProfile(outline, thickness) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.translate(0, 0, -thickness / 2);
  return g;
}

/** Disc with radial subdivisions so it can be draped over a curved wing. */
function disc(r, segments = 24, rings = 2) {
  return new THREE.RingGeometry(0, r, segments, rings);
}

/** Regular five-point star; the 0.382 inner ratio is the true pentagram. */
function star(r, points = 5, inner = 0.382) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const a = Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * inner;
    pts.push(new THREE.Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
  }
  return new THREE.ShapeGeometry(new THREE.Shape(pts));
}

// ---------------------------------------------------------------------------

function buildAircraft(S) {
  const materials = {};
  for (const [key, hex] of Object.entries(S.colors)) {
    materials[key] = new THREE.MeshStandardMaterial({ color: hex, metalness: 0.12, roughness: 0.58, side: THREE.DoubleSide, name: hex });
  }
  const airframe = new THREE.Group(); airframe.name = 'Airframe';
  const propeller = new THREE.Group(); propeller.name = 'Propeller';
  const add = (parent, name, geometry, material) => {
    if (!materials[material]) throw new Error(`${S.name}: no colour named "${material}"`);
    const mesh = new THREE.Mesh(geometry, materials[material]); mesh.name = name; parent.add(mesh); return mesh;
  };
  // Paint a surface: split its triangles by the spec's paint rule for that part.
  const addPainted = (name, geometry, paint) => {
    for (const [material, part] of splitByPaint(geometry, paint)) add(airframe, name, part, material);
  };
  const stationAt = (stations, c) => wingAt(stations, Math.min(Math.abs(c.z), stations[stations.length - 1].y));
  const SEG = 20;

  // Fuselage and cowling.
  addPainted('Fuselage', loft(S.fuselage.map(s => fuselageRing(s.x, s.w, s.top, s.bot, S.fuselageExponent, SEG)),
    { capStart: true, capEnd: true }), S.paint.fuselage);
  addPainted('Radial_cowling', loft(S.cowl.map(s => circleRing(s.x, s.r, SEG)), { capStart: true, capEnd: true }), S.paint.cowl);
  const face = new THREE.CircleGeometry(S.engineFace.r, SEG); face.rotateY(-Math.PI / 2); face.translate(S.engineFace.x, 0, 0);
  add(airframe, 'Engine_face', face, 'dark');
  for (let i = 0; i < S.cylinders.count; i++) {
    const a = (i / S.cylinders.count) * Math.PI * 2;
    const g = new THREE.CylinderGeometry(S.cylinders.r, S.cylinders.r, S.cylinders.x1 - S.cylinders.x0, 8);
    g.rotateZ(Math.PI / 2); g.translate((S.cylinders.x0 + S.cylinders.x1) / 2, Math.sin(a) * S.cylinders.ring, Math.cos(a) * S.cylinders.ring);
    add(airframe, 'Radial_engine', g, 'cylinder');
  }

  // Wings, fold line, ailerons, guns.
  for (const side of [-1, 1]) {
    const name = side > 0 ? 'Right' : 'Left';
    addPainted(`${name}_wing`, lofted(S.wing, side), c => S.paint.wing(c, stationAt(S.wing, c)));
    if (S.foldLine) {
      const fold = wingAt(S.wing, S.foldLine);
      add(airframe, 'Wing_fold_seam', box(fold.le + 0.05, fold.te - 0.05, fold.h + fold.t * 0.5 - 0.01, fold.h + fold.t * 0.5 + 0.012,
        (S.foldLine - 0.02) * side, (S.foldLine + 0.02) * side), 'seam');
    }
    const hinge = y => { const w = wingAt(S.wing, y); return { x: w.te - (w.te - w.le) * S.aileron.chord, y: w.h + w.t * 0.45 + 0.012, z: y * side }; };
    const h0 = hinge(S.aileron.y0), h1 = hinge(S.aileron.y1);
    const seam = new THREE.BufferGeometry();
    seam.setAttribute('position', new THREE.Float32BufferAttribute([
      h0.x - 0.02, h0.y, h0.z, h0.x + 0.02, h0.y, h0.z, h1.x + 0.02, h1.y, h1.z, h1.x - 0.02, h1.y, h1.z], 3));
    seam.setIndex([0, 2, 1, 0, 3, 2]); seam.computeVertexNormals();
    add(airframe, 'Aileron_seam', seam, 'seam');
    for (const y of S.guns.spans) {
      const w = wingAt(S.wing, y);
      const g = new THREE.CylinderGeometry(S.guns.r, S.guns.r, S.guns.protrude + 0.3, 8);
      g.rotateZ(Math.PI / 2); g.translate(w.le - S.guns.protrude / 2 + 0.15, w.h - w.t * 0.1, y * side);
      add(airframe, 'Gun_barrel', g, 'dark');
    }
  }

  // Walkways (non-slip panels on the wing root the pilot boards from).
  for (const w of S.walkways || []) add(airframe, 'Walkway', surfaceStrip(S.wing, w.side, w.y0, w.y1, w.c0, w.c1), 'walkway');

  // Tail.
  for (const side of [-1, 1]) addPainted('Tailplane', lofted(S.tailplane, side), c => S.paint.tailplane(c, stationAt(S.tailplane, c)));
  addPainted('Vertical_tail', extrudeProfile(S.fin.outline, S.fin.thickness), S.paint.fin);

  // Canopy: glass shell, hoops, spine.
  const canopyRing = s => {
    const pts = [];
    const n = 12;
    for (let k = 0; k <= n; k++) {
      const a = Math.PI * (k / n);      // 0 = starboard sill, PI = port sill
      pts.push([s.x, s.sill + Math.sin(a) * (s.top - s.sill), Math.cos(a) * s.w]);
    }
    return ring(pts);
  };
  add(airframe, 'Canopy_glass', loft(S.canopy.map(canopyRing), { closed: false, capStart: true }), 'glass');
  for (const x of S.canopyFrames) {
    const s = S.canopy.find(c => c.x === x);
    const hoop = [];
    for (let k = 0; k <= 12; k++) {
      const a = Math.PI * (k / 12);
      hoop.push(new THREE.Vector3(x, s.sill + Math.sin(a) * (s.top - s.sill) + 0.01, Math.cos(a) * (s.w + 0.01)));
    }
    const curve = new THREE.CatmullRomCurve3(hoop);
    add(airframe, 'Canopy_frame', new THREE.TubeGeometry(curve, 12, 0.03, 5, false), S.paint.frames);
  }
  const spine = S.canopy.map(s => new THREE.Vector3(s.x, s.top + 0.01, 0));
  add(airframe, 'Canopy_spine', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(spine), 8, 0.028, 5, false), S.paint.frames);

  // Antenna mast ahead of the windscreen.
  const mast = box(-0.03, 0.03, 0, S.antenna.h1 - S.antenna.h0, -0.015, 0.015);
  mast.rotateZ(-Math.atan2(S.antenna.rake, S.antenna.h1 - S.antenna.h0)); mast.translate(S.antenna.x, S.antenna.h0, 0);
  add(airframe, 'Antenna', mast, 'dark');

  // National insignia on the upper wings: US star-and-bars or hinomaru.
  // Markings are draped onto the wing's upper surface (thickness and
  // dihedral both vary along the span, so a flat decal would clip through).
  const tipY = S.wing[S.wing.length - 1].y;
  const drape = (geometry, lift) => {
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const st = wingAt(S.wing, Math.min(Math.abs(p.getZ(i)), tipY));
      const f = Math.min(Math.max((p.getX(i) - st.le) / (st.te - st.le), 0), 1);
      p.setY(i, st.h + st.t * upperAt(f) + lift);
    }
    geometry.computeVertexNormals();
    return geometry;
  };
  for (const side of S.insignia.sides) {
    const w = wingAt(S.wing, S.insignia.y), cx = (w.le + w.te) / 2, cz = S.insignia.y * side;
    // A flat shape drawn in XY (y = forward) laid on the wing at the insignia centre.
    const placeShape = (geometry, name, material, lift) => {
      geometry.rotateX(-Math.PI / 2); geometry.rotateY(Math.PI / 2);   // shape x → span, shape y → forward
      geometry.translate(cx, 0, cz);
      add(airframe, name, drape(geometry, lift), material);
    };
    // A rectangle `halfSpan` × `halfChord`, subdivided along the span so it follows the wing.
    const placeRect = (name, material, halfSpan, halfChord, lift) => {
      const g = new THREE.PlaneGeometry(halfChord * 2, halfSpan * 2, 1, 8);
      g.rotateX(-Math.PI / 2); g.translate(cx, 0, cz);
      add(airframe, name, drape(g, lift), material);
    };
    if (S.markings === 'us') {
      // Layered bottom-up: blue outline, white bars, blue disc (covers the
      // bars' inner ends), white star.
      const R = S.insignia.r, edge = R / 8;
      placeRect('Insignia_outline', 'roundel', 2 * R + edge, R / 4 + edge, 0.015);
      placeRect('Insignia_bar', 'star', 2 * R, R / 4, 0.025);
      placeShape(disc(R + edge), 'US_roundel', 'roundel', 0.035);
      placeShape(star(R), 'US_star', 'star', 0.045);
    } else {
      placeShape(disc(S.insignia.r), 'Hinomaru', 'hinomaru', 0.03);
    }
  }

  // Propeller: hub, cuffed blades, yellow tips. Built relative to the pivot.
  const P = S.propeller;
  propeller.position.set(P.pivot, 0, 0);
  add(propeller, 'Propeller_hub', loft(S.hub.map(s => circleRing(s.x - P.pivot, s.r, 12)), { capStart: true, capEnd: true }), 'hub');
  const discX = P.disc - P.pivot;
  for (let b = 0; b < P.blades; b++) {
    const a = (b / P.blades) * Math.PI * 2;
    const blade = [], tip = [];
    const bladeR = P.diameter / 2;
    for (const [r, hw] of P.planform) {
      const rr = Math.min(r, bladeR);
      (rr >= bladeR - P.yellowTip ? tip : blade).push([rr, hw]);
    }
    const cut = bladeR - P.yellowTip;
    const hwAt = r => { for (let i = 0; i < P.planform.length - 1; i++) { const [r0, w0] = P.planform[i], [r1, w1] = P.planform[i + 1]; if (r >= r0 && r <= r1) return lerp(w0, w1, (r - r0) / (r1 - r0)); } return 0; };
    blade.push([cut, hwAt(cut)]); tip.unshift([cut, hwAt(cut)]);
    const strip = (pts, x) => {
      const positions = [], indices = [];
      pts.forEach(([r, hw]) => {
        const u = new THREE.Vector3(x, Math.cos(a) * r, Math.sin(a) * r);
        const v = new THREE.Vector3(0, -Math.sin(a) * hw, Math.cos(a) * hw);
        positions.push(u.x + v.x, u.y + v.y, u.z + v.z, u.x - v.x, u.y - v.y, u.z - v.z);
      });
      for (let i = 0; i < pts.length - 1; i++) { const o = i * 2; indices.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setIndex(indices); g.computeVertexNormals();
      return g;
    };
    add(propeller, `Propeller_blade_${b}`, strip(blade, discX), 'blade');
    if (P.yellowTip > 0) add(propeller, `Yellow_blade_tip_${b}`, strip(tip, discX - 0.005), 'tip');
  }

  const root = new THREE.Group(); root.name = S.name;
  root.add(airframe, propeller);
  return root;
}

// ---------------------------------------------------------------------------
// P-38: dimensioned arcade model, with a short cockpit pod and two engine
// booms joined by the horizontal stabilizer. Overall span/length from NMUSAF:
// https://www.nationalmuseum.af.mil/Visit/Museum-Exhibits/Fact-Sheets/Display/article/196280/lockheed-p-38l-lightning/
// Stations below are an artistic approximation, not surveyed engineering data.
const LIGHTNING = { name: 'P38_Lightning', length: 11.5316, span: 15.8496 };
function buildLightning() {
  const root = new THREE.Group(); root.name = LIGHTNING.name;
  const body = new THREE.Group(); body.name = 'Airframe'; root.add(body);
  const colors = { olive: '#69705b', lower: '#b1b6aa', dark: '#273033', glass: '#66b7c8', metal: '#aeb4b5', yellow: '#ddb849', white: '#f1eee1', blue: '#23394d' };
  const mats = Object.fromEntries(Object.entries(colors).map(([k,color]) => [k,new THREE.MeshStandardMaterial({color, roughness:.58, metalness:.15, side:THREE.DoubleSide})]));
  const add = (name, g, mat='olive', parent=body) => { const m=new THREE.Mesh(g,mats[mat]);m.name=name;parent.add(m);return m; };
  const hull = (name, stations, offset=0, mat='olive') => {
    const g=loft(stations.map(([x,w,top,bot])=>fuselageRing(x,w,top,bot,2,20)),{capStart:true,capEnd:true});
    g.translate(0,0,offset); add(name,g,mat);
  };
  const wing=[{y:0,le:3.35,te:5.85,h:0,t:.38},{y:2.55,le:3.5,te:5.8,h:.05,t:.35},{y:5.6,le:3.9,te:5.45,h:.24,t:.23},{y:7.65,le:4.35,te:5.12,h:.39,t:.09},{y:7.9248,le:4.62,te:4.88,h:.42,t:.025}];
  for(const side of [-1,1]) {
    add('Main_wing',lofted(wing,side));
    add('Aileron',surfaceStrip(wing,side,4.5,7.55,.8,.82),'dark');
    const z=side*2.45;
    hull('Engine_boom',[[.38,.12,.12,-.12],[.9,.4,.48,-.4],[2,.48,.6,-.66],[3.7,.43,.5,-.56],[5.3,.32,.36,-.35],[7,.21,.25,-.18],[9,.13,.23,-.1],[10.9,.08,.23,-.04],[11.5316,.015,.18,.02]],z);
    hull('Radiator',[[4.9,.16,-.04,-.24],[5.2,.35,.12,-.32],[5.9,.3,.12,-.3],[6.4,.12,.02,-.13]],z+side*.28,'lower');
    const fin=extrudeProfile([[8.5,.18],[9.25,1.48],[9.8,1.78],[10.35,1.73],[11.48,.6],[11.5316,.04],[10.1,.03]],.12);fin.translate(0,0,z);add('Twin_tail',fin);
    add('Turbocharger',box(4.75,5.45,.33,.46,z-.16,z+.16),'dark');
    const prop=new THREE.Group();prop.name=side<0?'Propeller':'Propeller_2';prop.position.set(.42,0,z);root.add(prop);
    add('Spinner',loft([[0,.035],[.18,.15],[.42,.23],[.55,.2]].map(([x,r])=>circleRing(x-.42,r,16)),{capStart:true,capEnd:true}),'metal',prop);
    for(let i=0;i<3;i++) {
      const a=i*Math.PI*2/3;
      const blade=box(-.045,.025,.19,1.55,-.095,.095);blade.rotateX(a);add('Blade',blade,'dark',prop);
      const tip=box(-.046,.026,1.55,1.66,-.09,.09);tip.rotateX(a);add('Blade_tip',tip,'yellow',prop);
    }
    const roundel=disc(.48);roundel.rotateX(-Math.PI/2);roundel.translate(4.55,.42,side*5.8);add('US_roundel',roundel,'blue');
    const emblem=star(.4);emblem.rotateX(-Math.PI/2);emblem.translate(4.55,.43,side*5.8);add('US_star',emblem,'white');
  }
  const tail=[{y:0,le:9.35,te:10.65,h:.18,t:.14},{y:2.45,le:9.35,te:10.65,h:.18,t:.12},{y:2.85,le:9.55,te:10.5,h:.18,t:.06}];
  for(const side of [-1,1]) add('Connecting_tailplane',lofted(tail,side));
  hull('Cockpit_pod',[[.72,.05,.1,-.15],[1.45,.3,.38,-.43],[2.5,.49,.53,-.6],[3.45,.51,.63,-.58],[4.65,.42,.54,-.4],[5.8,.19,.27,-.19],[6.3,.015,.08,-.04]]);
  hull('Canopy',[[2.55,.25,.59,.4],[3.05,.37,1.05,.48],[3.7,.37,1.1,.52],[4.25,.29,.83,.49],[4.7,.05,.56,.48]],0,'glass');
  add('Canopy_frame',box(3.03,3.08,.56,1.06,-.37,.37),'olive');
  add('Canopy_spine',box(3.08,3.72,1.09,1.12,-.025,.025),'olive');
  for(const z of [-.18,-.06,.06,.18]) add('Nose_gun',box(.57,1.18,-.025,.025,z-.022,z+.022),'dark');
  return root;
}

// Spec space → glTF space: x aft → +z, y up → +y, z starboard → +x,
// then shift so the origin sits at the length mid-point.
// Swapping x and z mirrors the handedness, so triangle winding is reversed
// too; otherwise Three.js's double-sided shading treats the outside as the
// back face and lights it from within.
function toModel(root, S) {
  const shift = S.length / 2;
  root.traverse(node => {
    if (node.isMesh) {
      const g = node.geometry, p = g.attributes.position, n = g.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        p.setXYZ(i, z, y, x - (node.parent.name.startsWith('Propeller') ? 0 : shift));
        if (n) { const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i); n.setXYZ(i, nz, ny, nx); }
      }
      if (g.index) {
        const idx = g.index.array;
        for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      } else {
        for (let i = 0; i < p.count; i += 3) {
          for (const attr of [p, n]) {
            const x = attr.getX(i + 1), y = attr.getY(i + 1), z = attr.getZ(i + 1);
            attr.setXYZ(i + 1, attr.getX(i + 2), attr.getY(i + 2), attr.getZ(i + 2));
            attr.setXYZ(i + 2, x, y, z);
          }
        }
      }
      g.computeBoundingBox();
    } else if (node.name.startsWith('Propeller')) {
      node.position.set(node.position.z, node.position.y, node.position.x - shift);
    }
  });
}

// ---------------------------------------------------------------------------
// Minimal GLB writer.
function writeGLB(root, file) {
  const json = { asset: { version: '2.0', generator: 'Procedural aircraft asset builder' }, scene: 0, scenes: [{ nodes: [] }],
    nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
  const chunks = []; let offset = 0;
  const materialIndex = new Map();
  const pushView = (array, target) => {
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    chunks.push(bytes, Buffer.alloc(pad)); offset += bytes.length + pad;
    return json.bufferViews.length - 1;
  };
  const material = m => {
    if (!materialIndex.has(m.uuid)) {
      json.materials.push({ name: m.name, doubleSided: true, pbrMetallicRoughness: {
        baseColorFactor: [m.color.r, m.color.g, m.color.b, 1], metallicFactor: m.metalness, roughnessFactor: m.roughness } });
      materialIndex.set(m.uuid, json.materials.length - 1);
    }
    return materialIndex.get(m.uuid);
  };
  const mesh = m => {
    const g = m.geometry;
    // src/aircraft.js merges meshes per material, which needs every geometry indexed.
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    const pos = g.attributes.position.array, nor = g.attributes.normal.array;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
    const attributes = {};
    json.accessors.push({ bufferView: pushView(new Float32Array(pos), 34962), componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
    attributes.POSITION = json.accessors.length - 1;
    json.accessors.push({ bufferView: pushView(new Float32Array(nor), 34962), componentType: 5126, count: nor.length / 3, type: 'VEC3' });
    attributes.NORMAL = json.accessors.length - 1;
    const primitive = { attributes, material: material(m.material), mode: 4 };
    if (g.index) {
      const idx = g.index.array; const wide = pos.length / 3 > 65535;
      json.accessors.push({ bufferView: pushView(wide ? new Uint32Array(idx) : new Uint16Array(idx), 34963), componentType: wide ? 5125 : 5123, count: idx.length, type: 'SCALAR' });
      primitive.indices = json.accessors.length - 1;
    }
    json.meshes.push({ name: m.name, primitives: [primitive] });
    return json.meshes.length - 1;
  };
  const node = obj => {
    const n = { name: obj.name };
    if (obj.position.lengthSq() > 0) n.translation = obj.position.toArray();
    if (obj.isMesh) n.mesh = mesh(obj);
    const index = json.nodes.push(n) - 1;
    const children = obj.children.map(node);
    if (children.length) n.children = children;
    return index;
  };
  json.scenes[0].nodes.push(node(root));
  const bin = Buffer.concat(chunks);
  json.buffers.push({ byteLength: bin.length });
  let jsonBuf = Buffer.from(JSON.stringify(json));
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12); header.write('glTF', 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(jsonBuf.length, 0); jsonHeader.writeUInt32LE(0x4E4F534A, 4);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(bin.length, 0); binHeader.writeUInt32LE(0x004E4942, 4);
  writeFileSync(file, Buffer.concat([header, jsonHeader, jsonBuf, binHeader, bin]));
  let triangles = 0; root.traverse(o => { if (o.isMesh) triangles += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  return { triangles, bytes: 12 + 8 + jsonBuf.length + 8 + bin.length };
}

for (const spec of [CORSAIR, ZERO, LIGHTNING]) {
  const aircraft = spec === LIGHTNING ? buildLightning() : buildAircraft(spec);
  toModel(aircraft, spec);
  const out = path.join(OUT_DIR, `${spec.name}.glb`);
  const info = writeGLB(aircraft, out);
  console.log(`${path.relative(process.cwd(), out)}: ${info.triangles} triangles, ${(info.bytes / 1024).toFixed(0)} KB`);
}
