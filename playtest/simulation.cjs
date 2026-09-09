// Run real simulation modules without WebGL; rendering stays covered by playtest.js.
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const element = { getContext: () => ({ setTransform() {} }), style: {}, addEventListener() {} };
const context = vm.createContext({ console, performance, Math, navigator: { maxTouchPoints: 0 },
  document: { getElementById: () => element }, requestAnimationFrame() {},
  window: { innerWidth: 900, innerHeight: 600, addEventListener() {} } });
const cache = new Map();
async function load(file) {
  if (cache.has(file)) return cache.get(file);
  const code = file === path.join(root, 'src/renderer.js')
    ? 'export async function createRenderer() { return { diagnostics: { ready: true } }; }'
    : file === path.join(root, 'src/aircraft-previews.js')
      ? 'export const aircraftPreviews = {}; export function renderAircraftPreviews() {}'
      : fs.readFileSync(file, 'utf8');
  const mod = new vm.SourceTextModule(code, { context, identifier: file,
    importModuleDynamically: async (specifier, parent) => {
      const child = await load(path.resolve(path.dirname(parent.identifier), specifier));
      if (child.status === 'unlinked') await child.link(link);
      if (child.status === 'linked') await child.evaluate();
      return child;
    } });
  cache.set(file, mod); return mod;
}
const link = (specifier, parent) => load(path.resolve(path.dirname(parent.identifier), specifier));
(async () => {
  const main = await load(path.join(root, 'src/main.js')); await main.link(link); await main.evaluate();
  const test = await load(path.join(__dirname, 'campaign-checks.js')); await test.link(link); await test.evaluate();
  const checks = await test.namespace.campaignChecks(context.window.__game);
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}`);
  process.exitCode = checks.every(c => c.ok) ? 0 : 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
