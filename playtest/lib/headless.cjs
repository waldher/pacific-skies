// Load the real game modules in a vm context without WebGL: one game per process.
// Returns window.__game (the debug API) plus a namespace() loader for other modules.
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../..');

async function loadGame() {
  const records = new Map();
  const element = { getContext: () => ({ setTransform() {} }), style: {}, addEventListener() {}, append() {}, setAttribute() {}, querySelector() { return this; } };
  const context = vm.createContext({ console, performance, Math, navigator: { maxTouchPoints: 0 },
    localStorage: { getItem: k => records.get(k) ?? null, setItem: (k, v) => records.set(k, v), removeItem: k => records.delete(k) },
    document: { getElementById: () => element, createElement: () => ({ ...element }) }, requestAnimationFrame() {},
    window: { innerWidth: 900, innerHeight: 600, addEventListener() {} } });
  const cache = new Map();
  async function load(file) {
    if (cache.has(file)) return cache.get(file);
    const code = file.endsWith('/src/renderer.js') ? 'export async function createRenderer(){return {diagnostics:{ready:true}}}'
      : file.endsWith('/src/aircraft-previews.js') ? 'export const aircraftPreviews={}; export function renderAircraftPreviews(){}'
      : fs.readFileSync(file, 'utf8');
    const mod = new vm.SourceTextModule(code, { context, identifier: file });
    cache.set(file, mod); return mod;
  }
  const link = (specifier, parent) => load(path.resolve(path.dirname(parent.identifier), specifier));
  async function namespace(file) {
    const m = await load(path.join(root, file));
    if (m.status === 'unlinked') await m.link(link);
    if (m.status === 'linked') await m.evaluate();
    return m.namespace;
  }
  await namespace('src/main.js');
  return { api: context.window.__game, namespace, clearStorage: () => records.clear() };
}
module.exports = { loadGame, root };
