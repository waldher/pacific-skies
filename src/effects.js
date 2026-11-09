// Tracers and particles: two draws, however much is in the air.
//
// Particles are point sprites shaded in the fragment stage: fire is a hot
// core that cools from white through orange, smoke a lit puff with a ragged
// edge, shock rings and splashes thin bright bands. Everything is drawn with
// premultiplied alpha, so one material can both add light (fire, tracers)
// and cover what is behind it (smoke). Buffers grow only when needed.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { noiseTexture, NOISE_GLSL } from './noise.js';

const KIND = { fire: 0, smoke: 1, ring: 2, splash: 3 };
const PREMULTIPLIED = { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor };
const MAX = 400;

export function createEffects(scene, renderer) {
  // Tracer: a quad along the round's path with a white-hot core, a coloured
  // glow and a fading tail. Torpedoes reuse it as a pale bubble track.
  const tracerMaterial = new THREE.ShaderMaterial({
    ...PREMULTIPLIED,
    vertexShader: `attribute vec4 tint; varying vec4 vTint; varying vec2 vUv;
      void main() { vTint = tint; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec4 vTint; varying vec2 vUv;
      void main() {
        float across = abs(vUv.y * 2.0 - 1.0), along = vUv.x;            // along: 0 tail, 1 head
        float body = smoothstep(0.0, .55, along) * (1.0 - smoothstep(.9, 1.0, along));
        float glow = (1.0 - across) * (1.0 - across) * body, core = (1.0 - smoothstep(.1, .34, across)) * smoothstep(.5, .85, along);
        if (vTint.a < .5) {                                               // torpedo: opaque foam, no light
          float a = (1.0 - smoothstep(.3, 1.0, across)) * smoothstep(0.0, .6, along) * .7;
          gl_FragColor = vec4(vTint.rgb * a, a);
        } else gl_FragColor = vec4(vTint.rgb * (glow * 1.1 + core * .7) + vec3(1.0, .95, .8) * core * .35, glow * .3);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const tracerGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  let tracers, tints, capacity = 0;
  const dummy = new THREE.Object3D();
  const ally = [1, .78, .3, 1], enemy = [1, .32, .22, 1], torpedo = [.8, .92, .94, 0];

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(MAX * 3), sizes = new Float32Array(MAX), data = new Float32Array(MAX * 3);
  for (const [name, array, size] of [['position', positions, 3], ['size', sizes, 1], ['data', data, 3]]) {
    geometry.setAttribute(name, new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
  }
  const [sx, , sz] = CONFIG.render.sunOffset, sunLength = Math.hypot(sx, sz) || 1;
  const material = new THREE.ShaderMaterial({
    ...PREMULTIPLIED,
    uniforms: { dpr: { value: 1 }, noiseTex: { value: noiseTexture() }, sun: { value: new THREE.Vector2(sx / sunLength, sz / sunLength) } },
    vertexShader: `attribute float size; attribute vec3 data; varying vec3 vData; uniform float dpr;
      void main() {
        vData = data;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * dpr;
      }`,
    fragmentShader: `varying vec3 vData; uniform vec2 sun;   // data: kind, life remaining 0..1, seed
      ${NOISE_GLSL}
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r = length(c), kind = vData.x, t = vData.y;
        if (r > 1.0) discard;
        vec4 o;
        if (kind < .5) {
          // Fire: gaussian core, hottest in the middle and when new.
          float heat = exp(-r * r * 3.0) * (.25 + t * .85);
          vec3 flame = mix(vec3(.75, .12, .02), vec3(1.0, .55, .12), smoothstep(.15, .5, heat));
          flame = mix(flame, vec3(1.0, .9, .62), smoothstep(.6, 1.0, heat));
          o = vec4(flame * heat * 1.4, heat * .3);
        } else if (kind < 1.5) {
          // Smoke: a ragged puff, lit from the sun side, thinning as it ages.
          float n = vnoise(c * .9 + vData.z * 37.0);
          float a = (1.0 - smoothstep(.3 + n * .35, .7 + n * .3, r)) * min(1.0, t * 1.6) * .55;
          float lit = .5 + .5 * dot(c, -sun) * .8;
          vec3 smoke = mix(vec3(.07, .07, .08), vec3(.34, .32, .31), lit * (1.0 - t * .5));
          o = vec4(smoke * a, a);
        } else if (kind < 2.5) {
          // Shock ring with a flash inside while it is young.
          float band = (1.0 - smoothstep(.0, .12, abs(r - .86))) * t;
          float flash = exp(-r * r * 2.2) * smoothstep(.35, 1.0, t);
          o = vec4(vec3(1.0, .9, .7) * (band * .55 + flash * 1.6), band * .2 + flash * .3);
        } else {
          // Splash: a ring of spray and a brief white boil.
          float a = ((1.0 - smoothstep(.0, .2, abs(r - .7))) * .8 + exp(-r * r * 6.0) * t) * t;
          o = vec4(vec3(.9, .97, 1.0) * a, a * .8);
        }
        gl_FragColor = o;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const particles = new THREE.Points(geometry, material);
  particles.frustumCulled = false; particles.renderOrder = 8;
  scene.add(particles);
  return {
    update(game) {
      const count = game.bullets.length + game.ebullets.length + game.torpedoes.length;
      if (count > capacity) {
        if (tracers) { scene.remove(tracers); tracers.dispose(); }
        capacity = Math.max(64, 2 ** Math.ceil(Math.log2(count)));
        tracers = new THREE.InstancedMesh(tracerGeometry, tracerMaterial, capacity);
        tints = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
        tracers.geometry = tracerGeometry.clone(); tracers.geometry.setAttribute('tint', tints);
        tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        tracers.frustumCulled = false; tracers.renderOrder = 7;
        scene.add(tracers);
      }
      if (tracers) {
        let i = 0;
        const T = CONFIG.render.tracer;
        for (const [bullets, tint] of [[game.bullets, ally], [game.ebullets, enemy], [game.torpedoes, torpedo]]) {
          for (const b of bullets) {
            const running = b.distance !== undefined, length = running ? 46 : Math.hypot(b.vx, b.vy) * T.seconds;
            const heading = Math.atan2(b.vy, b.vx), back = length / 2 - (running ? 6 : 3);
            dummy.position.set(b.x - Math.cos(heading) * back, running ? 1.2 : CONFIG.render.flightHeight - 1, b.y - Math.sin(heading) * back);
            dummy.rotation.set(0, -heading, 0);
            dummy.scale.set(length, 1, running ? 7 : T.width);
            dummy.updateMatrix();
            tracers.setMatrixAt(i, dummy.matrix); tints.set(tint, i++ * 4);
          }
        }
        tracers.count = count;
        tracers.instanceMatrix.needsUpdate = true; tints.needsUpdate = true;
      }
      const n = Math.min(MAX, game.particles.length), high = CONFIG.render.flightHeight + 8;
      for (let i = 0; i < n; i++) {
        const p = game.particles[i], t = Math.max(0, Math.min(1, p.life / p.max)), kind = KIND[p.kind] ?? 0;
        positions[i * 3] = p.x; positions[i * 3 + 1] = kind === 3 ? 1.5 : p.low ? 14 : high; positions[i * 3 + 2] = p.y;
        // Sprites fade out toward their rim, so each is drawn larger than the old hard discs.
        sizes[i] = p.size * (kind === 3 ? 4.4 - 2 * t : kind === 2 ? 3.6 - 2 * t : kind === 1 ? 4.6 - 2 * t : 1.5 + 1.9 * t);
        data[i * 3] = kind; data[i * 3 + 1] = t; data[i * 3 + 2] = (p.size * 7.31 + i * .137) % 1;
      }
      geometry.setDrawRange(0, n);
      for (const attribute of Object.values(geometry.attributes)) attribute.needsUpdate = true;
      material.uniforms.dpr.value = renderer.getPixelRatio();
    },
  };
}
