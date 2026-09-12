// Low-poly ship meshes, airfields and installations, built once and reused.
//
// Every static part is merged into one vertex-coloured mesh per object, so a
// carrier is one draw call instead of thirty. Only parts that move or change
// state stay separate: turrets and radar dishes rotate, hangars collapse as
// an airfield takes damage, beacons and flags recolour with ownership.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';
import { shipObserved, installationKnown, observedAt } from './intelligence.js';

const paint = new THREE.MeshLambertMaterial({ vertexColors: true });
const solid = hex => new THREE.MeshLambertMaterial({ color: hex });
const hangarMat = solid('#a7a189'), rubbleMat = solid('#343534'), dark = solid('#263743'), cabin = solid('#839296');
const friend = new THREE.MeshBasicMaterial({ color: '#62ddba' });
const hostile = new THREE.MeshBasicMaterial({ color: '#ee7964' });
const wakeMat = new THREE.MeshBasicMaterial({ color: '#b1e4e4', transparent: true, opacity: .22, depthWrite: false });
const HULL = '#314453', DECK = '#6c7270', WOOD = '#8b8060', CABIN = '#839296', DARK = '#263743', WHITE = '#ece5bf';
const FRIEND = '#62ddba', HOSTILE = '#ee7964', RUNWAY = '#4d5753';

// Collects coloured parts and merges them into one geometry.
class Parts {
  constructor() { this.list = []; }
  add(geometry, hex, position = [0, 0, 0], rotation = null) {
    const c = new THREE.Color(hex);
    if (rotation) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
    geometry.translate(...position);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.list.push(geometry.index ? geometry.toNonIndexed() : geometry);
    return this;
  }
  box(dimensions, position, hex) { return this.add(new THREE.BoxGeometry(...dimensions), hex, position); }
  mesh(shadows = true) {
    const geometry = mergeGeometries(this.list);
    for (const part of this.list) part.dispose();
    const mesh = new THREE.Mesh(geometry, paint);
    mesh.castShadow = shadows; mesh.receiveShadow = shadows;
    return mesh;
  }
}
function hullOutline(width, length, height) {
  const shape = new THREE.Shape();
  [[0, length / 2], [width * .4, length * .35], [width / 2, length * .15],
    [width / 2, -length * .43], [width * .32, -length / 2], [-width * .32, -length / 2],
    [-width / 2, -length * .43], [-width / 2, length * .15], [-width * .4, length * .35]]
    .forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
}
function shipTemplate(carrier, enemy = false) {
  const group = new THREE.Group();
  const length = carrier ? CONFIG.carrier.length : CONFIG.ship.length;
  const width = carrier ? CONFIG.carrier.width : CONFIG.ship.width;
  const parts = new Parts();
  parts.add(hullOutline(width * .9, length, 8), HULL, [0, 1, 0], [-Math.PI / 2, 0, 0]);
  parts.add(hullOutline(width, length * .95, 2), carrier ? WOOD : DECK, [0, 9, 0], [-Math.PI / 2, 0, 0]);
  const light = enemy ? HOSTILE : FRIEND;
  if (carrier) {
    // Clear centerline, threshold stripes, arresting wires and deck-edge lights.
    for (let z = -88; z < 92; z += 24) parts.box([2, .15, 11], [0, 11.2, z], WHITE);
    for (const x of [-25, 25]) parts.box([1.2, .15, 155], [x, 11.2, 0], WHITE);
    for (const z of [60, 68, 76]) parts.box([40, .2, .7], [0, 11.3, z], DARK);
    for (const x of [-18, -12, -6, 6, 12, 18]) parts.box([3, .15, 12], [x, 11.2, -78], WHITE);
    parts.box([12, 14, 42], [30, 18, -14], CABIN);
    parts.box([16, 6, 19], [30, 28, -22], DECK);
    parts.box([2, 21, 2], [30, 39, -12], DARK);
    parts.box([20, 1, 1], [30, 46, -12], CABIN);
    for (const z of [-60, 5, 60]) for (const x of [-30, 30]) parts.box([2, 1, 2], [x, 12, z], light);
    group.add(parts.mesh());
  } else {
    parts.box([17, 12, 28], [0, 16, -10], CABIN);
    parts.box([20, 6, 15], [0, 23, -16], DECK);
    parts.box([7, 12, 9], [0, 19, 13], DARK);
    parts.box([2, 18, 2], [0, 30, -3], DARK);
    parts.box([12, .2, 8], [0, 11.3, 48], light);
    group.add(parts.mesh());
    for (const z of [-37, 35]) {
      const turret = new Parts().box([13, 5, 11], [0, 0, 0], HULL).box([2, 2, 18], [0, 2, -10], DARK).mesh();
      turret.name = 'Turret'; turret.position.set(0, 12, z); group.add(turret);
    }
  }
  return group;
}

export function createNavalScene(scene) {
  const templates = { carrier: shipTemplate(true), enemyCarrier: shipTemplate(true, true), destroyer: shipTemplate(false), enemyDestroyer: shipTemplate(false, true) };
  const ships = new Map(), zones = new Map(), airfields = new Map(), bombs = new Map();
  const bombGeometry = new THREE.SphereGeometry(3, 6, 4);
  const bombRing = new THREE.RingGeometry(14, 16, 24).rotateX(-Math.PI / 2);
  const wakeGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const ringGeometry = new THREE.RingGeometry(CONFIG.conquest.captureRadius - 2, CONFIG.conquest.captureRadius, 64).rotateX(-Math.PI / 2);
  const flagGeometry = new THREE.BoxGeometry(24, 12, .8);
  const hangarGeometry = new THREE.BoxGeometry(35, 18, 40), beaconGeometry = new THREE.BoxGeometry(8, 1, 8);
  const length = CONFIG.airfield?.length ?? 300, width = CONFIG.airfield?.width ?? 70;
  // Runway, markings, approach arrow and aprons: one mesh shared by every airfield.
  const runwayParts = new Parts().box([width, .5, length], [0, 9, 0], RUNWAY);
  for (let z = -length / 2 + 25; z < length / 2; z += 35) runwayParts.box([2, .2, 17], [0, 9.4, z], WHITE);
  for (const end of [-1, 1]) for (const x of [-21, -13, 13, 21]) runwayParts.box([4, .2, 15], [x, 9.4, end * (length / 2 - 18)], WHITE);
  const arrow = new THREE.Shape();
  [[0, 20], [12, 3], [4, 3], [4, -18], [-4, -18], [-4, 3], [-12, 3]].forEach(([x, y], i) => i ? arrow.lineTo(x, y) : arrow.moveTo(x, y));
  arrow.closePath();
  runwayParts.add(new THREE.ShapeGeometry(arrow), WHITE, [0, 9.7, length / 2 - 52], [-Math.PI / 2, 0, 0]);
  for (const z of [-65, 0, 65]) runwayParts.box([width / 2, .2, 20], [width / 2 + 8, 9.2, z], RUNWAY);
  const runwayGeometry = runwayParts.mesh(false).geometry;
  const radarGeometry = new Parts().box([32, 18, 26], [70, 17, 0], CABIN).box([3, 42, 3], [70, 43, 0], DARK).box([2, 28, 2], [70, 62, 0], DARK).mesh().geometry;
  const dishGeometry = new THREE.BoxGeometry(45, 20, 3);
  const portGeometry = new Parts().box([110, 5, 30], [0, 9, 0], WOOD).box([18, 5, 80], [-42, 9, 28], WOOD).box([18, 5, 80], [42, 9, 28], WOOD)
    .box([32, 24, 35], [-30, 20, -42], CABIN).box([32, 24, 35], [15, 20, -42], CABIN).box([4, 58, 4], [65, 36, 0], DARK).box([54, 4, 4], [45, 64, 0], DARK).mesh().geometry;
  const poleGeometry = new THREE.CylinderGeometry(1, 1, 28, 6);
  const lit = (geometry, material) => { const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; return mesh; };
  return {
    ships, zones, airfields, bombs,
    update(game) {
      const liveShips = new Set(game.ships.filter(s => s.active !== false && !(s.hp <= 0 && s.sinking > CONFIG.ship.sinkingSeconds)));
      for (const [s, visual] of ships) if (!liveShips.has(s)) { scene.remove(visual.root, visual.wake); ships.delete(s); }
      for (const s of liveShips) {
        if (!ships.has(s)) {
          const root = templates[s.team === 'jp' ? (s.kind === 'carrier' ? 'enemyCarrier' : 'enemyDestroyer') : s.kind].clone(true);
          root.name = s.kind === 'carrier' ? (s.team === 'jp' ? 'EnemyCarrier' : 'FriendlyCarrier') : 'PatrolDestroyer';
          const wake = new THREE.Mesh(wakeGeometry, wakeMat);
          ships.set(s, { root, wake, turrets: root.children.filter(node => node.name === 'Turret') }); scene.add(root, wake);
        }
        const v = ships.get(s), sink = s.hp <= 0 ? s.sinking / CONFIG.ship.sinkingSeconds : 0;
        v.root.visible = shipObserved(game, s);
        v.root.position.set(s.x, -sink * 28, s.y);
        v.root.rotation.set(0, -s.a - Math.PI / 2, sink * .35);
        for (const turret of v.turrets) turret.rotation.y = -(s.gunAngle ?? s.a) + s.a;
        v.wake.visible = v.root.visible && s.hp > 0 && (s.fleet ? s.fleet.moving : s.team === 'jp');
        v.wake.position.set(s.x - Math.cos(s.a) * s.length * .65, .3, s.y - Math.sin(s.a) * s.length * .65);
        v.wake.rotation.y = v.root.rotation.y;
        v.wake.scale.set(s.width * .55, 1, s.length * .7);
      }
      const liveFields = new Set(game.airfields || []);
      for (const [field, visual] of airfields) if (!liveFields.has(field)) { scene.remove(visual.root); airfields.delete(field); }
      for (const field of liveFields) {
        if (!airfields.has(field)) {
          const root = new THREE.Group(); root.name = 'Airfield-' + field.id;
          root.add(new THREE.Mesh(runwayGeometry, paint));
          const hangars = [];
          for (const z of [-65, 0, 65]) {
            const hangar = lit(hangarGeometry, hangarMat);
            hangar.position.set(width / 2 + 33, 18, z);
            hangars.push(hangar); root.add(hangar);
          }
          const beacon = new THREE.Mesh(beaconGeometry, friend);
          beacon.position.set(-width / 2 - 8, 10, -length / 2 + 10); root.add(beacon);
          airfields.set(field, { root, hangars, beacon }); scene.add(root);
        }
        const v = airfields.get(field);
        v.root.visible = field.owner === 'us' || observedAt(game, field);
        v.root.position.set(field.x, 0, field.y);
        v.root.rotation.y = -field.a - Math.PI / 2;
        v.beacon.material = field.owner === 'us' ? friend : hostile;
        const intact = Math.ceil(3 * Math.max(0, field.hp) / field.maxHp);
        v.hangars.forEach((hangar, i) => {
          hangar.scale.y = i < intact ? 1 : .15;
          hangar.position.y = i < intact ? 18 : 10;
          hangar.material = i < intact ? hangarMat : rubbleMat;
        });
      }
      const liveBombs = new Set(game.bombs || []);
      for (const [bomb, visual] of bombs) if (!liveBombs.has(bomb)) { scene.remove(visual.root); bombs.delete(bomb); }
      for (const bomb of liveBombs) {
        if (!bombs.has(bomb)) {
          const root = new THREE.Group(); root.name = 'FallingBomb';
          const body = new THREE.Mesh(bombGeometry, dark); body.scale.z = 2; root.add(body);
          const marker = new THREE.Mesh(bombRing, friend); marker.position.y = 10; root.add(marker);
          bombs.set(bomb, { root, body, marker }); scene.add(root);
        }
        const v = bombs.get(bomb), remaining = Math.max(0, Math.min(1, bomb.life / (bomb.maxLife || 1)));
        v.root.position.set(bomb.x, 0, bomb.y);
        v.body.position.y = 10 + CONFIG.render.flightHeight * remaining;
        v.marker.position.set((bomb.vx || 0) * Math.max(0, bomb.life), 10, (bomb.vy || 0) * Math.max(0, bomb.life));
        v.marker.scale.setScalar(.4 + remaining * .6);
      }
      const liveZones = new Set(game.territories);
      for (const [t, visual] of zones) if (!liveZones.has(t)) { scene.remove(visual.group); zones.delete(t); }
      for (const t of liveZones) {
        if (!zones.has(t)) {
          const group = new THREE.Group(); group.position.set(t.x, 0, t.y);
          const ring = new THREE.Mesh(ringGeometry, hostile); ring.position.y = 9; group.add(ring);
          const pole = lit(poleGeometry, cabin); pole.position.set(-100, 28, 0); group.add(pole);
          const flag = new THREE.Mesh(flagGeometry, hostile); flag.position.set(-88, 40, 0); group.add(flag);
          let dish = null;
          if (t.role === 'radar') {
            group.add(lit(radarGeometry, paint));
            dish = lit(dishGeometry, cabin); dish.name = 'RadarDish'; dish.position.set(70, 62, 0); group.add(dish);
          } else if (t.role === 'port') {
            // Pier points into water at the shared physical coastline.
            const coast = t.portShore, port = lit(portGeometry, paint);
            port.position.set(coast?.x || 0, 0, coast?.y || 0);
            port.rotation.y = Math.PI / 2 - (coast?.a || 0);
            group.add(port);
          }
          group.name = 'Territory-' + t.name; zones.set(t, { group, ring, flag, dish }); scene.add(group);
        }
        const v = zones.get(t);
        v.group.visible = installationKnown(game, t) && (t.owner === 'us' || observedAt(game, t));
        const mat = t.owner === 'us' ? friend : hostile;
        v.ring.material = mat; v.flag.material = mat;
        v.ring.visible = t.owner !== 'us';
        if (v.dish) v.dish.rotation.y = game.time * .5;
      }
    },
  };
}
