// Load real GLB meshes once; share geometry/materials across enemy instances.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';
import { angDiff, clamp } from './util.js';
import { onHull, onLand } from './surface.js';
import { createShadow, projectShadow, shadowOffset, casters } from './shadow.js';

// One vertex-coloured Lambert mesh per part: a whole airframe is a single
// draw however many paint colours the GLB uses (a Corsair has twelve).
const paint = new THREE.MeshLambertMaterial({ vertexColors: true });
function batchMeshes(source, relativeTo) {
  const geometries = [];
  const inverse = new THREE.Matrix4().copy(relativeTo.matrixWorld).invert();
  source.traverse(node => {
    if (!node.isMesh) return;
    const geometry = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
    for (const name of Object.keys(geometry.attributes)) if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld));
    const { r, g, b } = node.material.color, colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = r; colors[i + 1] = g; colors[i + 2] = b; }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometries.push(geometry);
  });
  const merged = mergeGeometries(geometries);
  if (!merged) throw new Error('Aircraft geometry could not be combined.');
  geometries.forEach(geometry => geometry.dispose());
  return new THREE.Mesh(merged, paint);
}

// The airframe's plan-view silhouette as a few dozen flat strips: a shadow
// caster two orders of magnitude lighter than the mesh, and still exact
// enough that a P-38's twin booms cast two shadows.
function silhouette(geometry, rows = 56) {
  const p = geometry.attributes.position, box = new THREE.Box3().setFromBufferAttribute(p);
  const step = (box.max.z - box.min.z) / rows, spans = Array.from({ length: rows }, () => []);
  for (let i = 0; i < p.count; i += 3) {
    const t = [0, 1, 2].map(k => [p.getX(i + k), p.getZ(i + k)]);
    const z0 = Math.min(t[0][1], t[1][1], t[2][1]), z1 = Math.max(t[0][1], t[1][1], t[2][1]);
    for (let r = Math.max(0, Math.floor((z0 - box.min.z) / step)); r < rows && box.min.z + r * step < z1; r++) {
      const z = box.min.z + (r + .5) * step; let lo = Infinity, hi = -Infinity;
      for (let e = 0; e < 3; e++) {
        const [ax, az] = t[e], [bx, bz] = t[(e + 1) % 3];
        if ((az > z) === (bz > z)) continue;
        const x = ax + (bx - ax) * (z - az) / (bz - az); lo = Math.min(lo, x); hi = Math.max(hi, x);
      }
      if (hi > lo) spans[r].push([lo, hi]);
    }
  }
  const quads = [];
  spans.forEach((row, r) => {
    row.sort((a, b) => a[0] - b[0]);
    let run = null;
    const flush = () => { if (run) { const z = box.min.z + r * step; quads.push(run[0], 0, z, run[1], 0, z + step, run[1], 0, z, run[0], 0, z, run[0], 0, z + step, run[1], 0, z + step); } };
    for (const span of row) { if (run && span[0] <= run[1] + step * .5) run[1] = Math.max(run[1], span[1]); else { flush(); run = [...span]; } }
    flush();
  });
  const flat = new THREE.BufferGeometry();
  flat.setAttribute('position', new THREE.BufferAttribute(new Float32Array(quads), 3));
  return flat;
}

export async function loadAircraft() {
  const loader = new GLTFLoader();
  const templates = {};
  await Promise.all([['corsair', 'F4U_Corsair'], ['p38', 'P38_Lightning'], ['dauntless', 'SBD_Dauntless'], ['avenger', 'TBF_Avenger'], ['p51', 'P51_Mustang'], ['jp', 'Mitsubishi_Zero']].map(async ([kind, name]) => {
    const { scene } = await loader.loadAsync(new URL(`../assets/aircraft/${name}.glb`, import.meta.url).href);
    scene.updateMatrixWorld(true);
    const airframe = scene.getObjectByName('Airframe');
    const propellers = scene.children.flatMap(root => root.children).filter(node => node.name.startsWith('Propeller'));
    const propeller = propellers[0];
    if (!airframe || !propeller) throw new Error(`${name} is missing its airframe or propeller.`);
    const template = new THREE.Group();
    template.name = name;
    const body = batchMeshes(airframe, scene);
    body.name = 'Body'; casters.set(body.geometry, silhouette(body.geometry));
    template.add(body);
    for (const source of propellers) {
      const prop = batchMeshes(source, source);
      prop.name = source.name;
      prop.position.copy(source.position);
      template.add(prop);
    }
    // Models are built in metres (tools/build-aircraft.mjs); scale each to the
    // shared 48-unit wingspan so hitboxes and aiming still agree.
    const span = new THREE.Box3().setFromObject(template);
    template.scale.setScalar(CONFIG.render.aircraftWingspan / (span.max.x - span.min.x));
    templates[kind] = template;
    const oldGeometries = new Set();
    scene.traverse(node => { if (node.isMesh) oldGeometries.add(node.geometry); });
    oldGeometries.forEach(geometry => geometry.dispose());
  }));
  templates.us = templates.corsair;
  return templates;
}

// Shadows are the airframe's silhouette, flattened along the sun onto the
// surface below (see shadow.js): it turns and banks with the aircraft, on
// every quality level, for one small draw.
const overShip = (game, x, y) => [...game.ships, ...(game.convoys || [])].find(s => s.hp > 0 && s.active !== false && onHull({ x, y }, s));

export function createAircraft(template, entity) {
  const root = new THREE.Group();
  const model = template.clone(true);
  const ownedMaterials = [];
  // Friendly aircraft flash when hit, so each owns its paint; enemies share one.
  if (template.name !== 'Mitsubishi_Zero') {
    const own = paint.clone(); ownedMaterials.push(own);
    model.traverse(node => { if (node.isMesh) node.material = own; });
  }
  root.add(model);
  // Altitude marks the surface under the aircraft, not its fuselage center.
  const clearance = Math.max(0, -new THREE.Box3().setFromObject(model).min.y) + .5;
  const body = model.getObjectByName('Body');
  const shadow = createShadow(casters.get(body.geometry));
  return { root, model, body, clearance, shadow, ownedMaterials, propeller: model.getObjectByName('Propeller'), propellers: model.children.filter(node => node.name.startsWith('Propeller')), heading: entity.a, bank: 0 };
}

export function updateAircraft(visual, entity, dt, turnRate, flash, game) {
  const R = CONFIG.render;
  const rate = dt > 0 ? angDiff(visual.heading, entity.a) / dt : 0;
  const target = entity.flight && entity.flight !== 'flying' ? 0 : -clamp(rate / turnRate, -1, 1) * R.bankAngle;
  visual.bank += (target - visual.bank) * (1 - Math.exp(-R.bankResponse * dt));
  if (entity.flight && entity.flight !== 'flying') visual.bank = 0;
  visual.heading = entity.a;
  const altitude = entity.altitude ?? R.flightHeight;
  visual.root.position.set(entity.x, altitude + visual.clearance, entity.y);
  visual.root.rotation.y = -entity.a - Math.PI / 2;
  visual.model.rotation.z = visual.bank;
  visual.propellers.forEach((prop, i) => {
    prop.rotation.z = (prop.rotation.z + (i ? -1 : 1) * dt * R.propellerSpeed * (entity.flight === 'landed' ? .12 : 1)) % (Math.PI * 2);
  });
  // The shadow lands on whatever is under it: a deck, the island, or the sea.
  const [sx, sy] = shadowOffset(altitude), gx = entity.x + sx, gy = entity.y + sy;
  const ship = overShip(game, gx, gy);
  const surface = ship ? (ship.kind === 'carrier' ? CONFIG.carrier.deckHeight : 11) : onLand({ x: gx, y: gy }, game.terrain || game.territories || []) ? R.groundHeight + 1.4 : 0;
  visual.root.updateMatrixWorld(true);
  projectShadow(visual.shadow, visual.body.matrixWorld, Math.min(surface + .4, altitude));
  visual.shadow.visible = altitude > surface + 1.5;
  // Friendly aircraft own their flash materials; enemy materials stay shared.
  flash = !!flash;
  if (visual.flash !== flash && visual.ownedMaterials.length) {
    visual.ownedMaterials[0].emissive.setHex(flash ? 0xffffff : 0x000000);
    visual.flash = flash;
  }
}
