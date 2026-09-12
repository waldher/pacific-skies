// Island scenery: biomes, relief-shaded ground, forests, villages, roads and
// the agents that travel them. Everything derives from the island seed and the
// shared noise field, so every device sees the same hills, and the forests
// stand exactly where the ground shader shades the slopes.
//
// Cost model: one draw for the ground (a flat polygon coloured per pixel from
// the noise texture), one for the beach, one for the whole vertex-coloured
// scenery batch, and one each for the surf and shallows skirts. Nothing here
// casts shadows.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { islandOutline, insidePolygon } from './surface.js';
import { noise, noiseTexture, NOISE_GLSL } from './noise.js';
import { TAU, hash2 } from './util.js';

export const HILL_SCALE = .012;     // world units → hill-noise cells (≈83 units per cell)
const FOREST_SCALE = .02;

const BIOMES = {
  jungle:    { sand: '#e6d7a4', low: '#3f7f3c', high: '#2c5a2f', patch: '#5c9a45', rock: '#5d6552', trees: ['#2e6d35', '#3b8342', '#27612c', '#4a8f3d'], palms: true, forest: .62, huts: 'thatch', road: '#8a7a58', mountains: true },
  temperate: { sand: '#e3d49b', low: '#7aa650', high: '#537d3c', patch: '#a6bf66', rock: '#7a7468', trees: ['#4d8b3a', '#63a04a', '#8c9a3a', '#3f7a35'], palms: false, forest: .45, huts: 'house', road: '#5b5a57', fields: true, mountains: true, snow: true },
  volcanic:  { sand: '#4d4945', low: '#4c7040', high: '#3c3a38', patch: '#6a8150', rock: '#2f2d2b', trees: ['#2f6a37', '#3d7f44', '#356f3a'], palms: true, forest: .38, huts: 'thatch', road: '#6b625a', volcano: true },
  atoll:     { sand: '#f3ead0', low: '#b8c586', high: '#8ea86a', patch: '#d3d49a', rock: '#b5ad95', trees: ['#4d9a4b', '#5faa53', '#3f8a44'], palms: true, forest: .34, huts: 'thatch', road: '#cbb98e', palmOnly: true },
  desert:    { sand: '#ecd9a3', low: '#dcbd78', high: '#b98a55', patch: '#c9a465', rock: '#8f6a4c', trees: ['#6c7a3f', '#7b8746'], palms: true, forest: .1, huts: 'adobe', road: '#a88d62', dunes: true, oasis: true, scrub: true },
  savanna:   { sand: '#e9d9a2', low: '#bcae5e', high: '#9c8c48', patch: '#d0c272', rock: '#8a7a5a', trees: ['#5d6e2f', '#6f7f35', '#54662a'], palms: false, forest: .24, huts: 'thatch', road: '#a08c5e', acacia: true, scrub: true },
};
const ROOFS = ['#a8412f', '#8a4b3a', '#6b6f74', '#9c7a4e', '#b3543a'];
const WALLS = ['#ece4d2', '#e3d6bd', '#d9cfc0', '#efe7d8'];

function seeded(seed) {
  let t = Math.imul(Math.floor(seed) | 0, 2654435761) >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ t >>> 15, 1 | t);
    r ^= r + Math.imul(r ^ r >>> 7, 61 | r);
    return ((r ^ r >>> 14) >>> 0) / 4294967296;
  };
}
const colorCache = new Map();
function rgb(hex) {
  let c = colorCache.get(hex);
  if (!c) { const k = new THREE.Color(hex); c = [k.r, k.g, k.b]; colorCache.set(hex, c); }
  return c;
}
const shade = ([r, g, b], f) => [r * f, g * f, b * f];
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Region climate first, then the island's own roll: neighbours look related
// without every island in a chain being a copy.
export function biomeFor(t, sectors, geographySeed = 0) {
  if (t.kind === 'reef') return 'atoll';
  const regionId = t.region ?? t.sector ?? 0;
  const region = sectors?.find(s => s.id === regionId);
  const climate = seeded(geographySeed * 31 + regionId * 7 + 11)();
  const roll = seeded((t.seed ?? t.id ?? 0) * 13 + 5)();
  const identity = region?.identity ?? (regionId === 0 ? 'great island' : 'volcanic arc');
  if (regionId !== 0 && climate < .22) return t.radius < 200 ? 'atoll' : roll < .65 ? 'desert' : 'savanna';
  if (t.kind === 'mainland') return regionId === 0 ? 'temperate' : roll < .6 ? 'temperate' : 'jungle';
  if (identity === 'great island') return roll < (regionId === 0 ? .7 : .5) ? 'temperate' : roll < .85 ? 'jungle' : 'savanna';
  if (identity === 'volcanic arc') return roll < .45 && t.radius > 260 ? 'volcanic' : 'jungle';
  if (identity === 'drowned caldera') return roll < .65 ? 'jungle' : 'atoll';
  return roll < .55 ? 'atoll' : 'desert';
}

// Narrow beaches follow concave lagoon shores instead of shrinking toward an
// arbitrary island center (which would put grass across the water).
export function insetShore(points, distance) {
  const area = points.reduce((n, p, i) => { const q = points[(i + 1) % points.length]; return n + p[0] * q[1] - q[0] * p[1]; }, 0);
  const sign = area > 0 ? 1 : -1;
  return points.map((p, i) => {
    const prev = points[(i + points.length - 1) % points.length], next = points[(i + 1) % points.length];
    const l1 = Math.hypot(p[0] - prev[0], p[1] - prev[1]), l2 = Math.hypot(next[0] - p[0], next[1] - p[1]);
    const n1 = [-(p[1] - prev[1]) / l1 * sign, (p[0] - prev[0]) / l1 * sign];
    const n2 = [-(next[1] - p[1]) / l2 * sign, (next[0] - p[0]) / l2 * sign];
    const k = distance / Math.max(.4, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
    const q = [p[0] + (n1[0] + n2[0]) * k, p[1] + (n1[1] + n2[1]) * k];
    return insidePolygon(q[0], q[1], points) ? q : p;
  });
}
function segmentDistance(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}
const polygonDistance = (x, y, points) => points.reduce((best, p, i) => Math.min(best, segmentDistance(x, y, p, points[(i + 1) % points.length])), Infinity);

// Vertex-coloured triangle soup with flat normals. Everything on an island
// goes through one of these, so scenery is a single draw call.
class Batch {
  constructor() { this.n = 0; this.pos = new Float32Array(9 * 1024); this.col = new Float32Array(9 * 1024); this.nrm = new Float32Array(9 * 1024); }
  grow() {
    const size = this.pos.length * 2;
    for (const key of ['pos', 'col', 'nrm']) { const next = new Float32Array(size); next.set(this[key]); this[key] = next; }
  }
  // Points are [x, y, z] in three space (x, height, z). `ref` is a point on the
  // inside of the surface; the face normal is flipped to point away from it.
  face(points, color, ref) {
    for (let i = 1; i + 1 < points.length; i++) this.tri(points[0], points[i], points[i + 1], color, ref);
  }
  tri(a, b, c, color, ref, colors = null) {
    if ((this.n + 3) * 3 > this.pos.length) this.grow();
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len;
    const cx = (a[0] + b[0] + c[0]) / 3 - ref[0], cy = (a[1] + b[1] + c[1]) / 3 - ref[1], cz = (a[2] + b[2] + c[2]) / 3 - ref[2];
    let flip = false;
    if (nx * cx + ny * cy + nz * cz < 0) { nx = -nx; ny = -ny; nz = -nz; flip = true; }
    // Wind counter-clockwise around the outward normal so the face is front-facing.
    const order = flip ? [a, c, b] : [a, b, c], tints = colors ? (flip ? [colors[0], colors[2], colors[1]] : colors) : null;
    for (let i = 0; i < 3; i++) {
      const p = order[i], tint = tints ? tints[i] : color, o = this.n * 3;
      this.pos[o] = p[0]; this.pos[o + 1] = p[1]; this.pos[o + 2] = p[2];
      this.nrm[o] = nx; this.nrm[o + 1] = ny; this.nrm[o + 2] = nz;
      this.col[o] = tint[0]; this.col[o + 1] = tint[1]; this.col[o + 2] = tint[2];
      this.n++;
    }
  }
  // Sides fade from `color` at the base to `top` at the apex; alternate faces
  // are slightly darker so the facets read from straight above.
  cone(x, y, base, radius, height, segments, color, top = color, phase = 0) {
    const apex = [x, base + height, y], ref = [x, base - 1, y];
    for (let i = 0; i < segments; i++) {
      const a0 = phase + i / segments * TAU, a1 = phase + (i + 1) / segments * TAU;
      const c = i % 2 ? color : shade(color, .9), t = i % 2 ? top : shade(top, .9);
      this.tri([x + Math.cos(a0) * radius, base, y + Math.sin(a0) * radius], [x + Math.cos(a1) * radius, base, y + Math.sin(a1) * radius], apex, c, ref, [c, c, t]);
    }
  }
  disc(x, y, h, radius, segments, color, phase = 0) {
    const ref = [x, h - 1, y], pts = [];
    for (let i = 0; i < segments; i++) { const a = phase + i / segments * TAU; pts.push([x + Math.cos(a) * radius, h, y + Math.sin(a) * radius]); }
    this.face(pts, color, ref);
  }
  // Axis-aligned in a frame rotated by `angle`; `w` along the frame's x.
  box(x, y, base, w, d, height, angle, wall, top = wall) {
    const c = Math.cos(angle), s = Math.sin(angle), ref = [x, base + height / 2, y];
    const corner = (u, v, h) => [x + u * c - v * s, h, y + u * s + v * c];
    const hw = w / 2, hd = d / 2, t = base + height;
    this.face([corner(-hw, -hd, t), corner(hw, -hd, t), corner(hw, hd, t), corner(-hw, hd, t)], top, ref);
    for (const [u0, v0, u1, v1] of [[-hw, -hd, hw, -hd], [hw, -hd, hw, hd], [hw, hd, -hw, hd], [-hw, hd, -hw, -hd]]) {
      this.face([corner(u0, v0, base), corner(u1, v1, base), corner(u1, v1, t), corner(u0, v0, t)], wall, ref);
    }
  }
  // Gabled roof: ridge runs along the frame's x axis.
  roof(x, y, base, w, d, height, angle, color) {
    const c = Math.cos(angle), s = Math.sin(angle), ref = [x, base - 1, y];
    const corner = (u, v, h) => [x + u * c - v * s, h, y + u * s + v * c];
    const hw = w / 2 + 1, hd = d / 2 + 1;
    this.face([corner(-hw, -hd, base), corner(hw, -hd, base), corner(hw, 0, base + height), corner(-hw, 0, base + height)], color, ref);
    this.face([corner(-hw, 0, base + height), corner(hw, 0, base + height), corner(hw, hd, base), corner(-hw, hd, base)], shade(color, .8), ref);
  }
  // Five fronds radiating from a crown: reads as a palm from straight above.
  palm(x, y, base, radius, color, phase) {
    const crown = base + 9, ref = [x, base, y];
    for (let i = 0; i < 6; i++) {
      const a = phase + i / 6 * TAU, wa = a + .28, wb = a - .28;
      const tip = [x + Math.cos(a) * radius, crown - 3, y + Math.sin(a) * radius];
      this.tri([x + Math.cos(wa) * 2.2, crown, y + Math.sin(wa) * 2.2], [x + Math.cos(wb) * 2.2, crown, y + Math.sin(wb) * 2.2], tip, i % 2 ? color : shade(color, .85), ref);
    }
    this.disc(x, y, crown + .2, 2.4, 5, shade(color, .7));
  }
  // Ribbon along a polyline, mitred at the joints.
  ribbon(points, width, h, color) {
    const ref = [points[0][0], h - 1, points[0][1]], left = [], right = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i], prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
      const dx = next[0] - prev[0], dy = next[1] - prev[1], l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l * width / 2, ny = dx / l * width / 2;
      left.push([p[0] + nx, h, p[1] + ny]); right.push([p[0] - nx, h, p[1] - ny]);
    }
    for (let i = 0; i + 1 < points.length; i++) this.face([left[i], right[i], right[i + 1], left[i + 1]], color, ref);
  }
  build() {
    const geometry = new THREE.BufferGeometry();
    const count = this.n * 3;
    geometry.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, count), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(0, count), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, count), 3));
    return geometry;
  }
}

// Ground: the interior polygon, coloured per pixel from the noise field with
// slope lighting that matches the Lambert scenery, plus cloud shadows shared
// with the ocean. Per-island uniforms pick the biome palette.
function groundShader(shared) {
  const L = CONFIG.render.lighting;
  return new THREE.ShaderMaterial({
    uniforms: {
      noiseTex: { value: noiseTexture() }, time: shared.time, wind: shared.wind,
      cloudSpeed: shared.cloudSpeed, cloudStrength: shared.cloudStrength, sunDir: shared.sunDir,
      sunLight: { value: new THREE.Color(L.sun).multiplyScalar(L.sunIntensity) },
      skyLight: { value: new THREE.Color(L.sky).multiplyScalar(L.hemisphere) },
      groundLight: { value: new THREE.Color(L.ground).multiplyScalar(L.hemisphere) },
      low: { value: new THREE.Color() }, high: { value: new THREE.Color() }, patchColor: { value: new THREE.Color() }, rock: { value: new THREE.Color() },
      fields: { value: 0 }, dunes: { value: 0 }, relief: { value: 60 }, origin: { value: new THREE.Vector2() }, angle: { value: 0 },
      cropA: { value: new THREE.Color('#d1b04e') }, cropB: { value: new THREE.Color('#9ab84f') }, cropC: { value: new THREE.Color('#a87f4c') }, cropD: { value: new THREE.Color('#4f8040') }, hedgeColor: { value: new THREE.Color('#2f4a24') },
    },
    vertexShader: `varying vec2 worldXZ;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        worldXZ = world.xz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `varying vec2 worldXZ;
      uniform float time, cloudSpeed, cloudStrength, fields, dunes, relief, angle;
      uniform vec2 wind, origin; uniform vec3 sunDir, sunLight, skyLight, groundLight, low, high, patchColor, rock, cropA, cropB, cropC, cropD, hedgeColor;
      ${NOISE_GLSL}
      const float HILL = ${HILL_SCALE};
      void main() {
        vec2 p = worldXZ;
        float ca = cos(angle), sa = sin(angle);
        vec2 q = mat2(ca, -sa, sa, ca) * (p - origin);   // island-local, so fields align with the coast
        vec3 coarse = vnoiseGrad(p * HILL), fine = vnoiseGrad(p * HILL * 3.1 + 5.0);
        float hill = coarse.x;
        float h = hill * .72 + fine.x * .28;
        vec2 g = (coarse.yz * .72 + fine.yz * (.28 * 3.1)) * HILL;
        float speck = vnoise2(p * .045);
        vec3 albedo = mix(low, high, smoothstep(.34, .8, h));
        albedo = mix(albedo, patchColor, smoothstep(.55, .75, speck) * .55);
        albedo = mix(albedo, rock, smoothstep(.76, .9, h));
        if (fields > .5) {
          // Farmland: patchwork fields in the lowlands, each with its own crop, hedged.
          float farm = vnoise2(q * .0045 + 7.3);
          float use = smoothstep(.5, .55, farm) * (1.0 - smoothstep(.5, .6, h));
          vec2 cell = floor(q / 72.0), f = fract(q / 72.0);
          float pick = vnoise2(cell * 5.3 + 1.5);
          vec3 crop = pick < .3 ? cropA : pick < .55 ? cropB : pick < .8 ? cropC : cropD;
          crop *= .9 + .1 * step(.5, fract(q.x / 6.0 + pick * 3.0));
          float hedge = smoothstep(.0, .045, f.x) * smoothstep(.0, .045, f.y) * (1.0 - smoothstep(.955, 1.0, f.x)) * (1.0 - smoothstep(.955, 1.0, f.y));
          albedo = mix(albedo, mix(hedgeColor, crop, hedge), use);
        }
        if (dunes > .5) {
          float u = (q.x + vnoise(p * .02) * 45.0) * .12 + q.y * .01;
          albedo *= .94 + .06 * sin(u);
          g += mat2(ca, sa, -sa, ca) * (cos(u) * vec2(.12, .01)) * .02;
        }
        vec3 n = normalize(vec3(-g.x * relief, 1.0, -g.y * relief));
        vec3 irradiance = mix(groundLight, skyLight, n.y * .5 + .5) + sunLight * max(dot(n, sunDir), 0.0);
        vec3 color = albedo * irradiance * 0.3183;
        float cloud = vnoise((p + wind * time * cloudSpeed) * .0011);
        color *= 1.0 - smoothstep(.5, .78, cloud) * cloudStrength;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

const shapeOf = points => new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, -y)));
const flat = (geometry, material, height) => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2; mesh.position.y = height;
  return mesh;
};

export function createLand(scene, shared) {
  const L = CONFIG.render.land;
  const groundTemplate = groundShader(shared);
  const sceneryMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide });
  const sandMaterials = new Map();
  const sandFor = hex => {
    if (!sandMaterials.has(hex)) sandMaterials.set(hex, new THREE.MeshLambertMaterial({ color: hex }));
    return sandMaterials.get(hex);
  };
  // Shallows: a turquoise skirt from the shoreline outward, fading with the
  // vertex alpha and broken up by the noise field so reefs read as reefs.
  const shallowsMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { noiseTex: { value: noiseTexture() }, color: { value: new THREE.Color(CONFIG.render.ocean.shallows) }, strength: { value: CONFIG.render.ocean.shallowsOpacity } },
    vertexShader: `attribute float fade; varying float vFade; varying vec2 worldXZ;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        worldXZ = world.xz; vFade = fade;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `varying float vFade; varying vec2 worldXZ; uniform vec3 color; uniform float strength;
      ${NOISE_GLSL}
      void main() {
        float reef = .7 + .3 * vnoise2(worldXZ * .03);
        float a = vFade * vFade * strength * reef;
        gl_FragColor = vec4(color, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  function shallowsGeometry(inner, outer) {
    const n = inner.length, position = new Float32Array(n * 2 * 3), fade = new Float32Array(n * 2), index = [];
    for (let i = 0; i < n; i++) {
      position.set([inner[i][0], 0, inner[i][1]], i * 6); position.set([outer[i][0], 0, outer[i][1]], i * 6 + 3);
      fade[i * 2] = 1; fade[i * 2 + 1] = 0;
      const j = (i + 1) % n;
      index.push(i * 2, i * 2 + 1, j * 2, j * 2, i * 2 + 1, j * 2 + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('fade', new THREE.BufferAttribute(fade, 1));
    geometry.setIndex(index);
    return geometry;
  }

  function build(t, context) {
    const { sectors, holdings, geographySeed } = context;
    const biomeName = biomeFor(t, sectors, geographySeed), B = BIOMES[biomeName];
    const rng = seeded((t.seed ?? t.id ?? 0) * 977 + 41);
    const radius = t.radius, gx = (t.seed ?? t.id ?? 0) % 100003, gy = (t.id ?? 0) % 1009;
    const group = new THREE.Group();
    group.position.set(t.x, 0, t.y);
    const shore = islandOutline(t);
    const interior = t.shoreline ? insetShore(shore, Math.min(14, radius * .12)) : islandOutline(t, radius * .86, .12, 2);
    const usable = insetShore(interior, 26);
    // Installations on this island keep a clear footprint; the scenery roads lead to them.
    const clears = holdings.map(h => ({ x: h.x - t.x, y: h.y - t.y, r: L.clearRadius[h.role] ?? 170, a: h.a ?? 0, role: h.role }));
    const clear = (x, y, margin = 0) => clears.every(c => Math.hypot(x - c.x, y - c.y) > c.r + margin);
    const hill = (x, y) => noise((x + t.x) * HILL_SCALE, (y + t.y) * HILL_SCALE, 0);
    const forestNoise = (x, y) => noise((x + t.x) * FOREST_SCALE, (y + t.y) * FOREST_SCALE, 1);
    const inside = (x, y) => insidePolygon(x, y, usable);
    // Same farmland mask as the ground shader, so forests stop at the hedges.
    const ca = Math.cos(t.a ?? 0), sa = Math.sin(t.a ?? 0);
    const farmland = (x, y) => B.fields && noise((x * ca + y * sa) * .0045 + 7.3, (-x * sa + y * ca) * .0045 + 7.3, 1) > .52 && hill(x, y) * .72 + noise((x + t.x) * HILL_SCALE * 3.1 + 5, (y + t.y) * HILL_SCALE * 3.1 + 5, 0) * .28 < .55;

    // Water skirts and beach.
    // Scaling about the centre keeps the skirt free of self-intersections on
    // these near-star-shaped coasts; a fixed outward offset crosses itself at
    // concave vertices and the overlaps show as bright rays.
    const outer = islandOutline(t, radius * (1 + Math.min(CONFIG.render.ocean.shallowsRadius - 1, 240 / radius)), .22, 2);
    const shallows = new THREE.Mesh(shallowsGeometry(shore, outer), shallowsMaterial);
    shallows.position.y = .2; group.add(shallows);
    const surf = shapeOf(islandOutline(t, radius * 1.12, .22, 2));
    surf.holes.push(new THREE.Path(islandOutline(t, radius * .97, .22, 2).map(([x, y]) => new THREE.Vector2(x, -y))));
    group.add(flat(new THREE.ShapeGeometry(surf), shared.surfMaterial, .3));
    group.add(flat(new THREE.ShapeGeometry(shapeOf(shore)), sandFor(B.sand), 3.5));
    const ground = groundTemplate.clone();
    ground.uniforms.noiseTex.value = noiseTexture();
    for (const key of ['time', 'wind', 'cloudSpeed', 'cloudStrength', 'sunDir']) ground.uniforms[key] = shared[key];
    ground.uniforms.low.value.set(B.low); ground.uniforms.high.value.set(B.high);
    ground.uniforms.patchColor.value.set(B.patch); ground.uniforms.rock.value.set(B.rock);
    ground.uniforms.fields.value = B.fields ? 1 : 0; ground.uniforms.dunes.value = B.dunes ? 1 : 0;
    ground.uniforms.relief.value = B.dunes ? 40 : 60;
    ground.uniforms.origin.value.set(t.x, t.y); ground.uniforms.angle.value = t.a ?? 0;
    const GROUND = 8.5;
    group.add(flat(new THREE.ShapeGeometry(shapeOf(interior)), ground, GROUND));

    const batch = new Batch();
    const villages = [], roads = [], traffic = { trucks: [], people: [], boats: [] };
    const blocked = []; // circles scenery keeps out of: villages, ponds, peaks

    // --- Villages -----------------------------------------------------------
    const villageCount = radius < L.villageRadius ? (rng() < .5 ? 1 : 0) : radius < 500 ? 1 : radius < 900 ? 2 : 3 + Math.floor(rng() * 2);
    const coastalSpots = [];
    for (let i = 0; i < shore.length; i++) {
      const p = shore[i], prev = shore[(i + shore.length - 1) % shore.length], next = shore[(i + 1) % shore.length];
      const dx = next[0] - prev[0], dy = next[1] - prev[1], l = Math.hypot(dx, dy) || 1;
      let nx = -dy / l, ny = dx / l;
      if (!insidePolygon(p[0] + nx * 30, p[1] + ny * 30, shore)) { nx = -nx; ny = -ny; }
      const x = p[0] + nx * 58, y = p[1] + ny * 58;
      if (!inside(x, y) || !clear(x, y, 90) || hill(x, y) > .62) continue;
      coastalSpots.push({ x, y, a: Math.atan2(ny, nx), shoreX: p[0], shoreY: p[1], score: hill(x, y) + rng() * .3 });
    }
    coastalSpots.sort((a, b) => a.score - b.score);
    for (let i = 0; i < villageCount; i++) {
      const wantCoast = i === 0 || rng() < .6;
      let spot = null;
      if (wantCoast) spot = coastalSpots.find(s => villages.every(v => Math.hypot(v.x - s.x, v.y - s.y) > 260));
      if (!spot) for (let attempt = 0; attempt < 40 && !spot; attempt++) {
        const a = rng() * TAU, r = rng() * radius * .7, x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (inside(x, y) && clear(x, y, 90) && hill(x, y) < .58 && villages.every(v => Math.hypot(v.x - x, v.y - y) > 260)) spot = { x, y, a: rng() * TAU };
      }
      if (!spot) break;
      villages.push({ ...spot, coastal: !!spot.shoreX, tiny: radius < L.villageRadius });
    }
    // Deserts gather their people around water.
    if (B.oasis && radius > 240) {
      let best = null;
      for (let attempt = 0; attempt < 30; attempt++) {
        const a = rng() * TAU, r = rng() * radius * .55, x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (!inside(x, y) || !clear(x, y, 80) || polygonDistance(x, y, usable) < 70) continue;
        const h = hill(x, y);
        if (!best || h < best.h) best = { x, y, h };
      }
      if (best) {
        const pond = 20 + rng() * 10;
        batch.disc(best.x, best.y, GROUND + .25, pond + 9, 14, rgb('#d8c98d'), rng());
        batch.disc(best.x, best.y, GROUND + .4, pond, 14, rgb('#3c9ea6'), rng());
        for (let i = 0; i < 7; i++) {
          const a = i / 7 * TAU + rng() * .5, r = pond + 8 + rng() * 10;
          batch.palm(best.x + Math.cos(a) * r, best.y + Math.sin(a) * r, GROUND, 9 + rng() * 3, rgb(B.trees[0]), rng() * TAU);
        }
        blocked.push({ x: best.x, y: best.y, r: pond + 22 });
        const vx = best.x + Math.cos(best.h * 9) * (pond + 48), vy = best.y + Math.sin(best.h * 9) * (pond + 48);
        if (villages.length < 3 && inside(vx, vy) && clear(vx, vy, 60)) villages.push({ x: vx, y: vy, a: rng() * TAU, coastal: false, oasis: true });
      }
    }
    for (const v of villages) {
      const houses = v.tiny ? 2 + Math.floor(rng() * 2) : v.coastal ? 5 + Math.floor(rng() * 4) : 6 + Math.floor(rng() * 7);
      const lane = v.a + Math.PI / 2, c = Math.cos(lane), s = Math.sin(lane);
      if (B.huts === 'house') batch.disc(v.x, v.y, GROUND + .2, 20, 9, rgb('#a99a72'), rng());
      if (B.huts === 'adobe') batch.disc(v.x, v.y, GROUND + .2, 26, 8, rgb('#c7ad78'), rng());
      let placed = 0;
      for (let i = 0; i < houses * 2 && placed < houses; i++) {
        const side = i % 2 ? 1 : -1, u = (Math.floor(i / 2) - (houses - 1) / 4) * 24 + (rng() - .5) * 6, vv = side * (17 + rng() * 6);
        const x = v.x + u * c - vv * s, y = v.y + u * s + vv * c;
        if (!inside(x, y) || !clear(x, y, 10)) continue;
        const w = L.houseSize * (.75 + rng() * .5), d = L.houseSize * (.6 + rng() * .4), rot = lane + (rng() - .5) * .25;
        if (B.huts === 'thatch') {
          if (rng() < .6) batch.cone(x, y, GROUND, 5 + rng() * 3, 6, 7, rgb('#8d6d3f'), rgb('#6f532f'), rng() * TAU);
          else { batch.box(x, y, GROUND, w, d, 3, rot, rgb('#8a7350')); batch.roof(x, y, GROUND + 3, w, d, 4, rot, rgb('#a3874f')); }
        } else if (B.huts === 'adobe') {
          batch.box(x, y, GROUND, w, d, 4 + rng() * 3, rot, rgb('#c9a878'), rgb('#b8956a'));
        } else {
          batch.box(x, y, GROUND, w, d, 5, rot, rgb(WALLS[Math.floor(rng() * WALLS.length)]));
          batch.roof(x, y, GROUND + 5, w, d, 4, rot, rgb(ROOFS[Math.floor(rng() * ROOFS.length)]));
        }
        placed++;
      }
      if (B.huts === 'house' && !v.tiny) { batch.box(v.x + c * 2, v.y + s * 2, GROUND, 4, 4, 14, lane, rgb('#d9d2c2')); batch.cone(v.x + c * 2, v.y + s * 2, GROUND + 14, 3.2, 5, 4, rgb('#6b6f74'), rgb('#6b6f74'), lane); }
      blocked.push({ x: v.x, y: v.y, r: v.tiny ? 40 : 78 });
      if (v.coastal) {
        // Pier out past the beach, with boats working the water off its end.
        const dx = v.shoreX - v.x, dy = v.shoreY - v.y, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
        const from = [v.shoreX - ux * 12, v.shoreY - uy * 12], to = [v.shoreX + ux * 46, v.shoreY + uy * 46];
        batch.ribbon([from, to], 5, 4.2, rgb('#7d6b49'));
        for (const k of [.45, .8]) batch.box(from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, 3.5, 1.4, 6.5, 1.2, Math.atan2(uy, ux), rgb('#5c4c34'));
        v.pier = { x: to[0], y: to[1], ux, uy };
        const boats = 1 + Math.floor(rng() * 2);
        for (let i = 0; i < boats; i++) traffic.boats.push({ home: { x: to[0] + ux * 20, y: to[1] + uy * 20 }, ux, uy, range: 110 + rng() * 120, phase: rng() * TAU, speed: L.traffic.boatSpeed * (.7 + rng() * .5), tint: rng() });
      }
      const [minP, maxP] = L.traffic.peoplePerVillage, count = v.tiny ? 2 : minP + Math.floor(rng() * (maxP - minP + 1));
      for (let i = 0; i < count; i++) traffic.people.push({ home: { x: v.x, y: v.y, r: v.tiny ? 22 : 46 }, x: v.x, y: v.y, tx: v.x, ty: v.y, wait: rng() * 3, speed: L.traffic.walkSpeed * (.7 + rng() * .6), tint: rng() });
    }

    // --- Roads ---------------------------------------------------------------
    const nodes = villages.filter(v => !v.tiny).map(v => ({ x: v.x, y: v.y }));
    for (const c of clears) {
      // Airfield roads meet the apron behind the hangars; other installations are met at their edge.
      const entry = c.role === 'airfield' ? { x: c.x - Math.sin(c.a) * 96, y: c.y + Math.cos(c.a) * 96 } : null;
      if (entry && inside(entry.x, entry.y)) nodes.push(entry);
      else if (nodes.length) {
        const near = nodes[0], d = Math.hypot(near.x - c.x, near.y - c.y) || 1;
        const edge = { x: c.x + (near.x - c.x) / d * (c.r - 10), y: c.y + (near.y - c.y) / d * (c.r - 10) };
        if (inside(edge.x, edge.y)) nodes.push(edge);
      }
    }
    if (nodes.length >= 2) {
      const order = [nodes[0]], rest = nodes.slice(1);
      while (rest.length) {
        const last = order[order.length - 1];
        rest.sort((a, b) => Math.hypot(a.x - last.x, a.y - last.y) - Math.hypot(b.x - last.x, b.y - last.y));
        order.push(rest.shift());
      }
      for (let i = 0; i + 1 < order.length; i++) {
        const a = order[i], b = order[i + 1], length = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(2, Math.round(length / 70));
        const points = [[a.x, a.y]];
        let ok = true;
        for (let k = 1; k < steps; k++) {
          const f = k / steps, x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
          const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length, wobble = (noise(x * .01 + gx, y * .01 + gy, 2) - .5) * 60 * Math.sin(f * Math.PI);
          const px = x + nx * wobble, py = y + ny * wobble;
          if (!insidePolygon(x, y, interior)) { ok = false; break; }
          points.push(inside(px, py) ? [px, py] : [x, y]);
        }
        if (!ok) continue;
        points.push([b.x, b.y]);
        batch.ribbon(points, L.roadWidth, GROUND + .3, rgb(B.road));
        roads.push(points);
        const [minT, maxT] = L.traffic.trucksPerRoad, trucks = minT + Math.floor(rng() * (maxT - minT + 1));
        const total = points.reduce((n, p, k) => k ? n + Math.hypot(p[0] - points[k - 1][0], p[1] - points[k - 1][1]) : 0, 0);
        for (let k = 0; k < trucks; k++) traffic.trucks.push({ path: points, length: total, s: rng() * total, dir: rng() < .5 ? 1 : -1, speed: L.traffic.truckSpeed * (.8 + rng() * .4), tint: rng() });
      }
    }
    const nearRoad = (x, y, margin) => roads.some(points => points.some((p, k) => k && segmentDistance(x, y, points[k - 1], p) < margin));

    // --- Peaks: mountains or a volcano at the highest ground ----------------
    const peaks = [];
    if ((B.mountains && radius > 550) || (B.volcano && radius > 230)) {
      const step = Math.max(40, radius / 9), deep = insetShore(interior, 70);
      for (let x = -radius; x <= radius; x += step) for (let y = -radius; y <= radius; y += step) {
        const h = hill(x, y);
        if (h < .66 || !insidePolygon(x, y, deep) || !clear(x, y, 60)) continue;
        if (villages.some(v => Math.hypot(v.x - x, v.y - y) < 150) || peaks.some(p => Math.hypot(p.x - x, p.y - y) < 190)) continue;
        peaks.push({ x, y, h });
      }
      peaks.sort((a, b) => b.h - a.h);
      peaks.length = Math.min(peaks.length, B.volcano ? 1 : 1 + Math.floor(radius / 380));
    }
    for (const [i, p] of peaks.entries()) {
      const size = B.volcano ? Math.min(120, 40 + radius * .08) : Math.min(95, 20 + radius * .03) * (i ? .7 : 1);
      if (B.volcano) {
        batch.cone(p.x, p.y, GROUND, size, size * .55, 10, rgb('#4a5a40'), rgb('#3a3634'), rng() * TAU);
        batch.cone(p.x, p.y, GROUND + size * .3, size * .55, size * .28, 10, rgb('#3a3634'), rgb('#232120'), rng() * TAU);
        batch.disc(p.x, p.y, GROUND + size * .58 + .3, size * .16, 8, rgb('#1b1817'));
        batch.disc(p.x, p.y, GROUND + size * .58 + .5, size * .06, 6, rgb('#c0361a'));
      } else {
        batch.cone(p.x, p.y, GROUND, size, size * .5, 9, shade(rgb(B.low), .9), rgb(B.high), rng() * TAU);
        const top = B.snow && size > 70 ? rgb('#eef1f2') : shade(rgb(B.rock), 1.25);
        batch.cone(p.x, p.y, GROUND + size * .27, size * .48, size * .25, 9, rgb(B.rock), top, rng() * TAU);
      }
      blocked.push({ x: p.x, y: p.y, r: size + 6 });
    }

    // --- Forests, palms, scrub and rocks ------------------------------------
    const area = Math.abs(shore.reduce((n, p, i) => { const q = shore[(i + 1) % shore.length]; return n + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
    const spacing = Math.max(L.treeSpacing, Math.sqrt(area * L.forestCover / L.maxTrees));
    const threshold = 1 - B.forest;
    const treeColors = B.trees.map(rgb);
    const isBlocked = (x, y, margin = 0) => blocked.some(b => Math.hypot(b.x - x, b.y - y) < b.r + margin);
    let trees = 0;
    for (let x = -radius - spacing; x <= radius + spacing; x += spacing) for (let y = -radius - spacing; y <= radius + spacing; y += spacing) {
      const jx = x + (hash2(x + gx, y) - .5) * spacing * .9, jy = y + (hash2(y + gy, x) - .5) * spacing * .9;
      if (!inside(jx, jy) || !clear(jx, jy) || isBlocked(jx, jy) || nearRoad(jx, jy, 10)) continue;
      const h = hill(jx, jy), coast = polygonDistance(jx, jy, interior);
      const f = smoothstep(.3, .7, forestNoise(jx, jy)) * (1 - smoothstep(.72, .88, h)) + (coast < 60 ? .15 : 0);
      const r = hash2(jx * 3 + gy, jy * 3 + gx);
      if (B.scrub && r < .18 && h < .7) { batch.cone(jx, jy, GROUND, 3 + r * 12, 3, 5, rgb(B.trees[1]), rgb(B.trees[0]), r * TAU); continue; }
      if (f < threshold || (farmland(jx, jy) && r > .06)) continue;
      trees++;
      const color = treeColors[Math.floor(r * treeColors.length)];
      if (B.palmOnly || (B.palms && (coast < 75 || r < .12))) batch.palm(jx, jy, GROUND, 8 + r * 5, color, r * TAU);
      else if (B.acacia) { batch.cone(jx, jy, GROUND + 6, 9 + r * 5, 3, 6, color, shade(color, .85), r * TAU); batch.box(jx, jy, GROUND, 1.6, 1.6, 6, 0, rgb('#5a4630')); }
      else batch.cone(jx, jy, GROUND, 7 + r * 5, 9 + r * 7, 6, color, shade(color, 1.18), r * TAU);
    }
    for (let i = 0; i < shore.length; i++) {
      if (rng() > .22) continue;
      const p = shore[i], q = interior[i % interior.length], x = (p[0] + q[0]) / 2, y = (p[1] + q[1]) / 2;
      if (!clear(x, y)) continue;
      batch.cone(x, y, 3.5, 4 + rng() * 7, 3 + rng() * 4, 5, rgb(B.rock), shade(rgb(B.rock), 1.2), rng() * TAU);
    }
    if (B.scrub || B.volcano) for (let i = 0; i < radius / 40; i++) {
      const a = rng() * TAU, r = rng() * radius * .8, x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (!inside(x, y) || !clear(x, y) || isBlocked(x, y) || nearRoad(x, y, 12)) continue;
      batch.cone(x, y, GROUND, 5 + rng() * 9, 4 + rng() * 5, 5, rgb(B.rock), shade(rgb(B.rock), 1.25), rng() * TAU);
    }

    if (batch.n) group.add(new THREE.Mesh(batch.build(), sceneryMaterial));
    group.userData = { radius, extent: t.extent ?? radius, biome: biomeName, villages: villages.length, roads: roads.length, trees, traffic };
    return group;
  }

  return {
    build,
    dispose(group) {
      group.traverse(node => {
        if (!node.isMesh) return;
        node.geometry.dispose();
        if (node.material.uniforms?.low) node.material.dispose();
      });
    },
  };
}

