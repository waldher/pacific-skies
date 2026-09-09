// Three.js scene. Simulation (x,y) maps to Three (x, altitude, z).
//
// Adaptive quality: frames are timed here (the game loop's dt is capped,
// so it can't see slow frames). While frames stay slow the renderer steps
// down CONFIG.render.quality.levels: pixel ratio first, then ocean detail,
// then shadows. It steps back up only into levels that never failed, so a
// device settles rather than oscillates. ?quality=N in the URL pins a level.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { loadAircraft, createAircraft, updateAircraft, setShadowMode } from './aircraft.js';
import { createWorld } from './world.js';
import { createNavalScene } from './naval-scene.js';
import { createEffects } from './effects.js';

export async function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#155e8a');
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2000);
  camera.up.set(0, 0, -1);
  const hemisphere = new THREE.HemisphereLight('#c5e6ff', '#506273', 2.2);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight('#fff0d2', 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -.0002;
  sun.shadow.normalBias = .2;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 2200;
  scene.add(sun, sun.target);
  const world = createWorld(scene);
  const effects = createEffects(scene, renderer);
  const naval = createNavalScene(scene);
  const templates = await loadAircraft();
  const aircraft = new Map();
  let lastW = 0, lastH = 0, lastRatio = 0;
  const diagnostics = {
    ready: true, engine: 'Three.js', revision: THREE.REVISION,
    aircraft: 0, drawCalls: 0, triangles: 0, chunks: 0,
    quality: 0, pixelRatio: 1, frameMs: 0,
  };

  const Q = CONFIG.render.quality;
  const pinned = new URLSearchParams(location.search).get('quality');
  const state = {
    level: Q.start, locked: false, failed: new Set(),
    slow: 0, fast: 0, hold: 0, lastFrame: 0,
  };
  if (pinned !== null && Q.levels[Number(pinned)]) { state.level = Number(pinned); state.locked = true; }
  const level = () => Q.levels[state.level];

  function applyLevel(index) {
    state.level = index;
    const L = level();
    world.setDetail(L.ocean);
    if (renderer.shadowMap.enabled !== L.shadows) {
      renderer.shadowMap.enabled = L.shadows;
      // Shadow support is compiled into materials; make them rebuild.
      scene.traverse(node => { if (node.isMesh) node.material.needsUpdate = true; });
    }
    for (const visual of aircraft.values()) setShadowMode(visual, L.shadows);
    lastRatio = 0;
    state.hold = Q.hold; state.slow = 0; state.fast = 0;
    diagnostics.quality = index;
  }

  function adapt() {
    const now = performance.now();
    const interval = state.lastFrame ? (now - state.lastFrame) / 1000 : 0;
    state.lastFrame = now;
    if (interval <= 0 || interval > .25) return;      // first frame, or the tab was hidden
    diagnostics.frameMs = diagnostics.frameMs * .9 + interval * 100;
    if (state.locked) return;
    if (state.hold > 0) { state.hold -= interval; return; }
    if (interval > Q.slowFrame) { state.slow += interval; state.fast = 0; }
    else {
      state.slow = Math.max(0, state.slow - interval);
      if (interval < Q.fastFrame) state.fast += interval;
    }
    if (state.slow > Q.settle && state.level < Q.levels.length - 1) {
      state.failed.add(state.level);
      applyLevel(state.level + 1);
    } else if (state.fast > Q.recover && state.level > 0 && !state.failed.has(state.level - 1)) {
      applyLevel(state.level - 1);
    }
  }

  function resize(view) {
    const ratio = Math.min(view.DPR, level().pixelRatio);
    if (view.W === lastW && view.H === lastH && ratio === lastRatio) return;
    renderer.setPixelRatio(ratio);
    renderer.setSize(view.W, view.H, false);
    camera.left = -view.W / 2; camera.right = view.W / 2;
    camera.top = view.H / 2; camera.bottom = -view.H / 2;
    camera.updateProjectionMatrix();
    const range = Math.max(view.W, view.H) / 2 + 220;
    Object.assign(sun.shadow.camera, { left: -range, right: range, top: range, bottom: -range });
    sun.shadow.camera.updateProjectionMatrix();
    lastW = view.W; lastH = view.H; lastRatio = ratio;
    diagnostics.pixelRatio = ratio;
  }

  applyLevel(state.level);
  state.hold = 0;

  return {
    diagnostics,
    // Exposed via __game for meaningful renderer checks and visual inspection.
    scene, camera, aircraft, renderer, naval,
    quality: {
      get level() { return state.level; },
      get locked() { return state.locked; },
      set(index) { if (Q.levels[index]) { applyLevel(index); state.locked = true; } },
      unlock() { state.locked = false; state.failed.clear(); },
    },
    render(game, view, dt, shakeX, shakeY) {
      adapt();
      resize(view);
      camera.position.set(game.cam.x - shakeX, 1000, game.cam.y - shakeY);
      camera.lookAt(game.cam.x - shakeX, 0, game.cam.y - shakeY);
      const [sx, sy, sz] = CONFIG.render.sunOffset;
      sun.position.set(game.cam.x + sx, sy, game.cam.y + sz);
      sun.target.position.set(game.cam.x, 0, game.cam.y);
      world.update(game.cam, view, game.time, lastRatio, game.territories);
      const live = new Set([...game.enemies, ...game.allies]);
      if (game.player && game.mode === 'play') live.add(game.player);
      for (const [entity, visual] of aircraft) {
        if (live.has(entity) && visual.aircraftType === (entity.aircraft || (entity === game.player || entity.team === 'us' ? 'us' : 'jp'))) continue;
        scene.remove(visual.root, visual.shadow);
        // Geometry stays shared; friendly flash materials belong to each instance.
        for (const material of visual.ownedMaterials) material.dispose();
        aircraft.delete(entity);
      }
      for (const entity of live) {
        const player = entity === game.player;
        if (!aircraft.has(entity)) {
          const kind = entity.aircraft || (player || entity.team === 'us' ? 'us' : 'jp');
          const visual = createAircraft(templates[kind] || templates.us, entity, level().shadows);
          visual.aircraftType = kind;
          aircraft.set(entity, visual); scene.add(visual.root, visual.shadow);
        }
        updateAircraft(aircraft.get(entity), entity, dt,
          player ? CONFIG.player.turnRate : entity.turn,
          (player || entity.team === 'us') && entity.hitFlash > .12);
      }
      naval.update(game);
      effects.update(game);
      renderer.render(scene, camera);
      diagnostics.aircraft = aircraft.size;
      diagnostics.drawCalls = renderer.info.render.calls;
      diagnostics.triangles = renderer.info.render.triangles;
      diagnostics.chunks = world.chunkCount;
    },
  };
}
