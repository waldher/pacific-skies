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
    // Paint differs only in colour: bake it into vertices and batch identical
    // shading properties together. Preserve PBR response and all markings.
    const m = node.material, descriptor = m.toJSON();
    delete descriptor.uuid; delete descriptor.name; delete descriptor.color;
    const key = JSON.stringify(descriptor);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    const existing = geometry.getAttribute('color');
    for (let i = 0; i < colors.length / 3; i++) {
      colors[i*3] = m.color.r * (existing ? existing.getX(i) : 1);
      colors[i*3+1] = m.color.g * (existing ? existing.getY(i) : 1);
      colors[i*3+2] = m.color.b * (existing ? existing.getZ(i) : 1);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (!groups.has(key)) {
      const material = m.clone(); material.color.set(0xffffff); material.vertexColors = true;
      groups.set(key, { material, geometries: [] });
    }
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

// Bake each model's real top-down silhouette once. A soft alpha texture gives
// low-tier aircraft recognizable grounding at the same one-quad/one-tap cost.
function bakeSilhouette(template) {
  const size = 128, extent = 64;
  const mask = document.createElement('canvas'); mask.width = mask.height = size;
  const ctx = mask.getContext('2d'), point = new THREE.Vector3();
  ctx.fillStyle = '#000';
  template.updateMatrixWorld(true);
  template.traverse(node => {
    if (!node.isMesh) return;
    const positions = node.geometry.attributes.position, index = node.geometry.index;
    const count = index ? index.count : positions.count;
    for (let i=0; i<count; i+=3) {
      ctx.beginPath();
      for (let j=0; j<3; j++) {
        point.fromBufferAttribute(positions, index ? index.getX(i+j) : i+j).applyMatrix4(node.matrixWorld);
        const x = size*(.5+point.x/extent), y = size*(.5+point.z/extent);
        if (j) ctx.lineTo(x,y); else ctx.moveTo(x,y);
      }
      ctx.closePath(); ctx.fill();
    }
  });
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const blur = canvas.getContext('2d'); blur.filter = 'blur(2px)'; blur.drawImage(mask,0,0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return new THREE.MeshBasicMaterial({map:texture,color:0x000000,transparent:true,opacity:.26,depthWrite:false,toneMapped:false});
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
    template.add(batchMeshes(airframe, scene));
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
    template.silhouetteMaterial = bakeSilhouette(template);
    templates[kind] = template;
    const oldGeometries = new Set();
    scene.traverse(node => { if (node.isMesh) oldGeometries.add(node.geometry); });
    oldGeometries.forEach(geometry => geometry.dispose());
  }));
  templates.us = templates.corsair;
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
  visual.shadow.material = shadows ? shadowMaterial : visual.silhouette;
  visual.shadow.receiveShadow = shadows;
  const size = shadows ? RECEIVER_SIZE : BLOB_SIZE;
  visual.shadow.scale.set(size, 1, size);
}

export function createAircraft(template, entity, shadows = true, selected = false) {
  const root = new THREE.Group();
  const model = template.clone(true);
  const ownedMaterials = [];
  if (template.name !== 'Mitsubishi_Zero') {
    const copies = new Map();
    model.traverse(node => {
      if (!node.isMesh) return;
      if (!copies.has(node.material)) { const copy = node.material.clone(); copies.set(node.material, copy); ownedMaterials.push(copy); }
      node.material = copies.get(node.material);
    });
  }
  root.add(model);
  // Altitude marks the surface under the aircraft, not its fuselage center.
  const clearance = Math.max(0, -new THREE.Box3().setFromObject(model).min.y) + .5;
  if (selected && template.silhouetteMaterial) {
    // A restrained silhouette edge distinguishes the pilot in crowded fights.
    // Unlike a selection ring it follows the actual airframe and stays beneath it.
    const edgeMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: {mask:{value:template.silhouetteMaterial.map}},
      vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader:`varying vec2 vUv;uniform sampler2D mask;void main(){gl_FragColor=vec4(.85,.92,.79,texture2D(mask,vUv).a*.38);}`,
    });
    const edge = new THREE.Mesh(receiverGeometry, edgeMaterial);
    edge.scale.set(68,1,68); edge.position.y=-clearance+.1;
    root.add(edge); ownedMaterials.push(edgeMaterial);
  }
  const shadow = new THREE.Mesh(receiverGeometry, shadowMaterial);
  shadow.position.y = .1;
  const visual = { root, model, clearance, shadow, silhouette: template.silhouetteMaterial || blobMaterial, ownedMaterials, propeller: model.getObjectByName('Propeller'), propellers: model.children.filter(node => node.name.startsWith('Propeller')), heading: entity.a, bank: 0 };
  setShadowMode(visual, shadows);
  return visual;
}

export function updateAircraft(visual, entity, dt, turnRate, flash = false) {
  const R = CONFIG.render;
  const rate = dt > 0 ? angDiff(visual.heading, entity.a) / dt : 0;
  const target = entity.flight && entity.flight !== 'flying' ? 0 : -clamp(rate / turnRate, -1, 1) * R.bankAngle;
  visual.bank += (target - visual.bank) * (1 - Math.exp(-R.bankResponse * dt));
  if (entity.flight && entity.flight !== 'flying') visual.bank = 0;
  visual.heading = entity.a;
  visual.root.position.set(entity.x, (entity.altitude ?? R.flightHeight) + visual.clearance, entity.y);
  visual.root.rotation.y = -entity.a - Math.PI / 2;
  visual.shadow.position.set(entity.x + shadowShift[0], .1, entity.y + shadowShift[1]);
  visual.shadow.rotation.y = visual.root.rotation.y;
  visual.shadow.visible = entity.flight !== 'landed';
  visual.model.rotation.z = visual.bank;
  visual.propellers.forEach((prop, i) => {
    prop.rotation.z = (prop.rotation.z + (i ? -1 : 1) * dt * R.propellerSpeed * (entity.flight === 'landed' ? .12 : 1)) % (Math.PI * 2);
  });
  // Friendly aircraft own their flash materials; enemy materials stay shared.
  if (visual.flash !== flash) {
    visual.model.traverse(node => {
      if (node.isMesh) node.material.emissive.setHex(flash ? 0xffffff : 0x000000);
    });
    visual.flash = flash;
  }
}
