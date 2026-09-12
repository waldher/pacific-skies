// Life on the islands: trucks working the roads, villagers about their
// business, fishing boats off the piers. Every kind is one InstancedMesh, so
// hundreds of moving things cost three draw calls and a few hundred matrix
// composes per frame. Agents live in island-local coordinates on each loaded
// chunk and only exist while the island is on screen.
import * as THREE from 'three';
import { CONFIG } from './config.js';

const GROUND = 8.5;
const dummy = new THREE.Object3D();
const tint = new THREE.Color();

// Tiny vertex-coloured models: a truck (cab and load bed), a villager (a
// two-tone dot with a head), and a boat (hull and cabin).
function model(parts) {
  const geometries = parts.map(([w, h, d, x, y, z, hex]) => {
    const geometry = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    const c = new THREE.Color(hex), colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
  });
  const total = geometries.reduce((n, g) => n + g.attributes.position.count, 0);
  const merged = new THREE.BufferGeometry(), position = new Float32Array(total * 3), normal = new Float32Array(total * 3), color = new Float32Array(total * 3), index = [];
  let offset = 0;
  for (const g of geometries) {
    position.set(g.attributes.position.array, offset * 3); normal.set(g.attributes.normal.array, offset * 3); color.set(g.attributes.color.array, offset * 3);
    for (const i of g.index.array) index.push(i + offset);
    offset += g.attributes.position.count;
    g.dispose();
  }
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(color, 3));
  merged.setIndex(index);
  return merged;
}

export function createTraffic(scene) {
  const T = CONFIG.render.land.traffic;
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const pools = {
    trucks: new THREE.InstancedMesh(model([[4.5, 3.2, 4.2, -3.2, 1.6, 0, '#4b5d47'], [6.5, 2.4, 4.6, 2.4, 1.2, 0, '#6a6c58'], [6, 1, 4, 2.4, 2.9, 0, '#8d8a70']]), material, T.trucks),
    people: new THREE.InstancedMesh(model([[1.6, 2.2, 1.6, 0, 1.1, 0, '#d8c8a8'], [1.2, 1, 1.2, 0, 2.7, 0, '#5a3b2a']]), material, T.people),
    boats: new THREE.InstancedMesh(model([[14, 2.2, 5, 0, 1.1, 0, '#cfd6d8'], [3.5, 2, 3.4, -1.5, 3.2, 0, '#6d7d84'], [1, 6, 1, 3, 5, 0, '#8b7a5a']]), material, T.boats),
  };
  for (const mesh of Object.values(pools)) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.setColorAt(0, tint.set('#ffffff'));
    scene.add(mesh);
  }
  const place = (mesh, i, x, y, z, heading, scale, hue) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, -heading, 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, tint.setHSL(hue, .35, .62));
  };
  // Position and heading `s` units along a polyline.
  function along(path, s) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (s <= length || i === path.length - 1) {
        const f = Math.max(0, Math.min(1, s / length));
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.atan2(b[1] - a[1], b[0] - a[0])];
      }
      s -= length;
    }
    return [path[0][0], path[0][1], 0];
  }
  return {
    pools,
    update(dt, chunks, time) {
      const counts = { trucks: 0, people: 0, boats: 0 };
      for (const group of chunks) {
        const traffic = group.userData.traffic;
        if (!traffic) continue;
        const ox = group.position.x, oz = group.position.z;
        for (const truck of traffic.trucks) {
          truck.s += truck.dir * truck.speed * dt;
          if (truck.s > truck.length) { truck.s = truck.length; truck.dir = -1; }
          if (truck.s < 0) { truck.s = 0; truck.dir = 1; }
          const [x, y, a] = along(truck.path, truck.s), heading = truck.dir > 0 ? a : a + Math.PI;
          // Keep to the right-hand side of the road.
          const rx = -Math.sin(heading) * 2.6, ry = Math.cos(heading) * 2.6;
          if (counts.trucks < T.trucks) place(pools.trucks, counts.trucks++, ox + x + rx, GROUND + .3, oz + y + ry, heading, 1, truck.tint);
        }
        for (const person of traffic.people) {
          if (person.wait > 0) person.wait -= dt;
          else {
            const dx = person.tx - person.x, dy = person.ty - person.y, d = Math.hypot(dx, dy);
            if (d < 1) {
              person.seed = (Math.imul(person.seed ?? Math.floor(person.tint * 1e6), 1664525) + 1013904223) >>> 0;
              const r1 = person.seed / 4294967296, r2 = ((Math.imul(person.seed, 22695477) + 1) >>> 0) / 4294967296;
              person.tx = person.home.x + Math.cos(r1 * Math.PI * 2) * person.home.r * Math.sqrt(r2);
              person.ty = person.home.y + Math.sin(r1 * Math.PI * 2) * person.home.r * Math.sqrt(r2);
              person.wait = .5 + r2 * 4;
            } else {
              const step = Math.min(d, person.speed * dt);
              person.x += dx / d * step; person.y += dy / d * step; person.heading = Math.atan2(dy, dx);
            }
          }
          if (counts.people < T.people) place(pools.people, counts.people++, ox + person.x, GROUND + .2, oz + person.y, person.heading ?? 0, 1, person.tint);
        }
        for (const boat of traffic.boats) {
          // Out along the pier heading and back, a slow tide in the timing.
          const cycle = boat.range * 2 / boat.speed, phase = ((time / cycle + boat.phase) % 1 + 1) % 1;
          const out = phase < .5, s = (out ? phase * 2 : 2 - phase * 2) * boat.range;
          const heading = Math.atan2(boat.uy, boat.ux) + (out ? 0 : Math.PI);
          const sway = Math.sin(time * 1.3 + boat.phase * 9) * 2;
          const x = boat.home.x + boat.ux * s - boat.uy * sway, y = boat.home.y + boat.uy * s + boat.ux * sway;
          if (counts.boats < T.boats) place(pools.boats, counts.boats++, ox + x, .5, oz + y, heading, 1, boat.tint);
        }
      }
      for (const [key, mesh] of Object.entries(pools)) {
        mesh.count = counts[key];
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    },
  };
}
