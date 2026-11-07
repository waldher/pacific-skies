// Detached scenery only: active scenery must never disappear to satisfy a cache
// budget. Estimates include CPU arrays/canvas plus their GPU copies/mipmaps;
// driver overhead and temporary land-builder allocations are not measurable here.
export const LAND_CACHE_BYTES = 24 * 1024 * 1024;
export const LAND_BUILD_RESERVE_BYTES = 16 * 1024 * 1024;
export const LAND_CACHE_ENTRIES = 4;

export function estimateLandBytes(group) {
  const geometries = new Set(), textures = new Set();
  let bytes = 0;
  group.traverse(o => {
    if (o.geometry && !geometries.has(o.geometry)) {
      geometries.add(o.geometry);
      for (const a of Object.values(o.geometry.attributes || {})) bytes += (a.array?.byteLength || 0) * 2;
      bytes += (o.geometry.index?.array?.byteLength || 0) * 2;
    }
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const t = m?.uniforms?.albedoMap?.value;
      if (t && !textures.has(t)) {
        textures.add(t);
        bytes += (t.image?.width || 0) * (t.image?.height || 0) * 4 * (1 + 4 / 3);
      }
    }
  });
  return Math.ceil(bytes);
}

export class DetachedLandCache {
  constructor(dispose, maxBytes = LAND_CACHE_BYTES, maxEntries = LAND_CACHE_ENTRIES) {
    this.dispose = dispose; this.maxBytes = maxBytes; this.maxEntries = maxEntries;
    this.entries = new Map(); this.bytes = 0;
    this.hits = 0; this.evictions = 0;
  }
  take(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key); this.bytes -= entry.bytes; this.hits++;
    return entry.group;
  }
  put(key, group, bytes = estimateLandBytes(group)) {
    if (this.entries.has(key)) throw new Error('Land group cached twice');
    this.entries.set(key, { group, bytes }); this.bytes += bytes;
    this.trim();
  }
  trim(limit = this.maxBytes) {
    while (this.bytes > Math.max(0, limit) || this.entries.size > this.maxEntries) {
      const key = this.entries.keys().next().value;
      const entry = this.entries.get(key);
      if (!entry) break;
      this.entries.delete(key); this.bytes -= entry.bytes;
      this.dispose(entry.group); this.evictions++;
    }
  }
  reserveBuild() { this.trim(this.maxBytes - LAND_BUILD_RESERVE_BYTES); }
  clear() { for (const e of this.entries.values()) this.dispose(e.group); this.entries.clear(); this.bytes = 0; }
}
