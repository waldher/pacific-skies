// Shared shoreline and hull footprints: impacts match the visible surfaces.
import { hash2, TAU } from './util.js';

export function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[i], [bx, by] = points[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}
export function islandOutline(t, radius = t.radius, jitter = .22, seed = 2) {
  if (t.shoreline) {
    const factor = radius / t.radius;
    return t.shoreline.map(([x,y]) => [x * factor, y * factor]);
  }
  const gx = t.seed ?? t.id, gy = t.id;
  return Array.from({ length: 9 }, (_, i) => {
    const a = i / 9 * TAU, r = radius * (1 - jitter + hash2(gx * 9 + i + seed, gy * 9 + i) * jitter * 2);
    return [Math.cos(a) * r, Math.sin(a) * r * .85];
  });
}
export function onLand(point, territories) {
  return territories.some(t => {
    const x=point.x-t.x,y=point.y-t.y;
    // Physical extent encloses the shoreline, including offset shared holdings.
    // Operational capture radii do not: never use t.radius for this rejection.
    if(Number.isFinite(t.extent)&&x*x+y*y>t.extent*t.extent)return false;
    return insidePolygon(x,y,islandOutline(t));
  });
}
export function onHull(point, ship) {
  const dx = point.x - ship.x, dy = point.y - ship.y;
  const along = dx * Math.cos(ship.a) + dy * Math.sin(ship.a);
  const lateral = -dx * Math.sin(ship.a) + dy * Math.cos(ship.a);
  // Same tapered footprint as the physical hull mesh, with no splash radius.
  const L = ship.length, W = ship.width * .9;
  return insidePolygon(along, lateral, [[L/2,0],[L*.35,W*.4],[L*.15,W/2],[-L*.43,W/2],[-L/2,W*.32],[-L/2,-W*.32],[-L*.43,-W/2],[L*.15,-W/2],[L*.35,-W*.4]]);
}
