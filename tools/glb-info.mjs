#!/usr/bin/env node
// Print the node tree, materials and world-space bounding boxes of a GLB.
//
//   node tools/glb-info.mjs assets/aircraft/F4U_Corsair.glb
//
// Dimensions are in the file's own units (metres for the aircraft here),
// so the output can be compared directly against a reference drawing.
// Pure Node; no dependencies.

import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: node tools/glb-info.mjs <file.glb>'); process.exit(1); }
const buf = readFileSync(file);
if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error('not a GLB file');
let offset = 12, json = null, bin = null;
while (offset < buf.length) {
  const length = buf.readUInt32LE(offset), type = buf.readUInt32LE(offset + 4);
  const chunk = buf.subarray(offset + 8, offset + 8 + length);
  if (type === 0x4E4F534A) json = JSON.parse(chunk.toString('utf8'));
  else if (type === 0x004E4942) bin = chunk;
  offset += 8 + length;
}

const COMPONENT = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function accessor(index) {
  const a = json.accessors[index], view = json.bufferViews[a.bufferView];
  const [Type, bytes] = COMPONENT[a.componentType], n = SIZE[a.type];
  const stride = view.byteStride || bytes * n, base = (view.byteOffset || 0) + (a.byteOffset || 0);
  const out = [];
  for (let i = 0; i < a.count; i++) {
    const at = bin.byteOffset + base + i * stride;
    out.push(Array.from(new Type(bin.buffer.slice(at, at + bytes * n))));
  }
  return out;
}

function localMatrix(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1], t = node.translation || [0, 0, 0], s = node.scale || [1, 1, 1];
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
  return [ // column-major, like glTF
    r[0] * s[0], r[1] * s[0], r[2] * s[0], 0,
    r[3] * s[1], r[4] * s[1], r[5] * s[1], 0,
    r[6] * s[2], r[7] * s[2], r[8] * s[2], 0,
    t[0], t[1], t[2], 1];
}
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}
const apply = (m, [x, y, z]) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14]];

const f = v => v.toFixed(3);
const total = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
let triangles = 0;
console.log(`asset: ${JSON.stringify(json.asset)}`);
console.log('materials:');
(json.materials || []).forEach((m, i) => {
  const pbr = m.pbrMetallicRoughness || {};
  console.log(`  [${i}] ${m.name}  base=${(pbr.baseColorFactor || []).map(v => v.toFixed(3)).join(',')}  metal=${pbr.metallicFactor}  rough=${pbr.roughnessFactor}`);
});
function walk(index, parent, depth) {
  const node = json.nodes[index], m = multiply(parent, localMatrix(node));
  let line = `${'  '.repeat(depth)}[${index}] ${node.name || ''}`;
  if (node.translation) line += ` t=${node.translation.map(f).join(',')}`;
  if (node.rotation) line += ` r=${node.rotation.map(f).join(',')}`;
  if (node.scale) line += ` s=${node.scale.map(f).join(',')}`;
  if (node.mesh !== undefined) {
    const mesh = json.meshes[node.mesh];
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let tris = 0;
    for (const prim of mesh.primitives) {
      for (const v of accessor(prim.attributes.POSITION)) {
        const w = apply(m, v);
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], w[k]); max[k] = Math.max(max[k], w[k]);
          total.min[k] = Math.min(total.min[k], w[k]); total.max[k] = Math.max(total.max[k], w[k]);
        }
      }
      tris += (prim.indices !== undefined ? json.accessors[prim.indices].count : json.accessors[prim.attributes.POSITION].count) / 3;
    }
    triangles += tris;
    line += ` mesh="${mesh.name}" mat=${mesh.primitives.map(p => p.material).join(',')} tris=${tris}`;
    line += `\n${'  '.repeat(depth)}      bbox x[${f(min[0])},${f(max[0])}] y[${f(min[1])},${f(max[1])}] z[${f(min[2])},${f(max[2])}]`
      + ` size=(${f(max[0] - min[0])},${f(max[1] - min[1])},${f(max[2] - min[2])})`;
  }
  console.log(line);
  for (const child of node.children || []) walk(child, m, depth + 1);
}
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
for (const scene of json.scenes) for (const root of scene.nodes) walk(root, identity, 0);
console.log(`total triangles: ${triangles}`);
console.log(`total bbox x[${f(total.min[0])},${f(total.max[0])}] y[${f(total.min[1])},${f(total.max[1])}] z[${f(total.min[2])},${f(total.max[2])}]`
  + ` size=(${f(total.max[0] - total.min[0])},${f(total.max[1] - total.min[1])},${f(total.max[2] - total.min[2])})`);
