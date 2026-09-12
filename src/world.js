// Camera-local ocean plus deterministic, bounded chunks of island scenery.
//
// The ocean is one screen-sized plane; everything that makes it look like
// water happens in its fragment shader from the shared noise texture, so the
// cost is a fixed handful of texture taps per pixel:
//   ripples   three ridged octaves drifting with the wind
//   lighting  the wave slope from the noise gradient, lit by the sun
//   glitter   a tight specular lobe masked by fast high-frequency noise
//   whitecaps crests gated by a noise stretched along the wind
//   clouds    a low-frequency layer darkening the sea as it drifts
// Shallows are geometry (a fading skirt around each shoreline in land.js),
// not a per-pixel island loop. The `detail` uniform drops glitter, whitecaps,
// the finest octave and the clouds on slow devices (see CONFIG.render.quality).
// Tuning lives in CONFIG.render.ocean; islands are built by land.js.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { noiseTexture, NOISE_GLSL } from './noise.js';
import { createLand } from './land.js';
import { createTraffic } from './traffic.js';

const WORLD_VERTEX = `varying vec2 worldXZ;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    worldXZ = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

export function createWorld(scene) {
  const O = CONFIG.render.ocean;
  // Uniform objects shared by the ocean, surf and every island's ground, so
  // one update moves the clouds over sea and land together.
  const shared = {
    time: { value: 0 },
    wind: { value: new THREE.Vector2(...O.wind) },
    sunDir: { value: new THREE.Vector3(...CONFIG.render.sunOffset).normalize() },
    cloudSpeed: { value: O.cloudSpeed }, cloudStrength: { value: O.cloudStrength },
  };
  const oceanMaterial = new THREE.ShaderMaterial({
    uniforms: {
      noiseTex: { value: noiseTexture() }, time: shared.time, detail: { value: 2 },
      wind: shared.wind, sunDir: shared.sunDir, cloudSpeed: shared.cloudSpeed, cloudStrength: shared.cloudStrength,
      glitter: { value: O.glitter }, foam: { value: O.foam },
      deepColor: { value: new THREE.Color(O.deep) }, midColor: { value: new THREE.Color(O.mid) },
    },
    vertexShader: WORLD_VERTEX,
    fragmentShader: `varying vec2 worldXZ;
      uniform float time, detail, cloudSpeed, cloudStrength, glitter, foam;
      uniform vec2 wind; uniform vec3 sunDir, deepColor, midColor;
      ${NOISE_GLSL}
      // Ridged noise with its gradient, so the wave normal is analytic; .w is the
      // second noise field from the same tap, free for masks.
      vec4 ridge(vec2 p) { vec4 s = vnoise4(p); float v = s.r * 2.0 - 1.0; return vec4(1.0 - abs(v), -sign(v) * (s.gb - .5) * 6.0, s.a); }
      const mat2 R1 = mat2(.866, .5, -.5, .866), R2 = mat2(.5, .866, -.866, .5); // 30° and 60°
      const mat2 R1T = mat2(.866, -.5, .5, .866), R2T = mat2(.5, -.866, .866, .5);
      void main() {
        vec2 p = worldXZ, drift = wind * time;
        // Ripples: three ridged octaves, each rotated so the noise grid never lines up.
        vec4 o1 = ridge((p + drift) * .011);
        vec4 o2 = ridge(R1 * (p - drift * .7) * .026);
        float h1 = o1.x, h = h1 * .55 + o2.x * .45, twinkle = o2.w;
        vec2 g = o1.yz * (.55 * .011) + (R1T * o2.yz) * (.45 * .026);
        if (detail > .5) {
          vec4 o3 = ridge(R2 * (p + drift * 1.6) * .058);
          twinkle = o3.w;
          h = h1 * .45 + o2.x * .33 + o3.x * .22;
          g = o1.yz * (.45 * .011) + (R1T * o2.yz) * (.33 * .026) + (R2T * o3.yz) * (.22 * .058);
        }
        vec3 water = mix(deepColor, midColor, .15 + h * .7);
        // Lit waves and sun glitter from the wave slope.
        vec3 n = normalize(vec3(-g.x * 10.0, 1.0, -g.y * 10.0));
        water *= .82 + .3 * max(dot(n, sunDir), 0.0);
        if (detail > 1.5) {
          vec3 halfway = normalize(sunDir + vec3(0.0, 1.0, 0.0));
          // Sparkle mask rides the finest octave's spare channel: no extra tap.
          float sparkle = smoothstep(.88, .99, twinkle) * (.55 + .45 * sin(time * 5.0 + twinkle * 40.0));
          water += glitter * pow(max(dot(n, halfway), 0.0), 400.0) * sparkle * vec3(1.0, .96, .85);
          // Whitecaps: sparse flecks stretched along the wind, clustered on the big swell crests (h1).
          vec2 w = normalize(wind), along = vec2(dot(p, w), dot(p, vec2(-w.y, w.x)));
          float fleck = vnoise2(along * vec2(.045, .16) + vec2(-time * .3, 13.0));
          water = mix(water, vec3(.9, .95, .97), foam * smoothstep(.9, .96, fleck) * smoothstep(.7, .95, h1));
        }
        if (detail > .5) {
          // Cloud shadows drifting over everything.
          float cloud = vnoise((p + drift * cloudSpeed) * .0011);
          water *= 1.0 - smoothstep(.5, .78, cloud) * cloudStrength;
        }
        gl_FragColor = vec4(water, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), oceanMaterial);
  ocean.rotation.x = -Math.PI / 2;
  scene.add(ocean);

  // Surf: a foam ring hugging each shoreline, pulsing and broken up by noise.
  const surfMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { noiseTex: { value: noiseTexture() }, time: shared.time, strength: { value: O.surf } },
    vertexShader: WORLD_VERTEX,
    fragmentShader: `varying vec2 worldXZ; uniform float time, strength;
      ${NOISE_GLSL}
      void main() {
        float breakup = vnoise(worldXZ * .05 + time * .3);
        float pulse = .55 + .45 * sin(time * 1.4 + breakup * 6.0);
        gl_FragColor = vec4(.93, .97, 1.0, strength * pulse * smoothstep(.25, .7, breakup));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const land = createLand(scene, { ...shared, surfMaterial });
  const traffic = createTraffic(scene);
  const chunks = new Map();
  return {
    setDetail(level) { oceanMaterial.uniforms.detail.value = level; },
    update(game, view, dt, pixelRatio) {
      const cam = game.cam, territories = game.terrain || game.territories || [];
      ocean.position.set(cam.x, 0, cam.y);
      ocean.scale.set(view.W + 1000, view.H + 1000, 1);
      shared.time.value = game.time;
      const needed = new Set();
      for (const territory of territories) {
        const margin = (territory.extent ?? territory.radius) * 1.4 + 150;
        if (Math.abs(territory.x - cam.x) > view.W / 2 + margin ||
            Math.abs(territory.y - cam.y) > view.H / 2 + margin) continue;
        needed.add(territory);
        if (!chunks.has(territory)) {
          // Older saves lack terrainId; fall back to whichever holdings sit on this landmass.
          const holdings = territory.role ? [territory]
            : (game.territories || []).filter(h => h.terrainId != null ? h.terrainId === territory.id
              : Math.hypot(h.x - territory.x, h.y - territory.y) < (territory.extent ?? territory.radius));
          const group = land.build(territory, { sectors: game.sectors, holdings, geographySeed: game.geographySeed ?? 0 });
          chunks.set(territory, group); scene.add(group);
        }
      }
      for (const [key, group] of chunks) {
        if (needed.has(key)) continue;
        scene.remove(group);
        land.dispose(group);
        chunks.delete(key);
      }
      traffic.update(dt, chunks.values(), game.time);
    },
    get chunkCount() { return chunks.size; },
    get chunks() { return chunks; },
    traffic,
  };
}
