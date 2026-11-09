// Camera-local ocean plus deterministic, bounded chunks of island scenery.
//
// The ocean is one screen-sized plane; everything that makes it look like
// water happens in its fragment shader from the shared noise texture, so the
// cost is a fixed handful of texture taps per pixel:
//   swell     two noise layers stretched across the wind, marching downwind
//   chop      a finer cross sea on top
//   lighting  the wave slope from the noise gradient: sunlit faces, sky sheen
//   glitter   a specular lobe masked by the spare noise channel
//   whitecaps the tallest crests break into short streaks
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
      deepColor: { value: new THREE.Color(O.deep) }, midColor: { value: new THREE.Color(O.mid) }, skyColor: { value: new THREE.Color(O.sky) },
    },
    vertexShader: WORLD_VERTEX,
    fragmentShader: `varying vec2 worldXZ;
      uniform float time, detail, cloudSpeed, cloudStrength, glitter, foam;
      uniform vec2 wind; uniform vec3 sunDir, deepColor, midColor, skyColor;
      ${NOISE_GLSL}
      const mat2 R1 = mat2(.940, .342, -.342, .940), R1T = mat2(.940, -.342, .342, .940);   // 20°
      const mat2 R2 = mat2(.766, -.643, .643, .766), R2T = mat2(.766, .643, -.643, .766);   // -40°
      // Swell: noise stretched across the wind, so crests are long lines that
      // march downwind. xy is the height gradient per world unit, .z the height,
      // .w the spare noise field from the same tap.
      vec4 swell(vec2 q, vec2 freq, float speed) {
        vec4 s = vnoise4(q * freq - vec2(time * speed, 0.0));
        return vec4((s.gb - .5) * 3.0 * freq, s.r, s.a);
      }
      void main() {
        vec2 p = worldXZ, w = normalize(wind);
        mat2 toWind = mat2(w.x, -w.y, w.y, w.x), fromWind = mat2(w.x, w.y, -w.y, w.x);
        vec2 q = toWind * p;
        vec4 a = swell(q, vec2(.046, .019), .22);
        vec4 b = swell(R1 * q + 31.0, vec2(.098, .047), .42);
        float h = a.z * .6 + b.z * .4, sparkle = b.w;
        vec2 g = a.xy * .6 + (R1T * b.xy) * .4;
        if (detail > .5) {
          // Chop: a fine cross sea that roughens the swell faces.
          vec4 c = swell(R2 * q + 77.0, vec2(.21, .12), .7);
          h = a.z * .5 + b.z * .3 + c.z * .2; sparkle = c.w;
          g = a.xy * .5 + (R1T * b.xy) * .3 + (R2T * c.xy) * .2;
        }
        g = fromWind * g;
        vec3 n = normalize(vec3(-g.x * 9.0, 1.0, -g.y * 9.0));
        // Slow tonal patches (currents, depth) and the drifting cloud shadows
        // share one low-frequency tap.
        vec4 broad = vnoise4((p + wind * time * cloudSpeed) * .0011);
        vec3 water = mix(deepColor, midColor, .25 + .5 * broad.a + (h - .5) * .5);
        // Sunlit wave faces brighten, faces turned away sink toward the deep colour.
        float lit = dot(n, sunDir) - sunDir.y;
        water *= 1.0 + lit * 1.15;
        water += skyColor * smoothstep(.0, .12, 1.0 - n.y) * .22;
        if (detail > 1.5) {
          vec3 halfway = normalize(sunDir + vec3(0.0, 1.0, 0.0));
          float spec = pow(max(dot(n, halfway), 0.0), 900.0);
          water += glitter * spec * smoothstep(.55, .8, sparkle) * vec3(1.0, .96, .86);
          // Whitecaps: only the tallest crests break, as short streaks along them.
          float crest = smoothstep(.82, .9, b.z) * smoothstep(.74, .86, a.z) * smoothstep(.5, .62, sparkle);
          water = mix(water, vec3(.84, .92, .94), foam * crest);
        }
        if (detail > .5) water *= 1.0 - smoothstep(.5, .78, broad.r) * cloudStrength;
        gl_FragColor = vec4(water, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), oceanMaterial);
  ocean.rotation.x = -Math.PI / 2;
  scene.add(ocean);

  // Surf: a foam band on each waterline (geometry in land.js), pulsing and broken up by noise.
  const surfMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
    uniforms: { noiseTex: { value: noiseTexture() }, time: shared.time, strength: { value: O.surf } },
    vertexShader: `attribute float fade; varying float vFade; varying vec2 worldXZ;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        worldXZ = world.xz; vFade = fade;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `varying vec2 worldXZ; varying float vFade; uniform float time, strength;
      ${NOISE_GLSL}
      void main() {
        float breakup = vnoise(worldXZ * .05 + time * .3);
        float pulse = .55 + .45 * sin(time * 1.4 + breakup * 6.0);
        gl_FragColor = vec4(.93, .97, 1.0, strength * pulse * vFade * smoothstep(.25, .7, breakup));
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
