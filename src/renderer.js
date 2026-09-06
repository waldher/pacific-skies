// Three.js scene. Simulation (x,y) maps to Three (x, altitude, z).
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { loadAircraft, createAircraft, updateAircraft } from './aircraft.js';
import { createWorld } from './world.js';
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
  const templates = await loadAircraft();
  const aircraft = new Map();
  let lastW = 0, lastH = 0, lastDPR = 0;
  const diagnostics = { ready: true, engine: 'Three.js', revision: THREE.REVISION, aircraft: 0, drawCalls: 0, triangles: 0, chunks: 0 };

  function resize(view) {
    if (view.W === lastW && view.H === lastH && view.DPR === lastDPR) return;
    renderer.setPixelRatio(view.DPR);
    renderer.setSize(view.W, view.H, false);
    camera.left = -view.W / 2; camera.right = view.W / 2;
    camera.top = view.H / 2; camera.bottom = -view.H / 2;
    camera.updateProjectionMatrix();
    const range = Math.max(view.W, view.H) / 2 + 220;
    Object.assign(sun.shadow.camera, { left: -range, right: range, top: range, bottom: -range });
    sun.shadow.camera.updateProjectionMatrix();
    lastW = view.W; lastH = view.H; lastDPR = view.DPR;
  }

  return {
    diagnostics,
    // Exposed via __game for meaningful renderer checks and visual inspection.
    scene, camera, aircraft, renderer,
    render(game, view, dt, shakeX, shakeY) {
      resize(view);
      camera.position.set(game.cam.x - shakeX, 1000, game.cam.y - shakeY);
      camera.lookAt(game.cam.x - shakeX, 0, game.cam.y - shakeY);
      sun.position.set(game.cam.x - 240, 800, game.cam.y - 320);
      sun.target.position.set(game.cam.x, 0, game.cam.y);
      world.update(game.cam, view, game.time);
      const live = new Set(game.enemies);
      if (game.player && game.mode === 'play') live.add(game.player);
      for (const [entity, visual] of aircraft) {
        if (live.has(entity)) continue;
        scene.remove(visual.root);
        // Geometry and materials belong to templates, not to each clone.
        aircraft.delete(entity);
      }
      for (const entity of live) {
        const player = entity === game.player;
        if (!aircraft.has(entity)) {
          const visual = createAircraft(templates[player ? 'us' : 'jp'], entity);
          aircraft.set(entity, visual); scene.add(visual.root);
        }
        updateAircraft(aircraft.get(entity), entity, dt,
          player ? CONFIG.player.turnRate : entity.turn,
          player && entity.hitFlash > .12);
      }
      effects.update(game);
      renderer.render(scene, camera);
      diagnostics.aircraft = aircraft.size;
      diagnostics.drawCalls = renderer.info.render.calls;
      diagnostics.triangles = renderer.info.render.triangles;
      diagnostics.chunks = world.chunkCount;
    },
  };
}
