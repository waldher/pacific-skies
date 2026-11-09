#!/usr/bin/env node
// Join judges' raw scores with a packet key and print weighted means per set.
//
//   node playtest/climb/score.cjs <key.json> <weights> judge-a.json judge-b.json ...
// A judge file is { "img-01": { "scores": [..], "note": ".." }, ... } with one
// score per rubric line, in rubric order. <weights> is e.g. 30,20,20,15,15.
const fs = require('node:fs');
const [keyFile, weightSpec, ...judgeFiles] = process.argv.slice(2);
const key = JSON.parse(fs.readFileSync(keyFile)), weights = weightSpec.split(',').map(Number), total = weights.reduce((a, b) => a + b, 0);
const sets = [...new Set(Object.values(key).map(k => k.set))], table = {}, lines = {};
for (const file of judgeFiles) {
  const judge = JSON.parse(fs.readFileSync(file)), name = file.replace(/^.*\/|\.json$/g, '');
  for (const set of sets) {
    const ids = Object.keys(key).filter(id => key[id].set === set && judge[id]);
    const per = weights.map((_, c) => ids.reduce((n, id) => n + judge[id].scores[c], 0) / ids.length);
    (table[set] ||= {})[name] = per.reduce((n, v, c) => n + v * weights[c], 0) / total;
    (lines[set] ||= []).push(per);
  }
}
const median = v => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const names = judgeFiles.map(f => f.replace(/^.*\/|\.json$/g, ''));
console.log(['set'.padEnd(12), ...names.map(n => n.padStart(9)), '   median', '  per-line means (judge average)'].join(''));
for (const set of sets) {
  const row = names.map(n => table[set][n]);
  const perLine = weights.map((_, c) => lines[set].reduce((n, per) => n + per[c], 0) / lines[set].length);
  console.log([set.padEnd(12), ...row.map(v => v.toFixed(2).padStart(9)), median(row).toFixed(2).padStart(9), '   ' + perLine.map(v => v.toFixed(1)).join(' ')].join(''));
}
if (process.env.SCENES) for (const set of sets) {
  const scenes = [...new Set(Object.values(key).filter(k => k.set === set).map(k => k.scene))];
  for (const scene of scenes) {
    const id = Object.keys(key).find(i => key[i].set === set && key[i].scene === scene);
    const scores = judgeFiles.map(f => JSON.parse(fs.readFileSync(f))[id]).filter(Boolean).map(j => j.scores.reduce((n, v, c) => n + v * weights[c], 0) / total);
    console.log(`  ${set}/${scene}`.padEnd(34), scores.map(v => v.toFixed(2)).join('  '));
  }
}
