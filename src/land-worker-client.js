import { hasCanopyMaterial } from './canopy.js';
// One worker and one transferred result at a time. Scheduling/priority belongs
// to world.js; this transport never owns an unbounded payload queue.
export function createLandWorker(useMaterial, useCanopy = hasCanopyMaterial()) {
  let worker = null, nextId = 0, pending = null, mode = 'initializing', reason = null;
  const stats = { builds:0, lastBuildMs:0, lastSerializeMs:0 };
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  let timeout;
  function fail(error) {
    reason = String(error); mode = 'sync-fallback'; clearTimeout(timeout);
    worker?.terminate(); worker = null; resolveReady(false);
    if (pending) { pending.reject(Error(reason)); pending = null; }
  }
  try {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') throw Error('Worker/OffscreenCanvas unavailable');
    worker = new Worker(new URL('./land-worker.js', import.meta.url), { type:'module' });
    worker.onerror = e => { e.preventDefault(); fail(e.message || 'Terrain worker error'); };
    worker.onmessage = ({data}) => {
      if (data.type === 'ready') { clearTimeout(timeout); mode = 'worker'; resolveReady(true); }
      else if (data.type === 'error') fail(data.error);
      else if (data.type === 'built') {
        if (!pending || pending.id !== data.id) { data.payload.bitmap.close(); return; }
        clearTimeout(timeout); stats.builds++; stats.lastBuildMs = data.buildMs; stats.lastSerializeMs = data.serializeMs;
        const p = pending; pending = null; p.resolve(data.payload);
      }
    };
    timeout = setTimeout(() => fail('Terrain worker initialization timed out'), 10000);
    worker.postMessage({type:'init',useMaterial,useCanopy});
  } catch (error) { fail(error); }
  return {
    ready, fallback:fail,
    get stats() { return { mode, reason, ...stats }; },
    async build(territory,context) {
      await ready;
      if (mode !== 'worker') throw Error(reason || 'Terrain worker unavailable');
      if (pending) throw Error('Only one terrain build may be in flight');
      return new Promise((resolve,reject) => {
        const id = ++nextId; pending = {id,resolve,reject};
        timeout = setTimeout(() => fail('Terrain worker build timed out'), 15000);
        worker.postMessage({type:'build',id,territory,context});
      });
    },
  };
}
