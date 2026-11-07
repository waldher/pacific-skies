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

const pilotMarkerExtents = new WeakMap();
export function recordPilotMarkerExtents(entity, matrix, min, max, origin) {
  const e = matrix.elements;
  let extents = pilotMarkerExtents.get(entity);
  if (!extents) {
    extents = {};
    pilotMarkerExtents.set(entity, extents);
  }
  // Project the local bounds to screen axes relative to the aircraft root.
  // Affine extrema occur at a corner chosen by the sign of each axis slope.
  const x = e[0] + OBLIQUE.x * e[1];
  const y = e[4] + OBLIQUE.x * e[5];
  const z = e[8] + OBLIQUE.x * e[9];
  const offsetX = e[12] - origin.x + OBLIQUE.x * (e[13] - origin.y);
  extents.left = offsetX + x * (x < 0 ? max.x : min.x)
    + y * (y < 0 ? max.y : min.y) + z * (z < 0 ? max.z : min.z);
  extents.right = offsetX + x * (x < 0 ? min.x : max.x)
    + y * (y < 0 ? min.y : max.y) + z * (z < 0 ? min.z : max.z);
  extents.centerY = e[14] - origin.z - OBLIQUE.up * (e[13] - origin.y)
    + ((e[2] - OBLIQUE.up * e[1]) * (min.x + max.x)
      + (e[6] - OBLIQUE.up * e[5]) * (min.y + max.y)
      + (e[10] - OBLIQUE.up * e[9]) * (min.z + max.z)) / 2;
}
export function pilotMarkerBounds(entity) { return pilotMarkerExtents.get(entity); }

// Existing model builders retain this API, but all projection now happens in
// the camera, including custom shaders and instanced meshes. No double shear.
export function withRelief(material) { return material; }
