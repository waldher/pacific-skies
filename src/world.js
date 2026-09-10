// Camera-local ocean plus deterministic, bounded chunks of low-poly islands.
//
// The ocean is one screen-sized plane; everything that makes it look like
// water happens in its fragment shader from hash noise, so there are no
// textures and the cost is a fixed number of noise lookups per pixel:
//   ripples   three ridged octaves drifting with the wind
//   lighting  a fake normal from screen-space derivatives, lit by the sun
//   glitter   a tight specular lobe masked by fast high-frequency noise
//   whitecaps crests gated by a noise stretched along the wind
//   shallows  a turquoise fade around each visible island (positions are
//             uniforms; the loop is at most 12 distance checks)
//   clouds    a low-frequency layer darkening the sea as it drifts
// The `detail` uniform drops glitter, whitecaps, the finest octave and the
// clouds on slow devices (see CONFIG.render.quality). Tuning lives in
// CONFIG.render.ocean.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { islandOutline, insidePolygon } from './surface.js';
import { hash2, TAU } from './util.js';

const MAX_ISLANDS = 12;

// Narrow beaches follow concave lagoon shores instead of shrinking toward an
// arbitrary island center (which would put grass across the water).
function insetShore(points, distance) {
  const area = points.reduce((n,p,i) => { const q=points[(i+1)%points.length];return n+p[0]*q[1]-q[0]*p[1]; },0);
  const sign=area>0?1:-1;
  return points.map((p,i) => {
    const prev=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length];
    const l1=Math.hypot(p[0]-prev[0],p[1]-prev[1]),l2=Math.hypot(next[0]-p[0],next[1]-p[1]);
    const n1=[-(p[1]-prev[1])/l1*sign,(p[0]-prev[0])/l1*sign];
    const n2=[-(next[1]-p[1])/l2*sign,(next[0]-p[0])/l2*sign];
    const k=distance/Math.max(.4,1+n1[0]*n2[0]+n1[1]*n2[1]);
    const q=[p[0]+(n1[0]+n2[0])*k,p[1]+(n1[1]+n2[1])*k];
    return insidePolygon(q[0],q[1],points)?q:p;
  });
}

const NOISE = `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }`;

export function createWorld(scene) {
  const O = CONFIG.render.ocean;
  const sun = new THREE.Vector3(...CONFIG.render.sunOffset).normalize();
  const oceanMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 }, dpr: { value: 1 }, detail: { value: 2 },
      wind: { value: new THREE.Vector2(...O.wind) },
      sunDir: { value: sun },
      cloudSpeed: { value: O.cloudSpeed }, cloudStrength: { value: O.cloudStrength },
      glitter: { value: O.glitter }, foam: { value: O.foam },
      deepColor: { value: new THREE.Color(O.deep) }, midColor: { value: new THREE.Color(O.mid) },
      shallowColor: { value: new THREE.Color(O.shallows) }, shallowRadius: { value: O.shallowsRadius },
      islands: { value: new Float32Array(MAX_ISLANDS * 4) }, islandCount: { value: 0 },
    },
    vertexShader: `varying vec2 worldXZ;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        worldXZ = world.xz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `varying vec2 worldXZ;
      uniform float time, dpr, detail, cloudSpeed, cloudStrength, glitter, foam, shallowRadius;
      uniform vec2 wind; uniform vec3 sunDir, deepColor, midColor, shallowColor;
      uniform vec4 islands[${MAX_ISLANDS}]; uniform int islandCount;
      ${NOISE}
      float ridge(vec2 p) { return 1.0 - abs(vnoise(p) * 2.0 - 1.0); }
      const mat2 R1 = mat2(.866, .5, -.5, .866), R2 = mat2(.5, .866, -.866, .5); // 30° and 60°
      void main() {
        vec2 p = worldXZ, drift = wind * time;
        // Ripples: three ridged octaves, each rotated so the noise grid never lines up.
        float h1 = ridge((p + drift) * .011);
        float h2 = ridge(R1 * (p - drift * .7) * .026);
        float h = h1 * .55 + h2 * .45;
        if (detail > .5) h = h1 * .45 + h2 * .33 + ridge(R2 * (p + drift * 1.6) * .058) * .22;
        // Shallows around islands.
        float shallow = 0.0;
        for (int i = 0; i < ${MAX_ISLANDS}; i++) {
          if (i >= islandCount) break;
          shallow = max(shallow, smoothstep(shallowRadius, 1.0, distance(p, islands[i].xy) / islands[i].z));
        }
        vec3 water = mix(mix(deepColor, midColor, .15 + h * .7), shallowColor, shallow * .85);
        // Lit waves and sun glitter from a screen-space normal.
        float k = 10.0 * dpr;
        vec3 n = normalize(vec3(-dFdx(h) * k, 1.0, -dFdy(h) * k));
        water *= .82 + .3 * max(dot(n, sunDir), 0.0);
        if (detail > 1.5) {
          vec3 halfway = normalize(sunDir + vec3(0.0, 1.0, 0.0));
          float sparkle = smoothstep(.9, .99, vnoise((p + drift * 2.0) * .09 + time * .7));
          water += glitter * pow(max(dot(n, halfway), 0.0), 400.0) * sparkle * vec3(1.0, .96, .85);
          // Whitecaps: sparse flecks stretched along the wind, clustered on the big swell crests (h1).
          vec2 w = normalize(wind), along = vec2(dot(p, w), dot(p, vec2(-w.y, w.x)));
          float fleck = vnoise(along * vec2(.045, .16) + vec2(-time * .3, 0.0));
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
    uniforms: { time: { value: 0 }, strength: { value: O.surf } },
    vertexShader: `varying vec2 worldXZ;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        worldXZ = world.xz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `varying vec2 worldXZ; uniform float time, strength;
      ${NOISE}
      void main() {
        float breakup = vnoise(worldXZ * .05 + time * .3);
        float pulse = .55 + .45 * sin(time * 1.4 + breakup * 6.0);
        gl_FragColor = vec4(.93, .97, 1.0, strength * pulse * smoothstep(.25, .7, breakup));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const materials = {
    sand: new THREE.MeshStandardMaterial({ color: '#e3d49b', roughness: 1 }),
    grass: new THREE.MeshStandardMaterial({ color: '#4f8a4a', roughness: 1, flatShading: true }),
    hill: new THREE.MeshStandardMaterial({ color: '#3b6e39', roughness: 1, flatShading: true }),
  };
  const chunks = new Map();
  function island(territory) {
    const group = new THREE.Group();
    const gx = territory.seed ?? territory.id, gy = territory.id;
    group.position.set(territory.x, 0, territory.y);
    const radius = territory.radius;
    const outline = (rad, jitter, seed) => islandOutline(territory, rad, jitter, seed).map(([x, y]) => new THREE.Vector2(x, -y));
    const place = (geometry, material, base, receive) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = base;
      mesh.receiveShadow = receive;
      group.add(mesh);
    };
    const layer = (rad, jitter, seed, height, material, base) => {
      const points = material === materials.grass && territory.shoreline
        ? insetShore(islandOutline(territory), Math.min(14, radius * .12)).map(([x,y])=>new THREE.Vector2(x,-y))
        : outline(rad, jitter, seed);
      const shape = new THREE.Shape(points);
      place(new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false }), material, base, true);
    };
    const surf = new THREE.Shape(outline(radius * 1.12, .22, 2));
    surf.holes.push(new THREE.Path(outline(radius * .97, .22, 2)));
    place(new THREE.ShapeGeometry(surf), surfMaterial, .3, false);
    layer(radius, .22, 2, 3, materials.sand, .5);
    layer(territory.shoreline ? radius : radius * .86, .12, 2, 5, materials.grass, 3.5);
    for (let i = 0; i < 5; i++) {
      const a = hash2(gx + i * 13, gy + i * 7) * TAU;
      const r = (.65 + hash2(gy + i, gx + i * 3) * .1) * radius;
      const hx = Math.cos(a) * r, hy = Math.sin(a) * r * .8;
      if (!insidePolygon(hx, hy, islandOutline(territory, radius * .85))) continue;
      if (territory.holdingId != null && Math.abs(hx) < 75 && Math.abs(hy) < 240) continue;
      const hill = new THREE.Mesh(new THREE.ConeGeometry(radius * .09, 9, 7), materials.hill);
      hill.position.set(hx, 12, hy);
      hill.receiveShadow = true;
      group.add(hill);
    }
    group.userData.radius = radius;
    group.userData.extent = territory.extent ?? radius;
    return group;
  }
  return {
    setDetail(level) { oceanMaterial.uniforms.detail.value = level; },
    update(cam, view, time, pixelRatio, territories = []) {
      ocean.position.set(cam.x, 0, cam.y);
      ocean.scale.set(view.W + 1000, view.H + 1000, 1);
      oceanMaterial.uniforms.time.value = time;
      oceanMaterial.uniforms.dpr.value = pixelRatio;
      surfMaterial.uniforms.time.value = time;
      const needed = new Set();
      for (const territory of territories) {
        const margin = (territory.extent ?? territory.radius) * 1.4 + 150;
        if (Math.abs(territory.x - cam.x) > view.W / 2 + margin ||
            Math.abs(territory.y - cam.y) > view.H / 2 + margin) continue;
        needed.add(territory);
        if (!chunks.has(territory)) {
          const mesh = island(territory);
          chunks.set(territory, mesh); scene.add(mesh);
        }
      }
      for (const [key, group] of chunks) {
        if (needed.has(key)) continue;
        scene.remove(group);
        group.traverse(node => { if (node.isMesh) node.geometry.dispose(); });
        chunks.delete(key);
      }
      // Tell the ocean where the visible islands are for the shallows.
      const list = oceanMaterial.uniforms.islands.value;
      let n = 0;
      for (const group of [...chunks.values()].sort((a,b) =>
        Math.hypot(a.position.x-cam.x,a.position.z-cam.y)-Math.hypot(b.position.x-cam.x,b.position.z-cam.y))) {
        if (n >= MAX_ISLANDS) break;
        list.set([group.position.x, group.position.z, group.userData.radius, 0], n++ * 4);
      }
      oceanMaterial.uniforms.islandCount.value = n;
    },
    get chunkCount() { return chunks.size; },
  };
}
