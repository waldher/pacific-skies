// Low-poly ship meshes, airfields and installations, built once and reused.
//
// Every static part is merged into one vertex-coloured mesh per object, so a
// carrier is one draw call instead of thirty. Only parts that move or change
// state stay separate: turrets and radar dishes rotate, hangars collapse as
// an airfield takes damage, beacons and flags recolour with ownership.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';
import { shipObserved, installationKnown, observedAt } from './intelligence.js';
import { noiseTexture, NOISE_GLSL } from './noise.js';
import { createShadow, projectShadow, casters } from './shadow.js';

const paint = new THREE.MeshLambertMaterial({ vertexColors: true });
const solid = hex => new THREE.MeshLambertMaterial({ color: hex });
const rubbleMat = solid('#2b2a28'), dark = solid('#263743'), cabin = solid('#839296');
const friend = new THREE.MeshBasicMaterial({ color: '#62ddba' });
const hostile = new THREE.MeshBasicMaterial({ color: '#ee7964' });
const HULL = '#2c3944', BOOT = '#141b21', STEEL = '#59656c', DECK = '#565f63', WOOD = '#8f7a52', WOOD2 = '#836f49', SEAM = '#54462f';
const CABIN = '#8a979b', CABIN2 = '#a3aeb0', DARK = '#232d35', GUN = '#4b565d', WHITE = '#ece5bf', GLASS = '#1d2a33', SOOT = '#14181b';
const FRIEND = '#62ddba', HOSTILE = '#ee7964', RUNWAY = '#454b4a', APRON = '#8b8b80', EARTH = '#a8996f';
const FLAT = [-Math.PI / 2, 0, 0];

// Collects coloured parts and merges them into one geometry.
class Parts {
  constructor() { this.list = []; }
  add(geometry, hex, position = [0, 0, 0], rotation = null) {
    const c = new THREE.Color(hex);
    if (rotation) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
    geometry.translate(...position);
    geometry.deleteAttribute('uv');
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.list.push(geometry.index ? geometry.toNonIndexed() : geometry);
    return this;
  }
  box(dimensions, position, hex, turn = 0) { return this.add(new THREE.BoxGeometry(...dimensions), hex, position, turn ? [0, turn, 0] : null); }
  cyl(radius, height, position, hex, top = radius) { return this.add(new THREE.CylinderGeometry(top, radius, height, 10), hex, position); }
  // Flat marking lying on a surface.
  mark(shape, position, hex) { return this.add(new THREE.ShapeGeometry(shape), hex, position, FLAT); }
  // Building with a gabled roof whose ridge runs along z.
  shed([w, h, d], [x, y, z], wall, roof, rise = w * .22) {
    this.box([w, h, d], [x, y + h / 2, z], wall);
    const gable = new THREE.Shape(); gable.moveTo(-w / 2 - 1, 0); gable.lineTo(w / 2 + 1, 0); gable.lineTo(0, rise); gable.closePath();
    return this.add(new THREE.ExtrudeGeometry(gable, { depth: d + 2, bevelEnabled: false }), roof, [x, y + h, z - d / 2 - 1]);
  }
  geometry() {
    const geometry = mergeGeometries(this.list);
    for (const part of this.list) part.dispose();
    return geometry;
  }
  mesh() { return new THREE.Mesh(this.geometry(), paint); }
}
const HULL_POINTS = [[0, .5], [.4, .35], [.5, .15], [.5, -.43], [.32, -.5], [-.32, -.5], [-.5, -.43], [-.5, .15], [-.4, .35]];
function hullShape(width, length) {
  const shape = new THREE.Shape();
  HULL_POINTS.forEach(([x, y], i) => i ? shape.lineTo(x * width, y * length) : shape.moveTo(x * width, y * length));
  shape.closePath();
  return shape;
}
const hullOutline = (width, length, height) => new THREE.ExtrudeGeometry(hullShape(width, length), { depth: height, bevelEnabled: false });
// How far a deck line at lateral offset x can run before the hull tapers away
// (bow is -z), so planking and markings follow the pointed bow.
function deckRun(x, width, length) {
  const u = Math.abs(x) / width;
  const bow = u <= .4 ? .35 + .15 * (1 - u / .4) : .15 + .2 * (.5 - u) / .1;
  const stern = u <= .32 ? .5 : .43 + .07 * (.5 - u) / .18;
  return [-bow * length, stern * length];
}
const disc = radius => { const shape = new THREE.Shape(); shape.absarc(0, 0, radius, 0, Math.PI * 2); return shape; };

function carrierParts(enemy) {
  const L = CONFIG.carrier.length, W = CONFIG.carrier.width, parts = new Parts(), light = enemy ? HOSTILE : FRIEND;
  parts.add(hullOutline(W * .9, L * .99, 2.5), BOOT, [0, 0, 0], FLAT);
  parts.add(hullOutline(W * .96, L, 6.5), HULL, [0, 2.5, 0], FLAT);
  // The steel deck edge and its galleries frame the planking in dark grey.
  parts.add(hullOutline(W, L * .985, 1.4), STEEL, [0, 9, 0], FLAT);
  const DL = L * .94, DW = W - 9;
  parts.add(hullOutline(DW, DL, .7), WOOD, [0, 10.4, 0], FLAT);
  // Planking: broad alternate runs in a second tone, following the bow's taper.
  for (let x = -DW / 2 + 4, i = 0; x < DW / 2 - 2; x += 6.4, i++) {
    const [z0, z1] = deckRun(x + (x < 0 ? -3.2 : 3.2), DW, DL), run = z1 - z0 - 6;
    if (i % 2 && run > 8) parts.box([6.4, .08, run], [x, 11.14, (z0 + z1) / 2], WOOD2);
  }
  // Elevators, catapult tracks and arresting gear.
  for (const [x, z] of [[0, -62], [-4, 14], [0, 84]]) {
    parts.box([21, .1, 25], [x, 11.2, z], '#93805a');
    for (const [w, d, ox, oz] of [[23, 1.4, 0, -12.5], [23, 1.4, 0, 12.5], [1.4, 25, -10.8, 0], [1.4, 25, 10.8, 0]]) parts.box([w, .12, d], [x + ox, 11.22, z + oz], SEAM);
  }
  for (const x of [-9, 9]) parts.box([1.5, .12, 54], [x, 11.22, -82], '#4a4334');
  for (const z of [46, 58, 70]) parts.box([DW - 12, .5, 1.3], [0, 11.4, z], DARK);
  // Paint: dashed centreline, edge lines, a ramp at the stern.
  for (let z = -98; z < 108; z += 22) parts.box([2.2, .1, 12], [0, 11.26, z], WHITE);
  for (const x of [-22, 22]) parts.box([1.6, .1, 150], [x, 11.26, 28], '#c9c09c');
  for (const x of [-18, -12, -6, 6, 12, 18]) parts.box([2.6, .1, 9], [x, 11.26, 103], WHITE);
  if (enemy) { parts.mark(disc(13), [0, 11.3, -86], '#f3ede0'); parts.mark(disc(9.5), [0, 11.34, -86], '#c5312b'); }
  // Island: stepped bridge, raked funnel, tripod mast and radar.
  const ix = W / 2 - 4;
  parts.box([14, 12, 60], [ix, 17, -10], CABIN);
  parts.box([12, 9, 28], [ix, 27.5, -22], CABIN2);
  parts.box([12.4, 2.4, 24], [ix, 29.5, -23], GLASS);
  parts.box([10, 6, 15], [ix, 35, -25], CABIN);
  parts.cyl(6, 20, [ix, 33, 5], GUN, 5); parts.cyl(5.2, 1.6, [ix, 43.5, 5], SOOT);
  parts.cyl(.8, 26, [ix, 51, -24], DARK, .5);
  parts.box([16, .9, 1.4], [ix, 60, -24], CABIN2); parts.box([10, 5, .9], [ix, 64, -24], GUN);
  // Twin five-inch mounts fore and aft of the island, AA tubs down the port edge.
  for (const z of [-48, -40, 22, 30]) { parts.cyl(3.4, 4, [ix, 13, z], GUN); parts.box([1, 1, 9], [ix, 14.5, z + (z < 0 ? -5 : 5)], DARK); }
  for (let z = -70; z < 100; z += 21) { parts.cyl(2.6, 2.2, [-W / 2 - .5, 9.4, z], GUN); parts.box([.7, .7, 5], [-W / 2 - 2.4, 10.6, z], DARK, .9); }
  for (const z of [-70, -6, 58, 104]) for (const x of [-W / 2 + 2.2, W / 2 - 2.2]) parts.box([1.8, .8, 1.8], [x, 11.5, z], light);
  return parts;
}
function destroyerParts(enemy) {
  const L = CONFIG.ship.length, W = CONFIG.ship.width, parts = new Parts(), light = enemy ? HOSTILE : FRIEND;
  parts.add(hullOutline(W * .84, L * .99, 2.5), BOOT, [0, 0, 0], FLAT);
  parts.add(hullOutline(W * .9, L, 6.5), HULL, [0, 2.5, 0], FLAT);
  parts.add(hullOutline(W, L * .95, 1.2), DECK, [0, 9, 0], FLAT);
  parts.add(hullOutline(W * .55, L * .82, .3), '#525b5e', [0, 10.2, 2], FLAT);
  parts.box([15, 7, 22], [0, 13.6, -14], CABIN);
  parts.box([12, 5, 13], [0, 19.6, -18], CABIN2); parts.box([12.4, 1.4, 11], [0, 20.6, -19], GLASS);
  parts.cyl(.6, 20, [0, 30, -12], DARK, .4); parts.box([10, .7, 1], [0, 37, -12], CABIN2);
  for (const z of [0, 14]) { parts.cyl(3.4, 11, [0, 15.5, z], GUN, 2.9); parts.cyl(3, 1, [0, 21.5, z], SOOT); }
  parts.box([5, 2.4, 15], [0, 11.6, 27], GUN, .35);
  for (const [x, z] of [[-9, 6], [9, 6], [-9, 22], [9, 22]]) parts.cyl(2, 2, [x, 11.2, z], GUN);
  for (const x of [-5, 5]) parts.box([2.2, 2, 11], [x, 11.2, 49], DARK);
  parts.box([10, .2, 6], [0, 10.4, -47], light);
  return parts;
}

// A loaded merchant hull: hatches and crates on deck, derricks, a funnel aft.
function transportParts() {
  const V = CONFIG.convoy, parts = new Parts();
  parts.add(hullOutline(V.width * .84, V.length * .99, 2), BOOT, [0, 0, 0], FLAT);
  parts.add(hullOutline(V.width * .9, V.length, 6), '#4d443a', [0, 2, 0], FLAT);
  parts.add(hullOutline(V.width, V.length * .95, 1.2), '#7d7462', [0, 8, 0], FLAT);
  for (const [z, w] of [[-12, 11], [1, 12], [12, 10]]) { parts.box([w, 1.2, 8], [0, 9.8, z], '#5b5448'); parts.box([w - 3, 3.5, 5], [0, 12, z], z ? '#8a6d47' : '#6f7a52'); }
  parts.cyl(.5, 16, [0, 17, -5], DARK); parts.cyl(.5, 16, [0, 17, 7], DARK);
  parts.box([10, 8, 11], [0, 13.2, 21], CABIN); parts.box([10.3, 1.3, 8], [0, 15.4, 20], GLASS);
  parts.cyl(1.9, 9, [0, 20, 23], DARK); parts.cyl(1.9, 1.5, [0, 23, 23], '#8c3b2c');
  return parts;
}
const deckCasters = new WeakMap();
function turretMesh() {
  const mesh = new Parts().cyl(5.2, 4, [0, 0, 0], GUN, 4.6).box([1.1, 1.1, 15], [-1.7, .8, -9], DARK).box([1.1, 1.1, 15], [1.7, .8, -9], DARK).mesh();
  mesh.name = 'Turret';
  return mesh;
}
function shipTemplate(kind, enemy = false) {
  const group = new THREE.Group();
  const body = (kind === 'carrier' ? carrierParts(enemy) : kind === 'transport' ? transportParts() : destroyerParts(enemy)).mesh();
  body.name = 'Body'; group.add(body);
  // Shadow caster: the hull as a plain slab plus the superstructure block.
  const size = kind === 'carrier' ? CONFIG.carrier : kind === 'transport' ? CONFIG.convoy : CONFIG.ship;
  const slab = new Parts().add(hullOutline(size.width, size.length * .97, kind === 'carrier' ? 11 : 9), DARK, [0, 0, 0], FLAT);
  if (kind === 'carrier') slab.box([13, 24, 56], [size.width / 2 - 5, 23, -10], DARK); else slab.box([size.width * .5, 12, size.length * .3], [0, 15, kind === 'transport' ? 18 : -8], DARK);
  casters.set(body.geometry, slab.geometry());
  // What stands on the deck also shades the deck itself.
  if (kind === 'carrier') deckCasters.set(body.geometry, new Parts().box([14, 26, 60], [size.width / 2 - 4, 24, -10], DARK).cyl(6, 34, [size.width / 2 - 4, 28, 5], DARK).geometry());
  else if (kind === 'destroyer') deckCasters.set(body.geometry, new Parts().box([15, 14, 22], [0, 17, -14], DARK).cyl(3.4, 12, [0, 16, 0], DARK).cyl(3.4, 12, [0, 16, 14], DARK).geometry());
  if (kind === 'destroyer') for (const z of [-37, 38]) { const turret = turretMesh(); turret.position.set(0, 12, z); group.add(turret); }
  return group;
}

// Wake: one quad per ship. The fragment shader draws a churned core that
// widens and fades astern and the two bow-wave arms, broken up by scrolling
// noise. Hull foam is the same material on the front of the quad.
const wakeMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { noiseTex: { value: noiseTexture() }, time: { value: 0 }, beam: { value: 1 / CONFIG.render.wake.width }, stern: { value: (CONFIG.render.wake.lead + 1) / CONFIG.render.wake.length } },
  vertexShader: `varying vec2 vUv; varying vec2 worldXZ;
    void main() {
      vUv = uv; vec4 world = modelMatrix * vec4(position, 1.0); worldXZ = world.xz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }`,
  fragmentShader: `varying vec2 vUv; varying vec2 worldXZ; uniform float time, beam, stern;
    ${NOISE_GLSL}
    void main() {
      // u: 0 on the track, 1 at the quad edge; v: 0 ahead of the bow, 1 at the tail.
      float u = abs(vUv.x * 2.0 - 1.0), v = 1.0 - vUv.y;
      vec4 n = vnoise4(worldXZ * .085 + vec2(time * .25, 0.0));
      float aft = clamp((v - stern) / (1.0 - stern), 0.0, 1.0);
      // Churned water straight astern, widening a little and thinning out.
      float core = (1.0 - smoothstep(beam * .3, beam * (.8 + aft * .5), u)) * smoothstep(stern - .05, stern + .02, v) * pow(1.0 - aft, 1.3);
      // Bow wave: two arms leaving the hull, breaking up as they spread aft.
      float along = v / stern, arm = beam * (.3 + .72 * min(along, 1.0)) + max(along - 1.0, 0.0) * beam * .5;
      float arms = (1.0 - smoothstep(.0, beam * .2, abs(u - arm))) * smoothstep(.03, .12, v) * (1.0 - smoothstep(.25, .75, v));
      float foam = core * (.3 + .7 * n.r) + arms * smoothstep(.3, .65, n.a) * .8;
      gl_FragColor = vec4(.8, .92, .94, clamp(foam, 0.0, 1.0) * .6);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});

export function createNavalScene(scene) {
  const templates = { carrier: shipTemplate('carrier'), enemyCarrier: shipTemplate('carrier', true), destroyer: shipTemplate('destroyer'), enemyDestroyer: shipTemplate('destroyer', true), transport: shipTemplate('transport') };
  const ships = new Map(), zones = new Map(), airfields = new Map(), bombs = new Map();
  const bombGeometry = new THREE.SphereGeometry(3, 6, 4);
  const bombRing = new THREE.RingGeometry(14, 16, 24).rotateX(-Math.PI / 2);
  // Unit quad in the ship's frame: x across, bow at -z, with v running bow to tail.
  const wakeGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const ringGeometry = new THREE.RingGeometry(CONFIG.conquest.captureRadius - 2, CONFIG.conquest.captureRadius, 64).rotateX(-Math.PI / 2);
  const flagGeometry = new THREE.BoxGeometry(24, .8, 14);
  const beaconGeometry = new THREE.BoxGeometry(8, 1, 8);
  const length = CONFIG.airfield?.length ?? 300, width = CONFIG.airfield?.width ?? 70;
  const G = CONFIG.render.groundHeight;
  // Airfield in its own frame: runway along z, dispersal and hangars on +x.
  // Everything static is one mesh shared by every airfield; a second geometry
  // holds just the tall parts, for the shadow.
  const ground = new Parts(), tall = new Parts();
  const rounded = (w, d, r) => { const shape = new THREE.Shape(), x = w / 2, y = d / 2;
    shape.moveTo(-x + r, -y); shape.lineTo(x - r, -y); shape.quadraticCurveTo(x, -y, x, -y + r); shape.lineTo(x, y - r); shape.quadraticCurveTo(x, y, x - r, y);
    shape.lineTo(-x + r, y); shape.quadraticCurveTo(-x, y, -x, y - r); shape.lineTo(-x, -y + r); shape.quadraticCurveTo(-x, -y, -x + r, -y); return shape; };
  // Graded earth under the whole station, then the paved surfaces.
  ground.box([width + 8, .3, length + 8], [0, G + .45, 0], '#8f8a78');
  ground.box([width, .5, length], [0, G + .5, 0], RUNWAY);
  for (const x of [-8, 8]) ground.box([7, .1, length - 70], [x, G + .78, 0], '#3c4241');   // tyre-worn lanes
  ground.box([width / 2 + 30, .4, 176], [width / 2 + 34, G + .45, 0], APRON);
  for (const z of [-65, 0, 65]) ground.box([40, .1, .5], [width / 2 + 34, G + .68, z + 30], '#74746a');
  for (const z of [-length / 2 + 16, length / 2 - 16]) ground.box([18, .4, 12], [width / 2 + 8, G + .45, z], APRON);
  // Markings: centreline, edge lines, thresholds and the approach arrow.
  for (let z = -length / 2 + 25; z < length / 2; z += 35) ground.box([2, .1, 17], [0, G + .9, z], WHITE);
  for (const x of [-width / 2 + 3, width / 2 - 3]) ground.box([.9, .1, length - 12], [x, G + .9, 0], '#c9c3a4');
  for (const end of [-1, 1]) for (const x of [-21, -13, 13, 21]) ground.box([4, .1, 15], [x, G + .9, end * (length / 2 - 18)], WHITE);
  const arrow = new THREE.Shape();
  [[0, 20], [12, 3], [4, 3], [4, -18], [-4, -18], [-4, 3], [-12, 3]].forEach(([x, y], i) => i ? arrow.lineTo(x, y) : arrow.moveTo(x, y));
  arrow.closePath();
  ground.mark(arrow, [0, G + 1.1, length / 2 - 52], WHITE);
  // Control tower, fuel dump, revetments and stores along the dispersal.
  const tx = width / 2 + 16, tz = -112;
  tall.box([11, 20, 11], [tx, G + 10, tz], '#b9b4a0'); tall.box([14, 5, 14], [tx, G + 22.5, tz], GLASS); tall.box([16, 1.2, 16], [tx, G + 25.6, tz], '#7c4f3d');
  for (const [x, z] of [[58, 112], [70, 112], [64, 124]]) { tall.cyl(5, 8, [width / 2 + x - 40, G + 4, z], '#b5b8b2'); tall.cyl(5, .6, [width / 2 + x - 40, G + 8.3, z], '#8d918c'); }
  for (const z of [-98, -86, 96]) for (const x of [64, 73]) tall.box([7, 4.5, 7], [width / 2 + x, G + 2.2, z], (x + z) % 2 ? '#6c7350' : '#7a6a48');
  // Dispersal pens across the runway: a hardstand inside a low earth bank.
  for (const z of [-40, 36]) {
    ground.box([24, .3, 22], [-width / 2 - 21, G + .45, z], '#6e6d62');
    for (const [w, d, ox, oz] of [[28, 4, 0, -13], [28, 4, 0, 13], [4, 30, -14, 0]]) tall.box([w, 4, d], [-width / 2 - 21 + ox, G + 2, z + oz], '#7d7552');
  }
  tall.cyl(.5, 13, [-width / 2 - 9, G + 6.5, length / 2 - 30], DARK); tall.box([7, 2, 2], [-width / 2 - 5.5, G + 12.5, length / 2 - 30], '#e8743b');
  const tallGeometry = tall.geometry();
  const runwayGeometry = mergeGeometries([ground.geometry(), tallGeometry]);
  const hangarGeometry = new Parts().shed([35, 13, 40], [0, 0, 0], '#8f8d7c', '#5c7a8c', 9).box([36, 11, 1], [-17.6, 5.5, 0], '#3a4146').box([1, 8, 24], [-17.8, 4, 0], '#2a3035').geometry();
  const rubbleGeometry = new Parts().box([35, 3, 40], [0, 1.5, 0], '#2e2c29').box([16, 6, 12], [-6, 3, 8], '#3b3833', .5).box([12, 5, 10], [8, 2.5, -9], '#24221f', -.3).box([20, 1.5, 4], [2, 4, -2], '#4a443a', .9).geometry();
  const radarGeometry = new Parts().shed([32, 11, 26], [70, G, 0], '#8f8d7c', '#6b6f5c', 6).box([8, 7, 8], [48, G + 3.5, 14], '#6c7350')
    .cyl(1.6, 46, [70, G + 34, 0], DARK, 1).box([14, 1, 1], [70, G + 44, 0], DARK).box([1, 1, 14], [70, G + 30, 0], DARK).geometry();
  const dishGeometry = new Parts().box([44, 18, 1.2], [0, 0, 0], '#9aa4a6').box([40, .8, 2], [0, 5, 0], DARK).box([40, .8, 2], [0, -5, 0], DARK).box([.8, 18, 2], [-12, 0, 0], DARK).box([.8, 18, 2], [12, 0, 0], DARK).geometry();
  const portGeometry = new Parts().box([110, 3, 30], [0, 6.5, 0], '#8a7a58').box([18, 3, 80], [-42, 6.5, 28], '#8a7a58').box([18, 3, 80], [42, 6.5, 28], '#8a7a58')
    .box([104, .2, .5], [0, 8.1, -6], SEAM).box([104, .2, .5], [0, 8.1, 6], SEAM)
    .shed([30, 14, 35], [-30, 8, -42], '#9a917c', '#7c4f3d', 7).shed([30, 14, 35], [15, 8, -42], '#9a917c', '#5c7a8c', 7)
    .box([7, 5, 7], [-48, 10.5, 30], '#7a6a48').box([7, 5, 7], [-39, 10.5, 36], '#6c7350').box([8, 4, 12], [44, 10, 40], '#7a6a48')
    .cyl(1.8, 50, [65, 33, 0], DARK, 1.2).box([52, 2.4, 2.4], [44, 56, 0], '#c9a03c').box([5, 5, 5], [65, 58, 0], GUN).geometry();
  const poleGeometry = new THREE.CylinderGeometry(.9, .9, 34, 6);
  const lit = (geometry, material) => new THREE.Mesh(geometry, material);
  // A static caster inside `root`: its shadow is fixed once the root is placed.
  const cast = (root, geometry, plane) => { const shadow = createShadow(geometry); shadow.userData.plane = plane; root.add(shadow); return shadow; };
  const settle = root => { root.updateMatrixWorld(true); for (const node of root.children) if (node.userData.plane != null) projectShadow(node, (node.userData.caster || root).matrixWorld, node.userData.plane); };
  return {
    ships, zones, airfields, bombs,
    update(game) {
      wakeMaterial.uniforms.time.value = game.time;
      const liveShips = new Set([...game.ships, ...(game.convoys || [])].filter(s => s.active !== false && !(s.hp <= 0 && s.sinking > CONFIG.ship.sinkingSeconds)));
      for (const [s, visual] of ships) if (!liveShips.has(s)) { scene.remove(visual.root, visual.wake); ships.delete(s); }
      for (const s of liveShips) {
        if (!ships.has(s)) {
          const root = templates[s.kind === 'transport' ? 'transport' : s.team === 'jp' ? (s.kind === 'carrier' ? 'enemyCarrier' : 'enemyDestroyer') : s.kind].clone(true);
          root.name = s.kind === 'transport' ? 'SupplyTransport' : s.kind === 'carrier' ? (s.team === 'jp' ? 'EnemyCarrier' : 'FriendlyCarrier') : 'PatrolDestroyer';
          const wake = new THREE.Mesh(wakeGeometry, wakeMaterial); wake.renderOrder = 2;
          const shadow = createShadow(casters.get(root.getObjectByName('Body').geometry));
          root.add(shadow);
          const onDeck = deckCasters.get(root.getObjectByName('Body').geometry), deckShadow = onDeck && createShadow(onDeck);
          if (deckShadow) root.add(deckShadow);
          ships.set(s, { root, wake, shadow, deckShadow, turrets: root.children.filter(node => node.name === 'Turret') }); scene.add(root, wake);
        }
        const v = ships.get(s), sink = s.hp <= 0 ? s.sinking / CONFIG.ship.sinkingSeconds : 0;
        v.root.visible = shipObserved(game, s);
        v.root.position.set(s.x, -sink * 28, s.y);
        v.root.rotation.set(0, -s.a - Math.PI / 2, sink * .35);
        for (const turret of v.turrets) turret.rotation.y = -(s.gunAngle ?? s.a) + s.a;
        v.root.updateMatrixWorld(true);
        projectShadow(v.shadow, v.root.matrixWorld, .35);
        if (v.deckShadow) { projectShadow(v.deckShadow, v.root.matrixWorld, s.kind === 'carrier' ? 11.5 : 10.6); v.deckShadow.visible = sink === 0; }
        v.shadow.visible = sink < .3;
        // The wake quad starts a little ahead of the bow and trails well astern.
        const W = CONFIG.render.wake;
        v.wake.visible = v.root.visible && s.hp > 0 && (s.fleet ? s.fleet.moving : s.team === 'jp' || s.kind === 'transport');
        const back = s.length * (W.length / 2 - W.lead - .5);
        v.wake.position.set(s.x - Math.cos(s.a) * back, .25, s.y - Math.sin(s.a) * back);
        v.wake.rotation.y = v.root.rotation.y;
        v.wake.scale.set(s.width * W.width, 1, s.length * W.length);
      }
      const liveFields = new Set(game.airfields || []);
      for (const [field, visual] of airfields) if (!liveFields.has(field)) { scene.remove(visual.root); airfields.delete(field); }
      for (const field of liveFields) {
        if (!airfields.has(field)) {
          const root = new THREE.Group(); root.name = 'Airfield-' + field.id;
          root.add(new THREE.Mesh(runwayGeometry, paint));
          cast(root, tallGeometry, G + 1.3);
          const hangars = [];
          for (const z of [-65, 0, 65]) {
            const hangar = lit(hangarGeometry, paint);
            hangar.position.set(width / 2 + 58, G + .6, z);
            hangars.push(hangar); root.add(hangar);
            cast(root, hangarGeometry, G + 1.3).userData.caster = hangar;
          }
          const beacon = new THREE.Mesh(beaconGeometry, friend);
          beacon.position.set(-width / 2 - 8, G + 1.5, -length / 2 + 10); root.add(beacon);
          airfields.set(field, { root, hangars, beacon, placed: null }); scene.add(root);
        }
        const v = airfields.get(field);
        v.root.visible = field.owner === 'us' || observedAt(game, field);
        v.root.position.set(field.x, 0, field.y);
        v.root.rotation.y = -field.a - Math.PI / 2;
        v.beacon.material = field.owner === 'us' ? friend : hostile;
        const intact = Math.ceil(3 * Math.max(0, field.hp) / field.maxHp);
        v.hangars.forEach((hangar, i) => { hangar.geometry = i < intact ? hangarGeometry : rubbleGeometry; });
        const placed = `${field.x},${field.y},${field.a},${intact}`;
        if (v.placed !== placed) {
          v.placed = placed; settle(v.root);
          v.root.children.forEach(node => { if (node.userData.caster) node.geometry = node.userData.caster.geometry; });
        }
      }
      const liveBombs = new Set(game.bombs || []);
      for (const [bomb, visual] of bombs) if (!liveBombs.has(bomb)) { scene.remove(visual.root); bombs.delete(bomb); }
      for (const bomb of liveBombs) {
        if (!bombs.has(bomb)) {
          const root = new THREE.Group(); root.name = 'FallingBomb';
          const body = new THREE.Mesh(bombGeometry, dark); body.scale.z = 2; root.add(body);
          const marker = new THREE.Mesh(bombRing, friend); marker.position.y = 10; root.add(marker);
          bombs.set(bomb, { root, body, marker }); scene.add(root);
        }
        const v = bombs.get(bomb), remaining = Math.max(0, Math.min(1, bomb.life / (bomb.maxLife || 1)));
        v.root.position.set(bomb.x, 0, bomb.y);
        v.body.position.y = 10 + CONFIG.render.flightHeight * remaining;
        v.marker.position.set((bomb.vx || 0) * Math.max(0, bomb.life), G + 2, (bomb.vy || 0) * Math.max(0, bomb.life));
        v.marker.scale.setScalar(.4 + remaining * .6);
      }
      const liveZones = new Set(game.territories);
      for (const [t, visual] of zones) if (!liveZones.has(t)) { scene.remove(visual.group); zones.delete(t); }
      for (const t of liveZones) {
        if (!zones.has(t)) {
          const group = new THREE.Group(); group.position.set(t.x, 0, t.y);
          const ring = new THREE.Mesh(ringGeometry, hostile); ring.position.y = G + 1; group.add(ring);
          const pole = lit(poleGeometry, cabin); pole.position.set(-100, G + 17, 0); group.add(pole);
          cast(group, poleGeometry, G + .5).userData.caster = pole;
          const flag = new THREE.Mesh(flagGeometry, hostile); flag.position.set(-88, G + 28, 0); group.add(flag);
          let dish = null;
          if (t.role === 'radar') {
            group.add(lit(radarGeometry, paint)); cast(group, radarGeometry, G + .5);
            dish = lit(dishGeometry, paint); dish.name = 'RadarDish'; dish.position.set(70, G + 60, 0); group.add(dish);
          } else if (t.role === 'port') {
            // Pier points into water at the shared physical coastline.
            const coast = t.portShore, port = lit(portGeometry, paint);
            port.position.set(coast?.x || 0, 0, coast?.y || 0);
            port.rotation.y = Math.PI / 2 - (coast?.a || 0);
            group.add(port);
            cast(group, portGeometry, 4).userData.caster = port;
          }
          settle(group);
          group.name = 'Territory-' + t.name; zones.set(t, { group, ring, flag, dish }); scene.add(group);
        }
        const v = zones.get(t);
        v.group.visible = installationKnown(game, t) && (t.owner === 'us' || observedAt(game, t));
        const mat = t.owner === 'us' ? friend : hostile;
        v.ring.material = mat; v.flag.material = mat;
        v.ring.visible = t.owner !== 'us';
        if (v.dish) v.dish.rotation.y = game.time * .5;
      }
    },
  };
}
