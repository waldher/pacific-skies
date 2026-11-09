#!/usr/bin/env node
// Build a blind judging packet: images from several capture sets, shuffled and
// renamed, with the identity key written OUTSIDE the packet directory.
//
//   node playtest/climb/packet.cjs <out-dir> <key.json> name=dir[:filter] ...
// `filter` is a filename prefix (e.g. phone-, hud-). The shuffle is seeded by
// the out-dir name so a packet can be rebuilt.
const fs = require('node:fs'), path = require('node:path');
const [out, keyFile, ...sets] = process.argv.slice(2);
if (!out || !keyFile || !sets.length) { console.error('usage: packet.cjs <out-dir> <key.json> name=dir[:prefix] ...'); process.exit(2); }
let seed = [...path.basename(out)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const items = [];
for (const spec of sets) {
  const [name, rest] = spec.split('='), [dir, prefix = ''] = rest.split(':');
  for (const file of fs.readdirSync(dir).filter(f => /\.(png|jpg|webp)$/.test(f) && f.startsWith(prefix) && !/sheet|^s\.|^[ab]\.|cmp/.test(f)).sort())
    items.push({ set: name, scene: file.replace(/\.\w+$/, ''), source: path.join(dir, file) });
}
for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const key = {};
items.forEach((item, i) => {
  const id = `img-${String(i + 1).padStart(2, '0')}`;
  fs.copyFileSync(item.source, path.join(out, id + path.extname(item.source)));
  key[id] = { set: item.set, scene: item.scene };
});
fs.writeFileSync(keyFile, JSON.stringify(key, null, 1) + '\n');
console.log(`${items.length} images -> ${out}; key -> ${keyFile}`);
