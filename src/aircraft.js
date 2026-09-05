// Load real GLB meshes once; share geometry/materials across enemy instances.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';
import { angDiff, clamp } from './util.js';

function batchMeshes(source, relativeTo) {
  const groups = new Map();
  const inverse = new THREE.Matrix4().copy(relativeTo.matrixWorld).invert();
  source.traverse(node => {
    if (!node.isMesh) return;
    const geometry = node.geometry.clone();
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld));
    const key = node.material.uuid;
    if (!groups.has(key)) groups.set(key, { material: node.material, geometries: [] });
    groups.get(key).geometries.push(geometry);
  });
  const result = new THREE.Group();
  for (const { material, geometries } of groups.values()) {
    const merged = mergeGeometries(geometries);
    if (!merged) throw new Error('Aircraft geometry could not be combined.');
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    result.add(mesh);
    geometries.forEach(geometry => geometry.dispose());
  }
  return result;
}

export async function loadAircraft() {
  const loader = new GLTFLoader();
  const templates = {};
  await Promise.all([['us', 'F4U_Corsair'], ['jp', 'Mitsubishi_Zero']].map(async ([kind, name]) => {
    const { scene } = await loader.loadAsync(new URL(`../assets/aircraft/${name}.glb`, import.meta.url).href);
    scene.updateMatrixWorld(true);
    const airframe = scene.getObjectByName('Airframe');
    const propeller = scene.getObjectByName('Propeller');
    if (!airframe || !propeller) throw new Error(`${name} is missing its airframe or propeller.`);
    const template = new THREE.Group();
    template.name = name;
    template.add(batchMeshes(airframe, scene));
    const prop = batchMeshes(propeller, propeller);
    prop.name = 'Propeller';
    prop.position.copy(propeller.position);
    template.add(prop);
    // Preserve the original ~48px wingspan so hitboxes and aiming still agree.
    template.scale.setScalar(CONFIG.render.aircraftWingspan / (kind === 'us' ? 12.5 : 11));
    templates[kind] = template;
    const oldGeometries = new Set();
    scene.traverse(node => { if (node.isMesh) oldGeometries.add(node.geometry); });
    oldGeometries.forEach(geometry => geometry.dispose());
  }));
  return templates;
}

export function createAircraft(template, entity) {
  const root = new THREE.Group();
  const model = template.clone(true);
  root.add(model);
  return { root, model, propeller: model.getObjectByName('Propeller'), heading: entity.a, bank: 0 };
}

export function updateAircraft(visual, entity, dt, turnRate, flash = false) {
  const R = CONFIG.render;
  const rate = dt > 0 ? angDiff(visual.heading, entity.a) / dt : 0;
  const target = -clamp(rate / turnRate, -1, 1) * R.bankAngle;
  visual.bank += (target - visual.bank) * (1 - Math.exp(-R.bankResponse * dt));
  visual.heading = entity.a;
  visual.root.position.set(entity.x, R.flightHeight, entity.y);
  visual.root.rotation.y = -entity.a - Math.PI / 2;
  visual.model.rotation.z = visual.bank;
  visual.propeller.rotation.z = (visual.propeller.rotation.z + dt * R.propellerSpeed) % (Math.PI * 2);
  // Only the single player uses the US template; enemy materials stay shared.
  if (visual.flash !== flash) {
    visual.model.traverse(node => {
      if (node.isMesh) node.material.emissive.setHex(flash ? 0xffffff : 0x000000);
    });
    visual.flash = flash;
  }
}
