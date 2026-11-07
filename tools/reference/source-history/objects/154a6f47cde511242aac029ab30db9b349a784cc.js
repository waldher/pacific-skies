// Island scenery: biomes, relief-shaded ground, forests, villages, roads and
// the agents that travel them. Everything derives from the island seed and the
// shared noise field, so every device sees the same hills, and the forests
// stand exactly where the ground shader shades the slopes.
//
// Cost model: one draw and one bounded baked texture for the ground, one
// draw for the beach, one vertex-coloured scenery batch and one draw each for
// surf and shallows. Static tree/house contact shade is baked, never shadow-mapped.
import * as THREE from '../vendor/three/three.module.min.js';
import { withRelief } from './projection.js';
import { CONFIG } from './config.js';
import { islandOutline, insidePolygon } from './surface.js';
import { noise, noiseTexture, NOISE_GLSL } from './noise.js';
import { TAU, hash2 } from './util.js';

export const HILL_SCALE = .012;     // world units → hill-noise cells (≈83 units per cell)
const FOREST_SCALE = .02;

// Optional diffuse material: a failed/slow download selects the deterministic
// procedural fallback for the whole session, never a late style change midflight.
let terrainImage = null, terrainMaterialLoad = null;
export function hasTerrainMaterial() { return !!terrainImage; }
export function preloadTerrainMaterial() {
  if (terrainMaterialLoad) return terrainMaterialLoad;
  terrainMaterialLoad = new Promise(resolve => {
    if (typeof createImageBitmap === 'function') {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(),2500);
      fetch(new URL('../assets/terrain/grass-soil-v1.webp', import.meta.url),{signal:controller.signal})
        .then(r => { if (!r.ok) throw Error('Terrain material fetch failed'); return r.blob(); })
        .then(blob => createImageBitmap(blob)).then(image => { terrainImage = image; resolve(true); })
        .catch(() => resolve(false)).finally(() => clearTimeout(timeout));
      return;
    }
    if (typeof Image === 'undefined') { resolve(false); return; }
    const image = new Image();
    let settled = false;
    const finish = ok => {
      if (settled) return;
      settled = true; clearTimeout(timeout);
      image.onload = image.onerror = null;
      if (ok) terrainImage = image;
      resolve(ok);
    };
    const timeout = setTimeout(() => finish(false), 2500);
    image.onload = () => finish(image.naturalWidth > 0);
    image.onerror = () => finish(false);
    image.src = new URL('../assets/terrain/grass-soil-v1.webp', import.meta.url).href;
  });
  return terrainMaterialLoad;
}


const BIOMES = {
  jungle:    { sand: '#e6d7a4', low: '#3f7f3c', high: '#2c5a2f', patch: '#5c9a45', rock: '#5d6552', trees: ['#2e6d35', '#3b8342', '#27612c', '#4a8f3d'], palms: true, forest: .62, huts: 'thatch', road: '#8a7a58', mountains: true },
  temperate: { sand: '#e3d49b', low: '#6f8054', high: '#4d6342', patch: '#8d9868', rock: '#7a7468', trees: ['#405e35', '#536b3e', '#697449', '#38583a'], palms: false, forest: .45, huts: 'house', road: '#5b5a57', fields: true, mountains: true, snow: true },
  volcanic:  { sand: '#4d4945', low: '#4c7040', high: '#454240', patch: '#6a8150', rock: '#4a4744', trees: ['#2f6a37', '#3d7f44', '#356f3a'], palms: true, forest: .38, huts: 'thatch', road: '#6b625a', volcano: true },
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
    // A tight bay can push the full inset outside; try shorter insets before
    // leaving the vertex on the waterline.
    for (const step of [1, .5, .25]) {
      const k = distance * step / Math.max(.4, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
      const q = [p[0] + (n1[0] + n2[0]) * k, p[1] + (n1[1] + n2[1]) * k];
      if (insidePolygon(q[0], q[1], points)) return q;
    }
    return p;
  });
}
// Unclamped mitre offset: negative distances move out over the water. Only
// safe for small distances, where the coast has no concavities that tight.
export function offsetShore(points, distance) {
  const area = points.reduce((n, p, i) => { const q = points[(i + 1) % points.length]; return n + p[0] * q[1] - q[0] * p[1]; }, 0);
  const sign = area > 0 ? 1 : -1;
  return points.map((p, i) => {
    const prev = points[(i + points.length - 1) % points.length], next = points[(i + 1) % points.length];
    const l1 = Math.hypot(p[0] - prev[0], p[1] - prev[1]), l2 = Math.hypot(next[0] - p[0], next[1] - p[1]);
    const n1 = [-(p[1] - prev[1]) / l1 * sign, (p[0] - prev[0]) / l1 * sign];
    const n2 = [-(next[1] - p[1]) / l2 * sign, (next[0] - p[0]) / l2 * sign];
    const k = distance / Math.max(.4, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
    return [p[0] + (n1[0] + n2[0]) * k, p[1] + (n1[1] + n2[1]) * k];
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
  // Interlocking crowns give trees a leafy silhouette rather than one gemstone.
  broadleaf(x,y,base,radius,color,phase) {
    this.box(x,y,base,1.6,1.6,9,0,rgb('#4f4932'));
    for(let i=0;i<4;i++) {
      const a=phase+i*TAU/4, r=radius*(.48+(i%2)*.08);
      const cx=x+Math.cos(a)*radius*.38,cy=y+Math.sin(a)*radius*.38;
      this.cone(cx,cy,base+7+(i%2)*2,r,4.5,7,shade(color,.78+i*.065),shade(color,1.12+i*.025),a);
    }
    this.cone(x,y,base+11,radius*.58,3.5,7,color,shade(color,1.25),phase+.2);
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

// Static terrain is painted once per loaded island, including contact shadows.
// A bounded 1024² texture replaces the old full-screen stack of noise/farm taps.
// All decoration is local to the unchanged physical shore polygon.
class TerrainBake {
  constructor(shore, biome, seed) {
    this.minX = Math.min(...shore.map(p => p[0]));
    this.minY = Math.min(...shore.map(p => p[1]));
    this.width = Math.max(...shore.map(p => p[0])) - this.minX;
    this.height = Math.max(...shore.map(p => p[1])) - this.minY;
    const longest = Math.max(this.width, this.height);
    const resolution = Math.max(256, Math.min(1024, 2 ** Math.ceil(Math.log2(longest))));
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    this.canvas.width = Math.max(128, Math.round(resolution * this.width / longest));
    this.canvas.height = Math.max(128, Math.round(resolution * this.height / longest));
    const ctx = this.ctx = this.canvas.getContext('2d');
    const random = seeded(seed * 37 + 127);
    // A constant undercoat avoids a million seeded JS pixel operations on cold
    // chunks. Natural detail comes from the decoded diffuse tile below.
    ctx.fillStyle = biome.low;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.canvas.width / this.width, 0, 0, this.canvas.height / this.height,
      -this.minX * this.canvas.width / this.width, -this.minY * this.canvas.height / this.height);
    // The generated file is only diffuse grass/soil material. It is tiled into
    // this static albedo bake underneath authored fields, coasts and shadows;
    // every frame still reads the same one bounded terrain texture.
    if (terrainImage && !biome.dunes && !biome.oasis) {
      const pattern = ctx.createPattern(terrainImage, 'repeat');
      if (pattern) {
        const tileSize = 240; // ~40 metres at the aircraft/world scale
        pattern.setTransform(new DOMMatrix().scale(tileSize / terrainImage.width));
        ctx.save();
        ctx.fillStyle = pattern; ctx.globalAlpha = biome.palmOnly ? .38 : .90;
        ctx.fillRect(this.minX, this.minY, this.width, this.height);
        // Preserve biome hue while retaining natural surface luminance variation.
        ctx.globalCompositeOperation = 'color'; ctx.globalAlpha = .35;
        ctx.fillStyle = biome.low; ctx.fillRect(this.minX, this.minY, this.width, this.height);
        ctx.restore();
      }
    }
    // Broad continuous terrain masses, using a few soft washes rather than a
    // repeated noise lattice. Crop and forest detail carry the small-scale texture.
    for (let i = 0; i < 28; i++) {
      const x = this.minX + random() * this.width, y = this.minY + random() * this.height;
      const radius = 35 + random() * 150;
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, i % 3 ? 'rgba(31,45,28,0.13)' : 'rgba(182,166,117,0.12)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x-radius,y-radius,radius*2,radius*2);
    }
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = true;
  }
  path(points) {
    const c = this.ctx; c.beginPath();
    points.forEach(([x,y],i)=>i ? c.lineTo(x,y) : c.moveTo(x,y)); c.closePath();
  }
  patch(points, color) { this.path(points); this.ctx.fillStyle=color; this.ctx.fill(); }
  road(points, width, color) {
    const c=this.ctx; c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));
    c.lineWidth=width;c.lineCap='round';c.lineJoin='round';c.strokeStyle=color;c.stroke();
  }
  shadow(x,y,radius,height,opacity=.32) {
    const [sx,sy,sz]=CONFIG.render.sunOffset;
    const xx=x-sx/sy*height, yy=y-sz/sy*height;
    const c=this.ctx,g=c.createRadialGradient(xx,yy,0,xx,yy,radius*1.35);
    g.addColorStop(0,`rgba(10,19,19,${opacity})`);
    g.addColorStop(.5,`rgba(10,19,19,${opacity*.78})`);
    g.addColorStop(1,'rgba(10,19,19,0)');
    c.fillStyle=g;c.fillRect(xx-radius*1.35,yy-radius*1.35,radius*2.7,radius*2.7);
  }
  building(x,y,w,d,angle,height) {
    const c=Math.cos(angle),s=Math.sin(angle),[sx,sy,sz]=CONFIG.render.sunOffset;
    const p=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([u,v])=>[x+u*c-v*s,y+u*s+v*c]);
    const projected=p.map(([x,y])=>[x-sx/sy*height,y-sz/sy*height]);
    // Contact and cast shade stay on the island texture, not expensive shadow maps.
    this.patch(projected,'rgba(14,22,20,.32)');
    for(let i=0;i<4;i++)this.patch([p[i],p[(i+1)%4],projected[(i+1)%4],projected[i]],'rgba(14,22,20,.25)');
    this.shadow(x,y,Math.max(w,d)*.65,0,.18);
  }
  finish() { this.texture.needsUpdate=true; return this.texture; }
}

function groundShader(shared) {
  const L = CONFIG.render.lighting;
  return new THREE.ShaderMaterial({
    uniforms: {
      albedoMap:{value:null}, terrainMin:{value:new THREE.Vector2()}, terrainSize:{value:new THREE.Vector2(1,1)},
      noiseTex:{value:noiseTexture()},time:shared.time,wind:shared.wind,cloudSpeed:shared.cloudSpeed,cloudStrength:shared.cloudStrength,
      light:{value:new THREE.Color(L.sky).multiplyScalar(L.hemisphere).add(new THREE.Color(L.sun).multiplyScalar(L.sunIntensity * new THREE.Vector3(...CONFIG.render.sunOffset).normalize().y)).multiplyScalar(.3183)},
    },
    vertexShader:`varying vec2 localXZ;varying vec2 worldXZ;
      void main(){vec4 w=modelMatrix*vec4(position,1.0);worldXZ=w.xz;localXZ=vec2(position.x,-position.y);gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader:`varying vec2 localXZ;varying vec2 worldXZ;
      uniform sampler2D albedoMap;uniform vec2 terrainMin,terrainSize,wind;
      uniform vec3 light;uniform float time,cloudSpeed,cloudStrength;
      ${NOISE_GLSL}
      void main(){
        vec2 uv=(localXZ-terrainMin)/terrainSize;
        vec3 color=texture2D(albedoMap,vec2(uv.x,1.0-uv.y)).rgb*light;
        float cloud=vnoise((worldXZ+wind*time*cloudSpeed)*.0011);
        color*=1.0-smoothstep(.5,.78,cloud)*cloudStrength;
        gl_FragColor=vec4(color,1.0);
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
  const sceneryMaterial = withRelief(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide }));
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
        float a = vFade * strength * reef;
        gl_FragColor = vec4(color, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  // Concentric rings with a `fade` per ring, stitched into strips. Every ring
  // must share the shoreline's vertex count.
  function bandGeometry(rings, fades) {
    const n = rings[0].length, position = [], fade = [], index = [];
    rings.forEach((ring, r) => ring.forEach(([x, y]) => { position.push(x, 0, y); fade.push(typeof fades[r] === 'function' ? fades[r](x,y) : fades[r]); }));
    for (let r = 0; r + 1 < rings.length; r++) for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, a = r * n + i, b = r * n + j, c = (r + 1) * n + i, d = (r + 1) * n + j;
      index.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(position), 3));
    geometry.setAttribute('fade', new THREE.BufferAttribute(new Float32Array(fade), 1));
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
    // Long geological reaches, shared by beach material, shelves and shallows.
    // This describes the existing coast; it never moves its physical boundary.
    const rockReach=(x,y)=>B.palmOnly||B.dunes?0:smoothstep(-.25,.55,
      Math.sin((x*.65+y*.76)*.008+(t.seed??t.id??0)*.31));
    // Physical shoreline stays exactly the same. Densify only the inland
    // vegetation edge to give beaches naturally varying width.
    const denseShore=[];
    for(let i=0;i<shore.length;i++) {
      const p=shore[i],q=shore[(i+1)%shore.length],steps=Math.max(1,Math.ceil(Math.hypot(q[0]-p[0],q[1]-p[1])/28));
      for(let k=0;k<steps;k++)denseShore.push([p[0]+(q[0]-p[0])*k/steps,p[1]+(q[1]-p[1])*k/steps]);
    }
    const inset=insetShore(denseShore,Math.min(26,radius*.12));
    const interior=inset.map((p,i)=>{
      const shorePoint=denseShore[i];
      const f=(.60+.40*noise((p[0]+t.x)*.016,(p[1]+t.y)*.016,1))*(1-.50*rockReach(p[0],p[1]));
      return [shorePoint[0]+(p[0]-shorePoint[0])*f,shorePoint[1]+(p[1]-shorePoint[1])*f];
    });
    const usable = insetShore(interior, 26);
    // Installations on this island keep a clear footprint; the scenery roads lead to them.
    const clears = holdings.map(h => ({ x: h.x - t.x, y: h.y - t.y, r: L.clearRadius[h.role] ?? 170, a: h.a ?? 0, role: h.role }));
    const clear = (x, y, margin = 0) => clears.every(c => Math.hypot(x - c.x, y - c.y) > c.r + margin);
    // Small scenery may approach the real apron instead of leaving a giant
    // circular empty lawn. No decoration enters runway or hangar footprints.
    const detailClear=(x,y,margin=0)=>clears.every(c=>{
      if(c.role!=='airfield')return Math.hypot(x-c.x,y-c.y)>c.r+margin;
      const dx=x-c.x,dy=y-c.y,along=dx*Math.cos(c.a)+dy*Math.sin(c.a),across=-dx*Math.sin(c.a)+dy*Math.cos(c.a);
      return Math.abs(along)>CONFIG.airfield.length/2+28+margin || across< -CONFIG.airfield.width/2-28-margin || across>152+margin;
    });
    const hill = (x, y) => noise((x + t.x) * HILL_SCALE, (y + t.y) * HILL_SCALE, 0);
    const forestNoise = (x, y) => noise((x + t.x) * FOREST_SCALE, (y + t.y) * FOREST_SCALE, 1);
    const inside = (x, y) => insidePolygon(x, y, usable);
    // Same farmland mask as the ground shader, so forests stop at the hedges.
    const ca = Math.cos(t.a ?? 0), sa = Math.sin(t.a ?? 0);
    const farmland = (x, y) => {
      if (!B.fields) return false;
      const cx = (Math.floor((x * ca + y * sa) / 72) + .5) * 72, cy = (Math.floor((-x * sa + y * ca) / 72) + .5) * 72;
      const wx = t.x + cx * ca - cy * sa, wy = t.y + cx * sa + cy * ca;
      return noise(cx * .0045 + 7.3, cy * .0045 + 7.3, 1) > .52
        && noise(wx * HILL_SCALE, wy * HILL_SCALE, 0) * .72 + noise(wx * HILL_SCALE * 3.1 + 5, wy * HILL_SCALE * 3.1 + 5, 0) * .28 < .55;
    };

    // Water skirts and beach.
    // Scaling about the centre keeps the outer skirt free of self-intersections
    // on these near-star-shaped coasts; a fixed outward offset crosses itself
    // at concave vertices and the overlaps show as bright rays.
    const outer = islandOutline(t, radius * (1 + Math.min(CONFIG.render.ocean.shallowsRadius - 1, 240 / radius)), .22, 2);

    // The waterline is a gradient, not an edge: water laps a few units onto
    // the beach, then the shallows fade out to sea, with foam on the line.
    const shelfWater = shore.map((p,i)=>{
      const f=.24+.36*(1-rockReach(p[0],p[1]));
      return [p[0]+(outer[i][0]-p[0])*f,p[1]+(outer[i][1]-p[1])*f];
    });
    const shallows = new THREE.Mesh(bandGeometry([insetShore(shore, 9), shore, shelfWater, outer],
      [0,(x,y)=>.85+.15*(1-rockReach(x,y)),.48,0]), shallowsMaterial);
    shallows.position.y = 3.6; group.add(shallows);
    const surf = new THREE.Mesh(bandGeometry([insetShore(shore, 3), shore, offsetShore(shore, -14)], [0, 1, 0]), shared.surfMaterial);
    surf.position.y = 3.7; group.add(surf);
    const ground = groundTemplate.clone();
    ground.uniforms.noiseTex.value = noiseTexture();
    for (const key of ['time', 'wind', 'cloudSpeed', 'cloudStrength']) ground.uniforms[key] = shared[key];
    const bake = new TerrainBake(shore, B, t.seed ?? t.id ?? 0);
    // Fields are discrete irregular cultivated plots, with margin from the
    // actual coast and installations. Their neutral palette sits below aircraft.
    if(B.fields) {
      const crops=['#8a8861','#7c8058','#908266','#727c52'];
      for(let u=-radius-72;u<=radius+72;u+=72)for(let v=-radius-72;v<=radius+72;v+=72) {
        const cx=u+36,cy=v+36,x=cx*ca-cy*sa,y=cx*sa+cy*ca;
        if(!farmland(x,y)||!clear(x,y,65)||polygonDistance(x,y,shore)<65||!inside(x,y))continue;
        const h=hash2(x+gx,y+gy),margin=5+h*5;
        const pts=[[-36+margin,-36+margin],[34-margin,-34+margin],
          [34-margin,33-margin],[-34+margin,35-margin]].map(([a,b],i)=>{
            const bend=(hash2(cx+i*15,cy+gy)-.5)*7;
            return [(cx+a+bend)*ca-(cy+b)*sa,(cx+a+bend)*sa+(cy+b)*ca];
          });
        if(!pts.every(([x,y])=>inside(x,y)))continue;
        bake.patch(pts,crops[Math.floor(h*crops.length)]);
        bake.ctx.save();bake.path(pts);bake.ctx.clip();
        for(let line=-26;line<30;line+=9) {
          const p0=[(cx-30)*ca-(cy+line)*sa,(cx-30)*sa+(cy+line)*ca];
          const p1=[(cx+30)*ca-(cy+line)*sa,(cx+30)*sa+(cy+line)*ca];
          bake.road([p0,p1],1.1,'rgba(45,51,29,.13)');
        }
        bake.ctx.restore();
      }
    }
    // A feathered intertidal material is baked onto both the beach and land
    // polygons. The actual outer water/collision edge remains shore unchanged.
    const sand=new THREE.Color(B.sand).multiplyScalar(.57).convertLinearToSRGB();
    const sandCss=`${Math.round(sand.r*255)},${Math.round(sand.g*255)},${Math.round(sand.b*255)}`;
    for(let i=0;i<denseShore.length;i++) {
      const p=denseShore[i],q=denseShore[(i+1)%denseShore.length];
      const width=(26+24*noise((p[0]+t.x)*.009,(p[1]+t.y)*.009,1))*(1-.65*rockReach(p[0],p[1]));
      // Layered low-alpha strokes make a wide soft grass/sand transition. No
      // full-screen blend pass or repeated transparent draw is needed at runtime.
      bake.road([p,q],width+18,`rgba(${sandCss},.14)`);
      bake.road([p,q],width+9,`rgba(${sandCss},.20)`);
      bake.road([p,q],width,`rgba(${sandCss},.68)`);
      bake.road([p,q],7,'rgba(66,92,84,.28)');
      // Long coherent slate/seaweed reaches break up the uniform pale strip;
      // every stroke follows the real collider edge, never a fabricated coast.
      const rocky = rockReach(p[0],p[1]);
      if(!B.palmOnly && !B.dunes && rocky>.46) {
        bake.road([p,q],width*.8,'rgba(76,78,60,.68)');
        bake.road([p,q],8,'rgba(40,60,56,.65)');
        const inner=interior[i];
        bake.road([inner,interior[(i+1)%interior.length]],3,'rgba(115,111,78,.50)');
      }
    }
    // Exterior service drainage and worn access strips make installations sit
    // in their landscape. Coordinates align with actual runway/apron layout.
    for(const c of clears.filter(c=>c.role==='airfield')) {
      const point=(u,v)=>[c.x+u*Math.cos(c.a)-v*Math.sin(c.a),c.y+u*Math.sin(c.a)+v*Math.cos(c.a)];
      for(const side of [-1,1]) {
        const lateral=side<0?-66:160;
        const points=[point(-170,lateral),point(-75,lateral+side*5),point(60,lateral+side*3),point(170,lateral)];
        if(points.every(([x,y])=>insidePolygon(x,y,interior))) {
          bake.road(points,9,'rgba(122,111,79,.28)');
          bake.road(points,2.5,'rgba(36,49,31,.40)');
          bake.road(points.map(([x,y])=>[x-1,y-1]),1.2,'rgba(167,160,114,.32)');
        }
      }
    }
    // Sparse erosion channels connect broader ground masses. They are baked
    // contour detail, not an overlaid grain field; do not cross installations.
    const drainageRng=seeded((t.seed??t.id??0)*19+39);
    for(let i=0;i<Math.min(18,Math.ceil(radius/90));i++) {
      const x=(drainageRng()-.5)*radius*1.5,y=(drainageRng()-.5)*radius*1.5,a=drainageRng()*TAU;
      const points=[];
      for(let k=0;k<6;k++) {
        const along=(k-2.5)*24,bend=Math.sin(k*.8+a)*15;
        points.push([x+Math.cos(a)*along-Math.sin(a)*bend,y+Math.sin(a)*along+Math.cos(a)*bend]);
      }
      if(!points.every(([x,y])=>inside(x,y)&&detailClear(x,y,20)&&!farmland(x,y)))continue;
      bake.road(points,11,'rgba(115,101,68,.12)');
      bake.road(points,4,'rgba(47,62,36,.14)');
      bake.road(points.map(([x,y])=>[x-2,y-2]),2,'rgba(158,147,97,.14)');
    }
    ground.uniforms.terrainMin.value.set(bake.minX,bake.minY);
    ground.uniforms.terrainSize.value.set(bake.width,bake.height);
    const GROUND = 8.5;
    // Do not shade the whole island twice: beach geometry has an inland hole.
    const beachShape=shapeOf(shore);
    beachShape.holes.push(new THREE.Path(interior.map(([x,y])=>new THREE.Vector2(x,-y))));
    group.add(flat(new THREE.ShapeGeometry(beachShape), ground, 3.5));
    group.add(flat(new THREE.ShapeGeometry(shapeOf(interior)), ground, GROUND));

    const batch = new Batch();
    const villages = [], roads = [], traffic = { trucks: [], people: [], boats: [] };
    const blocked = []; // circles scenery keeps out of: villages, ponds, peaks

    // A compact airfield supply yard establishes land use beyond the runway.
    // All pieces are baked or merged into the existing scenery batch; no new
    // materials/draw calls. Validate the entire footprint against real land.
    for(const c of clears.filter(c=>c.role==='airfield')) {
      const co=Math.cos(c.a),si=Math.sin(c.a);
      const at=(u,v)=>[c.x+u*co-v*si,c.y+u*si+v*co];
      const yard=[at(-132,166),at(108,166),at(118,231),at(-125,239)];
      if(!yard.every(([x,y])=>inside(x,y)))continue;
      // One connected compacted service ground links hangars, apron and yard.
      // A clipped bake keeps the material on land even at coastal airfields.
      const compound=[at(-147,43),at(142,43),at(142,149),at(118,231),at(-125,239),at(-147,149)];
      bake.ctx.save();bake.path(interior);bake.ctx.clip();
      bake.patch(compound,'rgba(126,121,96,.74)');
      bake.road([...compound,compound[0]],7,'rgba(82,85,62,.42)');
      bake.road([at(-137,153),at(125,153)],22,'rgba(99,98,80,.65)');
      for(const u of [-102,-11,80]) {
        bake.road([at(u,121),at(u,181)],13,'rgba(102,103,88,.72)');
        bake.road([at(u-4,123),at(u-4,181)],1.4,'rgba(56,60,49,.30)');
      }
      bake.ctx.restore();
      bake.patch(yard,'rgba(121,111,84,.82)');
      bake.road([...yard,yard[0]],5,'rgba(82,82,60,.65)');
      // Two worn wheel lanes curve into the existing apron access corridor.
      for(const v of [180,186])bake.road([at(-145,145),at(-113,v),at(98,v)],2.8,'rgba(54,54,43,.55)');
      for(let j=0;j<6;j++) {
        const u=-112+j*37;
        bake.road([at(u,193),at(u,229)],.8,'rgba(188,176,132,.44)');
      }
      // Sparse logistics stacks and fuel vessels rather than arbitrary clutter.
      for(let j=0;j<5;j++) {
        const [x,y]=at(-100+j*42,215), w=j<3?23:14,d=j<3?12:14,h=j<3?6:9;
        const col=rgb(j<3?['#77705a','#636953','#787b66'][j]:'#656d68');
        bake.building(x,y,w,d,c.a,h);
        batch.box(x,y,GROUND,w,d,h,c.a,shade(col,.65),col);
        if(j<3)for(const du of [-7,7]) {
          const [xx,yy]=at(-100+j*42+du,215);
          batch.box(xx,yy,GROUND+h,.8,d+.3,.35,c.a,rgb('#a49978'));
        }
      }
      // Drainage bank and fence line frame the yard without blocking aircraft.
      bake.road([at(-130,244),at(120,239)],7,'rgba(47,59,37,.52)');
      for(let j=0;j<12;j++) {
        const [x,y]=at(-128+j*22,242);
        batch.box(x,y,GROUND,1,1,5,c.a,rgb('#746c55'));
      }
      batch.ribbon([at(-128,242),at(114,242)],.7,GROUND+3,rgb('#8c846d'));
      blocked.push({x:at(-5,205)[0],y:at(-5,205)[1],r:125});
    }

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
    // --- Roads: village to village and on to the installations ---------------
    const nodes = villages.filter(v => !v.tiny).map(v => ({ x: v.x, y: v.y, village: v }));
    for (const c of clears) {
      // Airfield roads meet the apron behind the hangars; other installations are met at their edge.
      // The apron road comes in from behind the hangars: an approach node well
      // outside the clear zone, then the entry, so no link crosses the runway.
      const entry = c.role === 'airfield' ? { x: c.x - Math.sin(c.a) * 96, y: c.y + Math.cos(c.a) * 96 } : null;
      const approach = entry && { x: c.x - Math.sin(c.a) * (c.r + 40), y: c.y + Math.cos(c.a) * (c.r + 40) };
      if (entry && inside(entry.x, entry.y) && inside(approach.x, approach.y)) {
        nodes.push(approach);
        roads.push([[approach.x, approach.y], [entry.x, entry.y]]);
        bake.road(roads[roads.length-1],L.roadWidth+6,'rgba(131,117,88,.45)');
        batch.ribbon(roads[roads.length - 1], L.roadWidth, GROUND + .3, rgb(B.road));
      } else if (nodes.length) {
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
        const a = order[i], b = order[i + 1], length = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(2, Math.round(length / 60));
        const points = [[a.x, a.y]];
        let ok = true;
        for (let k = 1; k < steps; k++) {
          // A gentle, continuous curve: one low-frequency bend per link, plus a
          // little noise, both zero at the ends so the road arrives straight.
          const f = k / steps, x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
          const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
          const bend = (noise(gx * .37 + i * 3.1, gy * .53 + 2.2, 1) - .5) * Math.min(90, length * .18) * Math.sin(f * Math.PI);
          const jitter = (noise(x * .012 + gx, y * .012 + gy, 1) - .5) * 24 * Math.sin(f * Math.PI);
          const px = x + nx * (bend + jitter), py = y + ny * (bend + jitter);
          if (!insidePolygon(x, y, interior) || !clear(x, y, -30)) { ok = false; break; }
          points.push(inside(px, py) ? [px, py] : [x, y]);
        }
        if (!ok) continue;
        points.push([b.x, b.y]);
        bake.road(points,L.roadWidth+6,'rgba(131,117,88,.45)');
        batch.ribbon(points, L.roadWidth, GROUND + .3, rgb(B.road));
        roads.push(points);
        // Villages line up along the road that serves them.
        for (const [node, neighbour] of [[a, b], [b, a]]) if (node.village && node.village.lane == null) node.village.lane = Math.atan2(neighbour.y - node.y, neighbour.x - node.x);
        const [minT, maxT] = L.traffic.trucksPerRoad, trucks = minT + Math.floor(rng() * (maxT - minT + 1));
        const total = points.reduce((n, p, k) => k ? n + Math.hypot(p[0] - points[k - 1][0], p[1] - points[k - 1][1]) : 0, 0);
        for (let k = 0; k < trucks; k++) traffic.trucks.push({ path: points, length: total, s: rng() * total, dir: rng() < .5 ? 1 : -1, wait: 0, speed: L.traffic.truckSpeed * (.8 + rng() * .4), tint: rng() });
      }
    }
    const nearRoad = (x, y, margin) => roads.some(points => points.some((p, k) => k && segmentDistance(x, y, points[k - 1], p) < margin));

    // --- Houses either side of the lane, never on the road --------------------
    for (const v of villages) {
      const houses = v.tiny ? 2 + Math.floor(rng() * 2) : v.coastal ? 5 + Math.floor(rng() * 4) : 6 + Math.floor(rng() * 7);
      const lane = v.lane ?? v.a + Math.PI / 2, c = Math.cos(lane), s = Math.sin(lane);
      if (B.huts === 'house') batch.disc(v.x, v.y, GROUND + .2, 20, 9, rgb('#a99a72'), rng());
      if (B.huts === 'adobe') batch.disc(v.x, v.y, GROUND + .2, 26, 8, rgb('#c7ad78'), rng());
      let placed = 0;
      for (let i = 0; i < houses * 2 && placed < houses; i++) {
        const side = i % 2 ? 1 : -1, u = (Math.floor(i / 2) - (houses - 1) / 4) * 24 + (rng() - .5) * 6, vv = side * (19 + rng() * 7);
        const x = v.x + u * c - vv * s, y = v.y + u * s + vv * c;
        const w = L.houseSize * (.75 + rng() * .5), d = L.houseSize * (.6 + rng() * .4), rot = lane + (rng() - .5) * .25;
        if (!inside(x, y) || !clear(x, y, 10) || nearRoad(x, y, L.roadWidth / 2 + Math.max(w, d) * .6 + 2)) continue;
        bake.building(x,y,w,d,rot,B.huts==='house'?9:6);
        if (B.huts === 'thatch') {
          if (rng() < .6) batch.cone(x, y, GROUND, 5 + rng() * 3, 6, 7, rgb('#8d6d3f'), rgb('#6f532f'), rng() * TAU);
          else { batch.box(x, y, GROUND, w, d, 3, rot, rgb('#8a7350')); batch.roof(x, y, GROUND + 3, w, d, 4, rot, rgb('#a3874f')); }
        } else if (B.huts === 'adobe') {
          batch.box(x, y, GROUND, w, d, 4 + rng() * 3, rot, rgb('#9c7550'), rgb('#e0c396'));
        } else {
          batch.box(x, y, GROUND, w, d, 5, rot, rgb(WALLS[Math.floor(rng() * WALLS.length)]));
          batch.roof(x, y, GROUND + 5, w, d, 4, rot, rgb(ROOFS[Math.floor(rng() * ROOFS.length)]));
        }
        placed++;
      }
      if (B.huts === 'house' && !v.tiny) {
        const tx = v.x - s * 30, ty = v.y + c * 30;
        if (inside(tx, ty) && !nearRoad(tx, ty, 8)) { batch.box(tx, ty, GROUND, 4, 4, 14, lane, rgb('#d9d2c2')); batch.cone(tx, ty, GROUND + 14, 3.2, 5, 4, rgb('#6b6f74'), rgb('#6b6f74'), lane); }
      }
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
      bake.shadow(p.x,p.y,size*.95,size*.45,.28);
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
      let jx = x + (hash2(x + gx, y) - .5) * spacing * .9, jy = y + (hash2(y + gy, x) - .5) * spacing * .9;
      if (!inside(jx, jy) || !detailClear(jx, jy,12) || isBlocked(jx, jy) || nearRoad(jx, jy, 10)) continue;
      const h = hill(jx, jy), coast = polygonDistance(jx, jy, shore);
      if (coast < 24) continue;   // the beach is sand, not forest
      const f = smoothstep(.3, .7, forestNoise(jx, jy)) * (1 - smoothstep(.72, .88, h)) + (coast < 75 ? .15 : 0);
      const r = hash2(jx * 3 + gy, jy * 3 + gx);
      if (B.scrub && r < .18 && h < .7) { batch.cone(jx, jy, GROUND, 3 + r * 12, 3, 5, rgb(B.trees[1]), rgb(B.trees[0]), r * TAU); continue; }
      if (f < threshold || (farmland(jx, jy) && r > .06)) continue;
      // Redistribute the same eligible trees into irregular close-knit groves.
      // No additional crowns/triangles: rejected moves retain original positions.
      if(!B.palmOnly&&!B.scrub) {
        const cell=112,cx=Math.floor(jx/cell),cy=Math.floor(jy/cell);
        const ax=(cx+.30+hash2(cx+gx,cy)*.4)*cell,ay=(cy+.30+hash2(cy+gy,cx)*.4)*cell;
        const xx=ax+(jx-ax)*.52,yy=ay+(jy-ay)*.52;
        if(inside(xx,yy)&&detailClear(xx,yy,15)&&!isBlocked(xx,yy)&&!nearRoad(xx,yy,14)&&!farmland(xx,yy)&&polygonDistance(xx,yy,shore)>28) {
          jx=xx;jy=yy;
        }
      }
      trees++;
      const color = treeColors[Math.floor(r * treeColors.length)];
      // Irregular leaf litter anchors each crown and joins close trees into
      // woodland masses. Seven cheap polygon vertices, no extra gradient.
      const litter=[];
      for(let k=0;k<7;k++) { const a=k*TAU/7,rr=(20+r*10)*( .8+hash2(k,jx)*.35);litter.push([jx+Math.cos(a)*rr,jy+Math.sin(a)*rr]); }
      bake.patch(litter,'rgba(48,60,33,.40)');
      bake.shadow(jx,jy,11+r*5,18,.57);
      if (B.palmOnly || (B.palms && (coast < 90 || r < .12))) batch.palm(jx, jy, GROUND, 8 + r * 5, color, r * TAU);
      else if (B.acacia) { batch.cone(jx, jy, GROUND + 6, 9 + r * 5, 3, 6, color, shade(color, .85), r * TAU); batch.box(jx, jy, GROUND, 1.6, 1.6, 6, 0, rgb('#5a4630')); }
      else batch.broadleaf(jx,jy,GROUND,10+r*6,color,r*TAU);
    }
    // Connected low rock shelves replace isolated stones on geological reaches.
    // All face vertices remain inside the unchanged physical shore polygon.
    for(let i=0;i<denseShore.length;i++) {
      const j=(i+1)%denseShore.length,p=denseShore[i],q=denseShore[j];
      const reach=rockReach((p[0]+q[0])*.5,(p[1]+q[1])*.5);
      if(reach<.55)continue;
      const a=interior[i],b=interior[j];
      if(![p,q,a,b].every(([x,y])=>detailClear(x,y,10))||nearRoad(a[0],a[1],12))continue;
      const outerA=[p[0]+(a[0]-p[0])*.16,p[1]+(a[1]-p[1])*.16];
      const outerB=[q[0]+(b[0]-q[0])*.16,q[1]+(b[1]-q[1])*.16];
      if(![outerA,outerB,a,b].every(([x,y])=>insidePolygon(x,y,shore)))continue;
      const h=GROUND+2+reach*3,ref=[(a[0]+b[0])*.5,2,(a[1]+b[1])*.5];
      const v=(p,h)=>[p[0],h,p[1]],col=rgb(B.rock);
      batch.face([v(outerA,3.6),v(outerB,3.6),v(b,h),v(a,h)],shade(col,.75),ref);
      batch.face([v(a,h),v(b,h),v(b,GROUND),v(a,GROUND)],shade(col,.52),ref);
      bake.road([a,b],8,'rgba(37,47,37,.46)');
      bake.road([a,b],2,'rgba(158,147,111,.45)');
    }

    // Low coastal outcrops, drift and scrub form irregular groups instead of
    // single gems spaced at polygon vertices. All centers remain on real land.
    for(let i=0;i<denseShore.length;i+=2) {
      const p=denseShore[i],q=interior[i],h=hash2(p[0]+gx,p[1]+gy);
      if(h>.55||rockReach(p[0],p[1])>.55)continue;
      const dx=q[0]-p[0],dy=q[1]-p[1],distance=Math.hypot(dx,dy)||1;
      const nx=dx/distance,ny=dy/distance,x=p[0]+nx*(16+h*32),y=p[1]+ny*(16+h*32);
      if(!insidePolygon(x,y,shore)||!detailClear(x,y,15)||nearRoad(x,y,12))continue;
      const count=2+Math.floor(h*5);
      for(let j=0;j<count;j++) {
        const offset=(j-(count-1)/2)*8,xx=x-ny*offset+nx*(hash2(i,j)-.5)*8,yy=y+nx*offset+ny*(hash2(j,i)-.5)*8;
        if(!insidePolygon(xx,yy,shore)||!detailClear(xx,yy,12))continue;
        const rockSize=4+hash2(xx+gx,yy+gy)*7;
        const grass=insidePolygon(xx,yy,interior),height=grass?GROUND:3.5;
        bake.shadow(xx,yy,rockSize*1.15,rockSize*.5,.36);
        if(j===0&&h<.22&&grass) {
          batch.cone(xx,yy,height,rockSize*.85,3,7,shade(rgb(B.trees[0]),.75),rgb(B.trees[1]),h*TAU);
          batch.cone(xx+rockSize*.5,yy-rockSize*.3,height+1,rockSize*.65,2.5,6,rgb(B.trees[0]),shade(rgb(B.trees[1]),1.05),h*TAU);
        } else {
          batch.cone(xx,yy,height,rockSize,rockSize*.46,6,shade(rgb(B.rock),.75),shade(rgb(B.rock),1.12),h*TAU+j);
          if(j===1)batch.box(xx,yy,height+.8,rockSize*1.3,1.5,1.4,Math.atan2(ny,nx)+.5,rgb('#665e46'),rgb('#8d805c'));
        }
      }
    }
    if (B.scrub || B.volcano) for (let i = 0; i < radius / 40; i++) {
      const a = rng() * TAU, r = rng() * radius * .8, x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (!inside(x, y) || !clear(x, y) || isBlocked(x, y) || nearRoad(x, y, 12)) continue;
      batch.cone(x, y, GROUND, 5 + rng() * 9, 4 + rng() * 5, 5, rgb(B.rock), shade(rgb(B.rock), 1.25), rng() * TAU);
    }

    ground.uniforms.albedoMap.value=bake.finish();
    if (batch.n) group.add(new THREE.Mesh(batch.build(), sceneryMaterial));
    group.userData = { radius, extent: t.extent ?? radius, biome: biomeName, villages: villages.length, roads: roads.length, trees, traffic };
    return group;
  }

  // Wire format contains transferable buffers and plain metadata only. Main
  // materials retain their live uniforms and shader hooks after reconstruction.
  async function serialize(group) {
    const ground = group.children.find(n => n.material?.uniforms?.albedoMap)?.material;
    const canvas = ground.uniforms.albedoMap.value.image;
    // WebGL ignores Texture.flipY for ImageBitmap: perform its equivalent here.
    const bitmap = await createImageBitmap(canvas, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const meshes = group.children.map(n => ({
      role: n.material === shared.surfMaterial ? 'surf' : n.material === shallowsMaterial ? 'shallows' : n.material === sceneryMaterial ? 'scenery' : 'ground',
      position: n.position.toArray(), quaternion: n.quaternion.toArray(), scale: n.scale.toArray(),
      attributes: Object.fromEntries(Object.entries(n.geometry.attributes).map(([key,a]) => [key, { array:a.array, itemSize:a.itemSize, normalized:a.normalized }])),
      index: n.geometry.index?.array || null,
    }));
    const payload = { position:group.position.toArray(), userData:group.userData, meshes, bitmap,
      terrainMin:ground.uniforms.terrainMin.value.toArray(), terrainSize:ground.uniforms.terrainSize.value.toArray() };
    return payload;
  }
  function hydrate(payload) {
    const group = new THREE.Group(); group.position.fromArray(payload.position); group.userData = payload.userData;
    const texture = new THREE.Texture(payload.bitmap);
    texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false;
    texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true; texture.needsUpdate = true;
    const ground = groundTemplate.clone(); ground.uniforms.noiseTex.value = noiseTexture();
    for (const key of ['time', 'wind', 'cloudSpeed', 'cloudStrength']) ground.uniforms[key] = shared[key];
    ground.uniforms.albedoMap.value = texture;
    ground.uniforms.terrainMin.value.fromArray(payload.terrainMin); ground.uniforms.terrainSize.value.fromArray(payload.terrainSize);
    const materials = { ground, surf:shared.surfMaterial, shallows:shallowsMaterial, scenery:sceneryMaterial };
    for (const data of payload.meshes) {
      const geometry = new THREE.BufferGeometry();
      for (const [key,a] of Object.entries(data.attributes)) geometry.setAttribute(key,new THREE.BufferAttribute(a.array,a.itemSize,a.normalized));
      if (data.index) geometry.setIndex(new THREE.BufferAttribute(data.index,1));
      const mesh = new THREE.Mesh(geometry,materials[data.role]);
      mesh.position.fromArray(data.position); mesh.quaternion.fromArray(data.quaternion); mesh.scale.fromArray(data.scale); group.add(mesh);
    }
    return group;
  }
  return {
    build, serialize, hydrate,
    dispose(group) {
      const disposed=new Set();
      group.traverse(node => {
        if (!node.isMesh) return;
        node.geometry.dispose();
        if (node.material.uniforms?.albedoMap && !disposed.has(node.material)) { disposed.add(node.material); node.material.uniforms.albedoMap.value?.image?.close?.(); node.material.uniforms.albedoMap.value?.dispose(); node.material.dispose(); }
      });
    },
  };
}

