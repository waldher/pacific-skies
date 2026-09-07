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
    // Models are built in metres (tools/build-aircraft.mjs); scale each to the
    // shared 48-unit wingspan so hitboxes and aiming still agree.
    const span = new THREE.Box3().setFromObject(template);
    template.scale.setScalar(CONFIG.render.aircraftWingspan / (span.max.x - span.min.x));
    templates[kind] = template;
    const oldGeometries = new Set();
    scene.traverse(node => { if (node.isMesh) oldGeometries.add(node.geometry); });
    oldGeometries.forEach(geometry => geometry.dispose());
  }));
  return templates;
}

// Each aircraft carries its own small shadow receiver under it, so the
// shadow map is only sampled over a few thousand pixels rather than the
// whole screen. When shadows are off (lowest quality) the same quad draws
// a soft dark blob instead, keeping the altitude cue.
const receiverGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const shadowMaterial = new THREE.ShadowMaterial({ opacity: .24, depthWrite: false });
const blobMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  vertexShader: `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `varying vec2 vUv;
    void main() {
      float d = length((vUv - .5) * vec2(2.3, 3.4));
      gl_FragColor = vec4(0.0, 0.0, 0.0, .22 * (1.0 - smoothstep(.35, 1.0, d)));
    }`,
});
const RECEIVER_SIZE = 140, BLOB_SIZE = 64;
// Where a point at flight height casts its shadow, from the shared sun offset.
const [sunX, sunY, sunZ] = CONFIG.render.sunOffset;
const shadowShift = [-sunX * CONFIG.render.flightHeight / sunY, -sunZ * CONFIG.render.flightHeight / sunY];

export function setShadowMode(visual, shadows) {
  visual.shadow.material = shadows ? shadowMaterial : blobMaterial;
  visual.shadow.receiveShadow = shadows;
  const size = shadows ? RECEIVER_SIZE : BLOB_SIZE;
  visual.shadow.scale.set(size, 1, size);
}

export function createAircraft(template, entity, shadows = true) {
  const root = new THREE.Group();
  const model = template.clone(true);
  root.add(model);
  const shadow = new THREE.Mesh(receiverGeometry, shadowMaterial);
  shadow.position.y = .1;
  const visual = { root, model, shadow, propeller: model.getObjectByName('Propeller'), heading: entity.a, bank: 0 };
  setShadowMode(visual, shadows);
  return visual;
}

export function updateAircraft(visual, entity, dt, turnRate, flash = false) {
  const R = CONFIG.render;
  const rate = dt > 0 ? angDiff(visual.heading, entity.a) / dt : 0;
  const target = entity.flight && entity.flight !== 'flying' ? 0 : -clamp(rate / turnRate, -1, 1) * R.bankAngle;
  visual.bank += (target - visual.bank) * (1 - Math.exp(-R.bankResponse * dt));
  visual.heading = entity.a;
  visual.root.position.set(entity.x, entity.altitude ?? R.flightHeight, entity.y);
  visual.root.rotation.y = -entity.a - Math.PI / 2;
  visual.shadow.position.set(entity.x + shadowShift[0], .1, entity.y + shadowShift[1]);
  visual.shadow.rotation.y = visual.root.rotation.y;
  visual.shadow.visible = entity.flight !== 'landed';
  visual.model.rotation.z = visual.bank;
  visual.propeller.rotation.z = (visual.propeller.rotation.z + dt * R.propellerSpeed * (entity.flight === 'landed' ? .12 : 1)) % (Math.PI * 2);
  // Only the single player uses the US template; enemy materials stay shared.
  if (visual.flash !== flash) {
    visual.model.traverse(node => {
      if (node.isMesh) node.material.emissive.setHex(flash ? 0xffffff : 0x000000);
    });
    visual.flash = flash;
  }
}
