// Camera-local ocean plus deterministic, bounded chunks of low-poly islands.
import * as THREE from 'three';
import { hash2, TAU } from './util.js';

export function createWorld(scene) {
  const oceanMaterial = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `varying vec2 worldXZ;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        worldXZ = world.xz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `varying vec2 worldXZ; uniform float time;
      void main() {
        float wave = sin(worldXZ.x * .023 + worldXZ.y * .013 + time * .7)
                   + sin(worldXZ.y * .049 - time * .5);
        float glint = pow(max(0.0, wave * .5), 12.0);
        vec3 water = mix(vec3(.025,.15,.25), vec3(.045,.24,.34), wave * .15 + .5);
        gl_FragColor = vec4(water + glint * vec3(.08,.13,.14), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), oceanMaterial);
  ocean.rotation.x = -Math.PI / 2;
  scene.add(ocean);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.ShadowMaterial({ opacity: .24, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = .1;
  shadow.receiveShadow = true;
  scene.add(shadow);
  const materials = {
    reef: new THREE.MeshBasicMaterial({ color: '#4097a5', transparent: true, opacity: .42, depthWrite: false }),
    sand: new THREE.MeshStandardMaterial({ color: '#e3d49b', roughness: 1 }),
    grass: new THREE.MeshStandardMaterial({ color: '#4f8a4a', roughness: 1, flatShading: true }),
    hill: new THREE.MeshStandardMaterial({ color: '#3b6e39', roughness: 1, flatShading: true }),
  };
  const chunks = new Map();
  function island(gx, gy, h) {
    const group = new THREE.Group();
    group.position.set(gx * 1500 + 1500 * (.25 + hash2(gx, gy * 2) * .5), 0,
      gy * 1500 + 1500 * (.25 + hash2(gx * 2, gy) * .5));
    const radius = 90 + h * 600;
    const layer = (rad, jitter, seed, height, material, base) => {
      const shape = new THREE.Shape();
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * TAU;
        const r = rad * (1 - jitter + hash2(gx * 9 + i + seed, gy * 9 + i) * jitter * 2);
        const x = Math.cos(a) * r, y = -Math.sin(a) * r * .85;
        if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
      }
      shape.closePath();
      const geometry = height ? new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false })
        : new THREE.ShapeGeometry(shape);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = base;
      mesh.receiveShadow = height > 0;
      group.add(mesh);
    };
    layer(radius * 1.25, .18, 1, 0, materials.reef, .3);
    layer(radius, .22, 2, 3, materials.sand, .5);
    layer(radius * .62, .3, 3, 5, materials.grass, 3.5);
    for (let i = 0; i < 5; i++) {
      const a = hash2(gx + i * 13, gy + i * 7) * TAU;
      const r = hash2(gy + i, gx + i * 3) * radius * .45;
      const hill = new THREE.Mesh(new THREE.ConeGeometry(radius * .09, 9, 7), materials.hill);
      hill.position.set(Math.cos(a) * r, 12, Math.sin(a) * r * .8);
      hill.receiveShadow = true;
      group.add(hill);
    }
    return group;
  }
  return {
    update(cam, view, time) {
      ocean.position.set(cam.x, 0, cam.y);
      shadow.position.set(cam.x, .1, cam.y);
      ocean.scale.set(view.W + 1000, view.H + 1000, 1);
      shadow.scale.copy(ocean.scale);
      oceanMaterial.uniforms.time.value = time;
      const needed = new Set();
      for (let gy = Math.floor((cam.y - view.H / 2 - 500) / 1500); gy <= Math.floor((cam.y + view.H / 2 + 500) / 1500); gy++) {
        for (let gx = Math.floor((cam.x - view.W / 2 - 500) / 1500); gx <= Math.floor((cam.x + view.W / 2 + 500) / 1500); gx++) {
          const h = hash2(gx * 3 + 11, gy * 7 + 5);
          if (h > .30) continue;
          const key = `${gx},${gy}`;
          needed.add(key);
          if (!chunks.has(key)) {
            const mesh = island(gx, gy, h);
            chunks.set(key, mesh); scene.add(mesh);
          }
        }
      }
      for (const [key, group] of chunks) {
        if (needed.has(key)) continue;
        scene.remove(group);
        group.traverse(node => { if (node.isMesh) node.geometry.dispose(); });
        chunks.delete(key);
      }
    },
    get chunkCount() { return chunks.size; },
  };
}
