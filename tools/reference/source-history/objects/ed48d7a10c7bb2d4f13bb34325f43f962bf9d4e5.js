// Batched 3D tracers and particles. Buffers grow only when needed, not per frame.
import * as THREE from 'three';
import { CONFIG } from './config.js';

export function createEffects(scene, renderer) {
  const tracerMaterial = new THREE.MeshBasicMaterial({ color: 'white' });
  const tracerGeometry = new THREE.BoxGeometry(1, 1, 1);
  let tracers, capacity = 0;
  const dummy = new THREE.Object3D();
  const ally = new THREE.Color('#ffe28a'), enemy = new THREE.Color('#ff7b6b');
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(400 * 3);
  const sizes = new Float32Array(400);
  const colors = new Float32Array(400 * 4);
  const rings = new Float32Array(400);
  for (const [name, array, size] of [['position', positions, 3], ['size', sizes, 1], ['color', colors, 4], ['ring', rings, 1]]) {
    geometry.setAttribute(name, new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
  }
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { dpr: { value: 1 } },
    vertexShader: `attribute float size; attribute vec4 color; attribute float ring;
      varying vec4 tint; varying float isRing; uniform float dpr;
      void main() {
        tint = color; isRing = ring;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * dpr;
      }`,
    fragmentShader: `varying vec4 tint; varying float isRing;
      void main() {
        float r = length(gl_PointCoord - .5) * 2.0;
        float alpha = 1.0 - smoothstep(.82, 1.0, r);
        if (isRing > .5) alpha *= smoothstep(.65, .8, r);
        if (alpha < .01) discard;
        gl_FragColor = vec4(tint.rgb, tint.a * alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const particles = new THREE.Points(geometry, material);
  particles.frustumCulled = false;
  scene.add(particles);
  return {
    update(game) {
      const count = game.bullets.length + game.ebullets.length + game.torpedoes.length;
      if (count > capacity) {
        if (tracers) { scene.remove(tracers); tracers.dispose(); }
        capacity = Math.max(64, 2 ** Math.ceil(Math.log2(count)));
        tracers = new THREE.InstancedMesh(tracerGeometry, tracerMaterial, capacity);
        tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        tracers.frustumCulled = false;
        scene.add(tracers);
      }
      if (tracers) {
        let i = 0;
        for (const [bullets, color] of [[game.bullets, ally], [game.ebullets, enemy], [game.torpedoes, ally]]) {
          for (const b of bullets) {
            dummy.position.set(b.x - b.vx * .008, b.distance !== undefined ? 2 : CONFIG.render.flightHeight - 1, b.y - b.vy * .008);
            dummy.rotation.set(0, -Math.atan2(b.vy, b.vx), 0);
            dummy.scale.set(b.distance !== undefined ? 24 : Math.hypot(b.vx, b.vy) * .016, 1, b.distance !== undefined ? 4 : 2.5);
            dummy.updateMatrix();
            tracers.setMatrixAt(i, dummy.matrix); tracers.setColorAt(i++, color);
          }
        }
        tracers.count = count;
        tracers.instanceMatrix.needsUpdate = true;
        if (tracers.instanceColor) tracers.instanceColor.needsUpdate = true;
      }
      const n = Math.min(400, game.particles.length);
      for (let i = 0; i < n; i++) {
        const p = game.particles[i], t = p.life / p.max;
        const splash = p.kind === 'splash';
        positions.set([p.x, splash ? 1.5 : CONFIG.render.flightHeight + 8, p.y], i * 3);
        rings[i] = p.kind === 'ring' || splash ? 1 : 0;
        sizes[i] = 2 * p.size * (splash ? 1.8 - t : p.kind === 'ring' ? 1.6 - t : p.kind === 'smoke' ? 2 - t : t + .4);
        if (p.kind === 'smoke') colors.set([.20, .20, .23, t * .7], i * 4);
        else if (splash) colors.set([.85, .95, 1, t * .8], i * 4);
        else colors.set([1, .3 + t * .45, .08, t], i * 4);
      }
      geometry.setDrawRange(0, n);
      for (const attribute of Object.values(geometry.attributes)) attribute.needsUpdate = true;
      material.uniforms.dpr.value = renderer.getPixelRatio();
    },
  };
}
