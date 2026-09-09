// Render the same GLB templates used in flight once, using the game's context.
import * as THREE from 'three';
export const aircraftPreviews = {};

export function renderAircraftPreviews(renderer, templates) {
  const width = 256, height = 160;
  const target = new THREE.WebGLRenderTarget(width, height);
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const previousTarget = renderer.getRenderTarget();
  const color = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
  const viewport = renderer.getViewport(new THREE.Vector4());
  const scissor = renderer.getScissor(new THREE.Vector4()), scissorTest = renderer.getScissorTest();
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#d6ecff', '#5c6670', 2.4));
  const sun = new THREE.DirectionalLight('#fff0d9', 3);
  sun.position.set(-40, 70, -30); scene.add(sun);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 500);
  const pixels = new Uint8Array(width * height * 4);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  try {
    renderer.setRenderTarget(target); renderer.setScissorTest(false); renderer.setClearColor(0, 0);
    for (const [id, template] of Object.entries(templates)) {
      if (id === 'us' || id === 'jp') continue;
      const model = template.clone(true); scene.add(model);
      const bounds = new THREE.Box3().setFromObject(model);
      const center = bounds.getCenter(new THREE.Vector3());
      camera.position.copy(center).add(new THREE.Vector3(50, 65, -80));
      camera.lookAt(center); camera.updateMatrixWorld(true);
      // Fit the actual projected geometry, rather than an oversized rotated box.
      const projected = new THREE.Box3(), vertex = new THREE.Vector3();
      model.traverse(node => {
        if (!node.isMesh) return;
        const positions = node.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          vertex.fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
          projected.expandByPoint(vertex);
        }
      });
      const halfHeight = Math.max((projected.max.y - projected.min.y) / 2, (projected.max.x - projected.min.x) / 2 * height / width) * 1.1;
      const cx = (projected.max.x + projected.min.x) / 2, cy = (projected.max.y + projected.min.y) / 2;
      camera.left = cx - halfHeight * width / height; camera.right = cx + halfHeight * width / height;
      camera.top = cy + halfHeight; camera.bottom = cy - halfHeight; camera.updateProjectionMatrix();
      renderer.clear(); renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
      for (let y = 0; y < height; y++) image.data.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), (height - y - 1) * width * 4);
      context.putImageData(image, 0, 0); aircraftPreviews[id] = canvas.toDataURL('image/png');
      scene.remove(model);
    }
  } finally {
    renderer.setRenderTarget(previousTarget); renderer.setClearColor(color, alpha);
    renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
    target.dispose();
  }
}
