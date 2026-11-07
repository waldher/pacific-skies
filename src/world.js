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

// Display bake contract: exposure 1, ACESFilmicToneMapping, sRGB output and
// the fixed ocean tint below. Re-bake/revalidate if the renderer changes them.
// Exported pure helpers also support CPU error checks without a WebGL context.
export function oceanDisplayRGB(linear, shadow = 0) {
  const c=linear.map((v,i)=>(v*(1-shadow)*1.10+[.003,.010,.012][i])/.6);
  const v=[.59719*c[0]+.35458*c[1]+.04823*c[2],.076*c[0]+.90834*c[1]+.01566*c[2],.0284*c[0]+.13383*c[1]+.83777*c[2]];
  const f=v.map(n=>(n*(n+.0245786)-.000090537)/(n*(.983729*n+.432951)+.238081));
  return [1.60475*f[0]-.53108*f[1]-.07367*f[2],-.10208*f[0]+1.10813*f[1]-.00605*f[2],-.00327*f[0]-.07276*f[1]+1.07602*f[2]].map(n=>{
    n=Math.max(0,Math.min(1,n));return n<=.0031308?n*12.92:Math.pow(n,.41666)*1.055-.055;
  });
}
export function bakeOceanDisplay(rgba) {
  const pixels=new Uint8Array(rgba.length), table=new Float64Array(256);
  for(let i=0;i<256;i++) {
    const v=i/255, linear=v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);
    // Preserve the incumbent's .125-range RGBA8 quantization exactly.
    table[i]=Math.min(255,Math.round(linear/.125*255))/255*.125;
  }
  for(let i=0;i<rgba.length;i+=4) {
    const display=oceanDisplayRGB([table[rgba[i]],table[rgba[i+1]],table[rgba[i+2]]]);
    pixels[i]=Math.round(display[0]*255);pixels[i+1]=Math.round(display[1]*255);pixels[i+2]=Math.round(display[2]*255);pixels[i+3]=255;
  }
  return pixels;
}

let oceanTexture = null, oceanReady;
export function preloadOceanMaterial() {
  if (oceanReady) return oceanReady;
  oceanReady = new Promise(resolve => {
    let done = false;
    const timeout = setTimeout(() => { done = true; resolve(false); }, 2500);
    new THREE.TextureLoader().load(new URL('../assets/ocean/ocean-fine-256.webp', import.meta.url).href, texture => {
      if (done) { texture.dispose(); return; }
      done = true; clearTimeout(timeout);
      // Bake display-referred RGB once; avoid fullscreen ACES and gamma math.
      try {
        const size = 256, canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(texture.image, 0, 0, size, size);
        const rgba = ctx.getImageData(0, 0, size, size).data;
        const display = bakeOceanDisplay(rgba);
        texture.dispose();
        const prepared = new THREE.DataTexture(display,size,size,THREE.RGBAFormat,THREE.UnsignedByteType);
        prepared.wrapS = prepared.wrapT = THREE.MirroredRepeatWrapping;
        prepared.colorSpace = THREE.NoColorSpace; // already display-encoded; never sRGB-decode
        prepared.minFilter = THREE.LinearMipmapLinearFilter;
        prepared.magFilter = THREE.LinearFilter;
        prepared.generateMipmaps = true; prepared.flipY = true; prepared.needsUpdate = true;
        oceanTexture = prepared; resolve(true);
      } catch { texture.dispose(); resolve(false); }
    }, undefined, () => { if (!done) { done = true; clearTimeout(timeout); resolve(false); } });
  });
  return oceanReady;
}

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
      noiseTex: { value: noiseTexture() }, oceanTex: { value: oceanTexture }, materialReady: { value: oceanTexture ? 1 : 0 }, time: shared.time, detail: { value: 2 },
      wind: shared.wind, sunDir: shared.sunDir, cloudSpeed: shared.cloudSpeed, cloudStrength: shared.cloudStrength,
      glitter: { value: O.glitter }, foam: { value: O.foam },
      deepColor: { value: new THREE.Color(O.deep) }, midColor: { value: new THREE.Color(O.mid) },
    },
    vertexShader: WORLD_VERTEX,
    fragmentShader: `varying vec2 worldXZ;
      uniform float time, detail, cloudSpeed, cloudStrength, glitter, foam, materialReady;
      uniform sampler2D oceanTex;
      uniform vec2 wind; uniform vec3 sunDir, deepColor, midColor;
      ${NOISE_GLSL}
      // Ridged noise with its gradient, so the wave normal is analytic; .w is the
      // second noise field from the same tap, free for masks.
      vec4 ridge(vec2 p) { vec4 s = vnoise4(p); float v = s.r * 2.0 - 1.0; return vec4(1.0 - abs(v), -sign(v) * (s.gb - .5) * 6.0, s.a); }
      void main() {
        vec2 p = worldXZ, drift = wind * time;
        if (materialReady > .5) {
          // One natural wave-material tap at every tier; native adds cloud
          // shade. Keep full-screen sampling cheaper than the old noise stack.
          vec3 surface = texture2D(oceanTex, p / 640.0 + drift * .00012).rgb;
          if (detail > .5) {
            float cloud = vnoise((p + drift * cloudSpeed) * .0011);
            // Darken the display-encoded material without shifting its hue.
            // This is an artistic response, not a fit to linear-light shading.
            float shade=smoothstep(.5,.78,cloud)*cloudStrength;
            surface *= 1.0 - .68 * shade;
          }
          // Already ACES/sRGB encoded. The procedural fallback below retains
          // both normal conversion chunks and works without the loaded asset.
          gl_FragColor = vec4(surface, 1.0);
          return;
        }
        // A shared wind basis gives long coherent swell crests. Subordinate
        // ripples follow the same sea state instead of crossing like netting.
        vec2 w = normalize(wind), crosswind = vec2(-w.y,w.x);
        vec2 q = vec2(dot(p-drift,w),dot(p-drift,crosswind));
        vec4 o1 = ridge(q * vec2(.022,.005));
        vec4 o2 = ridge((q + vec2(time*3.0,17.0)) * vec2(.065,.013));
        float h1 = o1.x, h = h1 * .68 + o2.x * .32, twinkle = o2.w;
        vec2 slope = o1.yz * (.68*vec2(.022,.005)) + o2.yz * (.32*vec2(.065,.013));
        if (detail > .5) {
          vec4 o3 = ridge((q - vec2(time*5.0,23.0)) * vec2(.12,.035));
          twinkle = o3.w;
          h = h1 * .62 + o2.x * .28 + o3.x * .10;
          slope = o1.yz * (.62*vec2(.022,.005)) + o2.yz * (.28*vec2(.065,.013)) + o3.yz * (.10*vec2(.12,.035));
        }
        vec2 g = w*slope.x + crosswind*slope.y;
        // Restrained directional wavelets leave silhouettes and impacts dominant.
        vec3 water = mix(deepColor, midColor, .38 + h * .20);
        water *= .96 + .09 * smoothstep(.62, .94, h);
        // Lit waves and sun glitter from the wave slope.
        vec3 n = normalize(vec3(-g.x * 2.8, 1.0, -g.y * 2.8));
        water *= .82 + .3 * max(dot(n, sunDir), 0.0);
        if (detail > 1.5) {
          vec3 halfway = normalize(sunDir + vec3(0.0, 1.0, 0.0));
          // Sparkle mask rides the finest octave's spare channel: no extra tap.
          float sparkle = smoothstep(.88, .99, twinkle) * (.55 + .45 * sin(time * 5.0 + twinkle * 40.0));
          water += glitter * pow(max(dot(n, halfway), 0.0), 400.0) * sparkle * vec3(1.0, .96, .85);
          // Tiny isolated white chips read as debris at phone scale. Foam is
          // instead a quiet broken line only at the leading swell crest; the
          // breakup uses the existing fifth tap, not another noise octave.
          float fleck = vnoise2(q * vec2(.04,.026) + vec2(0.0,13.0));
          float crest = smoothstep(.91,.985,h1) * smoothstep(.79,.96,fleck);
          water = mix(water,vec3(.42,.64,.65),foam*.35*crest);
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
        // Monotonic cross-shore coordinate: one advancing breaker, rather
        // than mirrored crests on both sides of a triangular fade band.
        float breakup = vnoise(worldXZ * .021);
        float phase = fract(time * .16 + breakup * .38);
        float front = -.12 + 1.34 * phase;
        float grain = vnoise2(worldXZ * .09 + vec2(time*.035,-time*.02));
        float edge = vFade + (grain-.5)*.22;
        float crest = smoothstep(front-.26,front-.04,edge)
                    * (1.0-smoothstep(front+.015,front+.12,edge));
        float wash = smoothstep(front-.48,front-.19,edge)
                   * (1.0-smoothstep(front-.17,front-.025,edge));
        float foam = smoothstep(.25,.65,grain);
        float reaches = smoothstep(.27,.56,breakup);
        float lifetime = smoothstep(0.0,.13,phase) * (1.0-smoothstep(.76,1.0,phase));
        float alpha = strength * (crest*.72 + wash*.17) * foam * reaches * lifetime;
        gl_FragColor = vec4(.82, .94, .92, alpha);
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
      if (epoch !== generation) throw Object.assign(Error('Terrain preparation superseded by a new world'), { name: 'AbortError' });
      if (inFlight) await inFlight;
      syncLand(game,view);
    }
  }
  return {
    get oceanMaterialInfo() { return { loaded: !!oceanTexture, width: oceanTexture?.image?.width || 0, type: oceanTexture?.type || null, mode: oceanTexture ? 'display-prebake-aces-srgb-exposure1' : 'procedural-linear-fallback' }; },
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
    get oceanMaterialMode() { return oceanTexture ? 'display-prebake-aces-srgb-exposure1' : 'procedural-linear-fallback'; },
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
