// Planar shadows: a caster's own geometry flattened along the sun onto the
// flat surface beneath it. The world is flat ground, decks and sea, so this is
// exact, costs one small draw per caster and no shadow map, and looks the same
// on every quality level. A stencil bit keeps overlapping shadows from
// darkening twice.
import * as THREE from 'three';
import { CONFIG } from './config.js';

const [sunX, sunY, sunZ] = CONFIG.render.sunOffset;
const slopeX = -sunX / sunY, slopeZ = -sunZ / sunY;   // ground travel per unit of height

export const shadowMaterial = new THREE.MeshBasicMaterial({
  side: THREE.DoubleSide, forceSinglePass: true,   // casters are flattened, so their winding is arbitrary
  color: CONFIG.render.shadow.color, transparent: true, opacity: CONFIG.render.shadow.opacity, depthWrite: false,
  stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
});

/** Where a point at `height` above a surface casts its shadow, as a ground offset. */
export const shadowOffset = height => [slopeX * height, slopeZ * height];

const flatten = new THREE.Matrix4();
/** Matrix that drops any point onto the plane y = `plane` along the sun. */
export function shadowMatrix(plane, target = new THREE.Matrix4()) {
  return target.set(
    1, slopeX, 0, -slopeX * plane,
    0, 0, 0, plane,
    0, slopeZ, 1, -slopeZ * plane,
    0, 0, 0, 1);
}

export function createShadow(geometry) {
  const mesh = new THREE.Mesh(geometry, shadowMaterial);
  mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; mesh.renderOrder = 4;
  return mesh;
}
/** Point a shadow mesh at its caster's current world matrix. */
export function projectShadow(mesh, casterWorld, plane) {
  mesh.matrix.multiplyMatrices(shadowMatrix(plane, flatten), casterWorld);
  mesh.matrixWorldNeedsUpdate = true;
}

// Simplified shadow casters, keyed by the geometry they stand in for (clones
// of a template share its geometry, and userData would be deep-copied).
export const casters = new WeakMap();
