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
import { createLand, hasTerrainMaterial } from './land.js';
import { createLandWorker } from './land-worker-client.js';
import { createTraffic } from './traffic.js';
import { DetachedLandCache, estimateLandBytes, LAND_CACHE_BYTES, LAND_BUILD_RESERVE_BYTES } from './world-cache.js';

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
        vec4 o1 = ridge((p + drift) * vec2(.018, .055));
        vec4 o2 = ridge(R1 * (p - drift * .7) * vec2(.024, .075));
        float h1 = o1.x, h = h1 * .55 + o2.x * .45, twinkle = o2.w;
        vec2 g = o1.yz * (.55 * vec2(.018, .055)) + R1T * (o2.yz * (.45 * vec2(.024, .075)));
        if (detail > .5) {
          vec4 o3 = ridge(R2 * (p + drift * 1.6) * .058);
          twinkle = o3.w;
          h = h1 * .45 + o2.x * .33 + o3.x * .22;
          g = o1.yz * (.45 * vec2(.018, .055)) + R1T * (o2.yz * (.33 * vec2(.024, .075))) + (R2T * o3.yz) * (.22 * .058);
        }
        // Restrained directional wavelets leave silhouettes and impacts dominant.
        vec3 water = mix(deepColor, midColor, .38 + h * .20);
        water *= .97 + .08 * smoothstep(.72, .96, h);
        // Lit waves and sun glitter from the wave slope.
        vec3 n = normalize(vec3(-g.x * 2.8, 1.0, -g.y * 2.8));
        water *= .82 + .3 * max(dot(n, sunDir), 0.0);
        if (detail > 1.5) {
          vec3 halfway = normalize(sunDir + vec3(0.0, 1.0, 0.0));
          // Sparkle mask rides the finest octave's spare channel: no extra tap.
          float sparkle = smoothstep(.88, .99, twinkle) * (.55 + .45 * sin(time * 5.0 + twinkle * 40.0));
          water += glitter * pow(max(dot(n, halfway), 0.0), 400.0) * sparkle * vec3(1.0, .96, .85);
          // Whitecaps: sparse flecks stretched along the wind, clustered on the big swell crests (h1).
          vec2 w = normalize(wind), along = vec2(dot(p, w), dot(p, vec2(-w.y, w.x)));
          float fleck = vnoise2(along * vec2(.045, .16) + vec2(-time * .3, 13.0));
          water = mix(water, vec3(.9, .95, .97), foam * smoothstep(.84, .98, fleck) * smoothstep(.75, .98, h1));
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

  // Surf: a foam band on each waterline (geometry in land.js), pulsing and broken up by noise.
  const surfMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
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
  const cache = new DetachedLandCache(group => land.dispose(group));
  const worker = createLandWorker(hasTerrainMaterial());
  let terrainIdentity = null, geographySeed = null, generation = 0, coldBuilds = 0, staleResults = 0;
  let currentGame = null, currentView = null, needed = new Set(), desired = new Set(), queue = [], inFlight = null;
  let previousCamera = null, velocity = { x:0, y:0 }, hydrateMs = 0;
  const territoriesOf = game => game.terrain || game.territories;
  function selected(game, view, cam = game.cam, extra = 0) {
    return (territoriesOf(game) || []).filter(t => {
      // Include elevated silhouette displacement beyond the physical shore.
      const margin = (t.extent ?? t.radius) + 200 + extra;
      return Math.abs(t.x - cam.x) <= view.W / 2 + margin && Math.abs(t.y - cam.y) <= view.H / 2 + margin;
    });
  }
  function contextFor(game, territory) {
    const holdings = territory.role ? [territory]
      : (game.territories || []).filter(h => h.terrainId != null ? h.terrainId === territory.id
        : Math.hypot(h.x - territory.x, h.y - territory.y) < (territory.extent ?? territory.radius));
    return { sectors:game.sectors, holdings, geographySeed:game.geographySeed ?? 0 };
  }
  function install(territory, group) {
    if (needed.has(territory)) { chunks.set(territory,group); scene.add(group); }
    else cache.put(territory,group);
  }
  function pump() {
    if (inFlight || !queue.length || worker.stats.mode === 'initializing') return;
    const territory = queue.shift(), epoch = generation, game = currentGame;
    cache.reserveBuild();
    if (worker.stats.mode === 'sync-fallback') {
      // Explicit compatibility fallback; never silently claim this is nonblocking.
      install(territory,land.build(territory,contextFor(game,territory))); coldBuilds++;
      return;
    }
    inFlight = worker.build(territory,contextFor(game,territory)).then(payload => {
      if (epoch !== generation || !desired.has(territory)) { payload.bitmap.close(); staleResults++; return; }
      const start = performance.now();
      install(territory,land.hydrate(payload)); hydrateMs = performance.now()-start; coldBuilds++;
    }).catch(error => {
      worker.fallback(error);
      // Worker client records failure and terminates it; next sync/prepare
      // selects the disclosed synchronous compatibility path.
    }).finally(() => {
      inFlight = null;
      if (currentGame) syncLand(currentGame,currentView);
    });
  }
  function syncLand(game, view, dt = 0) {
    currentGame = game; currentView = view;
    const territories = territoriesOf(game);
    if (terrainIdentity !== territories || geographySeed !== (game.geographySeed ?? 0)) {
      generation++;
      for (const group of chunks.values()) { scene.remove(group); land.dispose(group); }
      chunks.clear(); cache.clear(); queue = []; previousCamera = null; velocity = {x:0,y:0};
      terrainIdentity = territories; geographySeed = game.geographySeed ?? 0;
    }
    if (dt > 0 && previousCamera) {
      // Reject teleport velocity; real flight looks ahead three seconds.
      const dx = game.cam.x-previousCamera.x, dy = game.cam.y-previousCamera.y;
      if (Math.hypot(dx,dy) < 100) velocity = {x:dx/dt,y:dy/dt};
      else velocity = {x:0,y:0};
    }
    previousCamera = {x:game.cam.x,y:game.cam.y};
    needed = new Set(selected(game,view));
    const lead = {x:game.cam.x+velocity.x*3,y:game.cam.y+velocity.y*3};
    // One predictive island at a time; queue descriptors contain no mesh data.
    const prediction = Math.hypot(velocity.x,velocity.y) > 1
      ? selected(game,view,lead,300).filter(t=>!needed.has(t)).sort((a,b)=>Math.hypot(a.x-lead.x,a.y-lead.y)-Math.hypot(b.x-lead.x,b.y-lead.y)).slice(0,1) : [];
    desired = new Set([...needed,...prediction]);
    for (const [key,group] of chunks) {
      if (needed.has(key)) continue;
      scene.remove(group); chunks.delete(key); cache.put(key,group);
    }
    for (const territory of needed) {
      if (chunks.has(territory)) continue;
      const group = cache.take(territory);
      if (group) { chunks.set(territory,group); scene.add(group); }
    }
    queue = [...desired].filter(t=>!chunks.has(t)&&!cache.entries.has(t)).slice(0,8);
    if (worker.stats.mode === 'sync-fallback') {
      // Fallback remains synchronous, but required scenery is complete on return.
      for (const territory of needed) {
        if (chunks.has(territory)) continue;
        cache.reserveBuild(); install(territory,land.build(territory,contextFor(game,territory))); coldBuilds++;
      }
      queue = [];
    } else pump();
  }
  const isReady = (game,view) => terrainIdentity === territoriesOf(game) && geographySeed === (game.geographySeed ?? 0)
    && selected(game,view).every(t=>chunks.has(t));
  async function prepare(game,view) {
    await worker.ready; syncLand(game,view);
    const epoch = generation;
    while (!isReady(game,view)) {
      if (epoch !== generation) throw Error('Terrain preparation superseded by a new world');
      if (inFlight) await inFlight;
      syncLand(game,view);
    }
  }
  return {
    setDetail(level) { oceanMaterial.uniforms.detail.value = level; },
    prepare, prewarm:prepare, isReady,
    async settle() { await worker.ready; while (inFlight) await inFlight; },
    get workerStats() { return {...worker.stats, generation, pending:queue.length, inFlight:!!inFlight, staleResults, hydrateMs}; },
    update(game, view, dt, pixelRatio) {
      const cam = game.cam;
      ocean.position.set(cam.x,0,cam.y); ocean.scale.set(view.W+1000,view.H+1000,1);
      shared.time.value = game.time;
      syncLand(game,view,dt); traffic.update(dt,chunks.values(),game.time);
    },
    get cacheStats() {
      let activeBytes = 0;
      for (const group of chunks.values()) activeBytes += estimateLandBytes(group);
      return {detachedBytes:cache.bytes,detachedCount:cache.entries.size,maxDetachedBytes:LAND_CACHE_BYTES,
        buildReserveBytes:LAND_BUILD_RESERVE_BYTES,activeBytes,estimatedResidentBytes:activeBytes+cache.bytes,
        hits:cache.hits,evictions:cache.evictions,coldBuilds};
    },
    get chunkCount() { return chunks.size; },
    get chunks() { return chunks; },
    traffic,
  };
}
