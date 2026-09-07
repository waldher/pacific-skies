// Low-poly ship meshes and territorial beacons, built once and reused.
import * as THREE from 'three';
import { CONFIG } from './config.js';

const material = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: .85, ...options });
const hull = material('#314453'), deck = material('#6c7270'), wood = material('#8b8060');
const cabin = material('#839296'), dark = material('#263743'), white = material('#ece5bf');
const friend = new THREE.MeshBasicMaterial({ color: '#62ddba' });
const hostile = new THREE.MeshBasicMaterial({ color: '#ee7964' });
const wakeMat = new THREE.MeshBasicMaterial({ color: '#b1e4e4', transparent: true, opacity: .22, depthWrite: false });
function box(group, dimensions, position, mat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), mat);
  mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh;
}
function outline(group, width, length, height, base, mat) {
  const shape = new THREE.Shape();
  [[0, length / 2], [width * .4, length * .35], [width / 2, length * .15],
    [width / 2, -length * .43], [width * .32, -length / 2], [-width * .32, -length / 2],
    [-width / 2, -length * .43], [-width / 2, length * .15], [-width * .4, length * .35]]
    .forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
  shape.closePath();
  const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false }), mat);
  mesh.rotation.x = -Math.PI / 2; mesh.position.y = base; mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh);
}
function shipTemplate(carrier) {
  const group = new THREE.Group();
  const length = carrier ? CONFIG.carrier.length : CONFIG.ship.length;
  const width = carrier ? CONFIG.carrier.width : CONFIG.ship.width;
  outline(group, width * .9, length, 8, 1, hull);
  outline(group, width, length * .95, 2, 9, carrier ? wood : deck);
  if (carrier) {
    // Clear centerline, threshold stripes, arresting wires and deck-edge lights.
    for (let z = -88; z < 92; z += 24) box(group, [2, .15, 11], [0, 11.2, z], white);
    for (const x of [-25, 25]) box(group, [1.2, .15, 155], [x, 11.2, 0], white);
    for (const z of [60, 68, 76]) box(group, [40, .2, .7], [0, 11.3, z], dark);
    for (const x of [-18, -12, -6, 6, 12, 18]) box(group, [3, .15, 12], [x, 11.2, -78], white);
    box(group, [12, 14, 42], [30, 18, -14], cabin);
    box(group, [16, 6, 19], [30, 28, -22], deck);
    box(group, [2, 21, 2], [30, 39, -12], dark);
    box(group, [20, 1, 1], [30, 46, -12], cabin);
    for (const z of [-60, 5, 60]) for (const x of [-30, 30]) box(group, [2, 1, 2], [x, 12, z], friend);
  } else {
    box(group, [17, 12, 28], [0, 16, -10], cabin);
    box(group, [20, 6, 15], [0, 23, -16], deck);
    box(group, [7, 12, 9], [0, 19, 13], dark);
    box(group, [2, 18, 2], [0, 30, -3], dark);
    for (const z of [-37, 35]) {
      const turret = new THREE.Group(); turret.name = 'Turret'; turret.position.set(0, 12, z);
      box(turret, [13, 5, 11], [0, 0, 0], hull);
      box(turret, [2, 2, 18], [0, 2, -10], dark); group.add(turret);
    }
    box(group, [12, .2, 8], [0, 11.3, 48], hostile);
  }
  return group;
}

export function createNavalScene(scene) {
  const templates = { carrier: shipTemplate(true), destroyer: shipTemplate(false) };
  const ships = new Map(), zones = new Map();
  const wakeGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const ringGeometry = new THREE.RingGeometry(CONFIG.conquest.captureRadius - 2, CONFIG.conquest.captureRadius, 64).rotateX(-Math.PI / 2);
  const poleGeometry = new THREE.CylinderGeometry(1, 1, 28, 6);
  const flagGeometry = new THREE.BoxGeometry(24, 12, .8);
  return {
    ships, zones,
    update(game) {
      const liveShips = new Set(game.ships.filter(s => !(s.hp <= 0 && s.sinking > CONFIG.ship.sinkingSeconds)));
      for (const [s, visual] of ships) if (!liveShips.has(s)) { scene.remove(visual.root, visual.wake); ships.delete(s); }
      for (const s of liveShips) {
        if (!ships.has(s)) {
          const root = templates[s.kind].clone(true);
          root.name = s.kind === 'carrier' ? 'FriendlyCarrier' : 'PatrolDestroyer';
          const wake = new THREE.Mesh(wakeGeometry, wakeMat);
          ships.set(s, { root, wake }); scene.add(root, wake);
        }
        const v = ships.get(s), sink = s.hp <= 0 ? s.sinking / CONFIG.ship.sinkingSeconds : 0;
        v.root.position.set(s.x, -sink * 28, s.y);
        v.root.rotation.set(0, -s.a - Math.PI / 2, sink * .35);
        v.root.traverse(node => { if (node.name === 'Turret') node.rotation.y = -(s.gunAngle ?? s.a) + s.a; });
        v.wake.visible = s.kind !== 'carrier' && s.hp > 0;
        v.wake.position.set(s.x - Math.cos(s.a) * s.length * .65, .3, s.y - Math.sin(s.a) * s.length * .65);
        v.wake.rotation.y = v.root.rotation.y;
        v.wake.scale.set(s.width * .55, 1, s.length * .7);
      }
      const liveZones = new Set(game.territories);
      for (const [t, group] of zones) if (!liveZones.has(t)) { scene.remove(group); zones.delete(t); }
      for (const t of liveZones) {
        if (!zones.has(t)) {
          const group = new THREE.Group(); group.position.set(t.x, 0, t.y);
          const ring = new THREE.Mesh(ringGeometry, hostile); ring.position.y = .7; group.add(ring);
          const pole = new THREE.Mesh(poleGeometry, cabin); pole.position.y = 22; group.add(pole);
          const flag = new THREE.Mesh(flagGeometry, hostile); flag.position.set(12, 32, 0); group.add(flag);
          group.name = 'Territory-' + t.name; zones.set(t, group); scene.add(group);
        }
        const group = zones.get(t), mat = t.owner === 'us' ? friend : hostile;
        group.children[0].material = mat; group.children[2].material = mat;
        group.children[0].visible = t.owner !== 'us';
      }
    },
  };
}
