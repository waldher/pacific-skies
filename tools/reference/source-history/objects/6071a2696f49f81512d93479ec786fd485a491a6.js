import * as THREE from '../vendor/three/three.module.min.js';
import { createLand, preloadTerrainMaterial } from './land.js';
import { preloadCanopyMaterial } from './canopy.js';
let land;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      if (typeof OffscreenCanvas === 'undefined' || !new OffscreenCanvas(1,1).getContext('2d') || typeof createImageBitmap !== 'function') throw Error('OffscreenCanvas 2D/ImageBitmap unavailable');
      if (data.useMaterial && !await preloadTerrainMaterial()) throw Error('Worker terrain material unavailable');
      if (data.useCanopy && !await preloadCanopyMaterial()) throw Error('Worker canopy material unavailable');
      land = createLand(null, { time:{value:0}, wind:{value:new THREE.Vector2()}, cloudSpeed:{value:0}, cloudStrength:{value:0}, surfMaterial:new THREE.ShaderMaterial() });
      self.postMessage({type:'ready'}); return;
    }
    if (data.type !== 'build' || !land) throw Error('Worker not initialized');
    const start = performance.now(), group = land.build(data.territory,data.context);
    const built = performance.now(), payload = await land.serialize(group);
    const transfers = new Set([payload.bitmap]);
    for (const mesh of payload.meshes) {
      for (const attribute of Object.values(mesh.attributes)) transfers.add(attribute.array.buffer);
      if (mesh.index) transfers.add(mesh.index.buffer);
    }
    self.postMessage({type:'built',id:data.id,payload,buildMs:built-start,serializeMs:performance.now()-built},[...transfers]);
    land.dispose(group);
  } catch (error) { self.postMessage({type:'error',id:data.id,error:String(error)}); }
};
