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
function shipTemplate(carrier, enemy = false) {
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
    for (const z of [-60, 5, 60]) for (const x of [-30, 30]) box(group, [2, 1, 2], [x, 12, z], enemy ? hostile : friend);
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
  const templates = { carrier: shipTemplate(true), enemyCarrier: shipTemplate(true, true), destroyer: shipTemplate(false) };
  const ships = new Map(), zones = new Map(), airfields = new Map(), bombs = new Map();
  const runwayMat = material('#4d5753'), hangarMat = material('#a7a189'), rubbleMat = material('#343534');
  const bombGeometry = new THREE.SphereGeometry(3, 6, 4);
  const bombRing = new THREE.RingGeometry(14, 16, 24).rotateX(-Math.PI / 2);
  const wakeGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const ringGeometry = new THREE.RingGeometry(CONFIG.conquest.captureRadius - 2, CONFIG.conquest.captureRadius, 64).rotateX(-Math.PI / 2);
  const poleGeometry = new THREE.CylinderGeometry(1, 1, 28, 6);
  const flagGeometry = new THREE.BoxGeometry(24, 12, .8);
  return {
    ships, zones, airfields, bombs,
    update(game) {
      const liveShips = new Set(game.ships.filter(s => s.active !== false && !(s.hp <= 0 && s.sinking > CONFIG.ship.sinkingSeconds)));
      for (const [s, visual] of ships) if (!liveShips.has(s)) { scene.remove(visual.root, visual.wake); ships.delete(s); }
      for (const s of liveShips) {
        if (!ships.has(s)) {
          const root = templates[s.kind === 'carrier' && s.team === 'jp' ? 'enemyCarrier' : s.kind].clone(true);
          root.name = s.kind === 'carrier' ? (s.team === 'jp' ? 'EnemyCarrier' : 'FriendlyCarrier') : 'PatrolDestroyer';
          const wake = new THREE.Mesh(wakeGeometry, wakeMat);
          ships.set(s, { root, wake }); scene.add(root, wake);
        }
        const v = ships.get(s), sink = s.hp <= 0 ? s.sinking / CONFIG.ship.sinkingSeconds : 0;
        v.root.position.set(s.x, -sink * 28, s.y);
        v.root.rotation.set(0, -s.a - Math.PI / 2, sink * .35);
        v.root.traverse(node => { if (node.name === 'Turret') node.rotation.y = -(s.gunAngle ?? s.a) + s.a; });
        v.wake.visible = s.hp > 0 && (s.kind !== 'carrier' || s.team === 'jp');
        v.wake.position.set(s.x - Math.cos(s.a) * s.length * .65, .3, s.y - Math.sin(s.a) * s.length * .65);
        v.wake.rotation.y = v.root.rotation.y;
        v.wake.scale.set(s.width * .55, 1, s.length * .7);
      }
      const liveFields = new Set(game.airfields || []);
      for (const [field, visual] of airfields) if (!liveFields.has(field)) {
        scene.remove(visual.root);
        visual.root.traverse(node => { if (node.isMesh) node.geometry.dispose(); });
        airfields.delete(field);
      }
      for (const field of liveFields) {
        if (!airfields.has(field)) {
          const root = new THREE.Group(); root.name = 'Airfield-' + field.id;
          const length = CONFIG.airfield?.length ?? 300, width = CONFIG.airfield?.width ?? 70;
          box(root, [width, .5, length], [0, 9, 0], runwayMat);
          for (let z = -length / 2 + 25; z < length / 2; z += 35) box(root, [2, .2, 17], [0, 9.4, z], white);
          for (const end of [-1, 1]) for (const x of [-21, -13, 13, 21]) box(root, [4, .2, 15], [x, 9.4, end * (length / 2 - 18)], white);
          // Paint a northbound approach arrow just inside the southern threshold.
          const arrow = new THREE.Shape();
          [[0, 20], [12, 3], [4, 3], [4, -18], [-4, -18], [-4, 3], [-12, 3]]
            .forEach(([x, y], i) => i ? arrow.lineTo(x, y) : arrow.moveTo(x, y));
          arrow.closePath();
          const direction = new THREE.Mesh(new THREE.ShapeGeometry(arrow), white);
          direction.rotation.x = -Math.PI / 2;
          direction.position.set(0, 9.7, length / 2 - 52);
          root.add(direction);
          const hangars = [];
          for (const z of [-65, 0, 65]) {
            const hangar = box(root, [35, 18, 40], [width / 2 + 33, 18, z], hangarMat);
            hangars.push(hangar);
            box(root, [width / 2, .2, 20], [width / 2 + 8, 9.2, z], runwayMat);
          }
          const beacon = box(root, [8, 1, 8], [-width / 2 - 8, 10, -length / 2 + 10], friend);
          airfields.set(field, { root, hangars, beacon }); scene.add(root);
        }
        const v = airfields.get(field);
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
      for (const [t, group] of zones) if (!liveZones.has(t)) { scene.remove(group); zones.delete(t); }
      for (const t of liveZones) {
        if (!zones.has(t)) {
          const group = new THREE.Group(); group.position.set(t.x, 0, t.y);
          const ring = new THREE.Mesh(ringGeometry, hostile); ring.position.y = 9; group.add(ring);
          const pole = new THREE.Mesh(poleGeometry, cabin); pole.position.set(-100, 28, 0); group.add(pole);
          const flag = new THREE.Mesh(flagGeometry, hostile); flag.position.set(-88, 40, 0); group.add(flag);
          if (t.role === 'radar') {
            box(group, [32, 18, 26], [70, 17, 0], cabin);
            box(group, [3, 42, 3], [70, 43, 0], dark);
            const dish = box(group, [45, 20, 3], [70, 62, 0], cabin); dish.name = 'RadarDish';
            box(group, [2, 28, 2], [70, 62, 0], dark);
          } else if (t.role === 'port') {
            box(group, [110, 5, 30], [0, 9, t.radius * .7], wood);
            for (const x of [-42, 42]) box(group, [18, 5, 80], [x, 9, t.radius * .7 + 28], wood);
            for (const x of [-30, 15]) box(group, [32, 24, 35], [x, 20, t.radius * .7 - 42], cabin);
            box(group, [4, 58, 4], [65, 36, t.radius * .7], dark);
            box(group, [54, 4, 4], [45, 64, t.radius * .7], dark);
          }
          group.name = 'Territory-' + t.name; zones.set(t, group); scene.add(group);
        }
        const group = zones.get(t), mat = t.owner === 'us' ? friend : hostile;
        group.children[0].material = mat; group.children[2].material = mat;
        group.children[0].visible = t.owner !== 'us';
        const dish = group.getObjectByName('RadarDish');
        if (dish) dish.rotation.y = game.time * .5;
      }
    },
  };
}
