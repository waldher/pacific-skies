// One affine camera for every world surface. Ground coordinates and distances
// are unchanged; elevation reveals side faces without foreshortening controls.
export const OBLIQUE = Object.freeze({ x: .35, up: .85, cameraHeight: 1000 });

export function applyObliqueProjection(camera) {
  // Rebuild first, so resize/quality changes never accumulate shear.
  camera.updateProjectionMatrix();
  const e = camera.projectionMatrix.elements;
  // The vertical camera's view Z is world height minus cameraHeight.
  e[8] = e[0] * OBLIQUE.x;
  e[9] = e[5] * OBLIQUE.up;
  e[12] += e[8] * OBLIQUE.cameraHeight;
  e[13] += e[9] * OBLIQUE.cameraHeight;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

export function projectWorld(x, y, height, cam, view) {
  return [x - cam.x + view.W / 2 + OBLIQUE.x * height,
    y - cam.y + view.H / 2 - OBLIQUE.up * height];
}

// Visual root height includes model clearance; keep it out of simulation state.
const visualHeights = new WeakMap();
export function recordVisualHeight(entity, height) { visualHeights.set(entity, height); }
export function visualHeight(entity, fallback) { return visualHeights.get(entity) ?? entity.altitude ?? fallback; }

// Existing model builders retain this API, but all projection now happens in
// the camera, including custom shaders and instanced meshes. No double shear.
export function withRelief(material) { return material; }
