// Render-only altitude metadata. Never used by swept hits, aiming, range,
// damage or lifetime. No random numbers or mutations of gameplay fields.
import { CONFIG } from './config.js';
export const flightAltitude = entity => entity.altitude ?? CONFIG.render.flightHeight;
export function aircraftRound(entity) { return { renderAltitude: flightAltitude(entity) - 1 }; }
export function surfaceRound(origin, target, speed, height) {
  return { renderAltitude: height, visualStartAltitude: height,
    visualTargetAltitude: flightAltitude(target) - 1,
    visualFlightSeconds: Math.max(.001, Math.hypot(target.x-origin.x,target.y-origin.y)/speed), visualAge: 0 };
}
export function updateRoundAltitude(round, dt) {
  if (round.visualFlightSeconds === undefined) return;
  round.visualAge = (round.visualAge ?? 0) + dt;
  const t = Math.min(1, Math.max(0, round.visualAge / round.visualFlightSeconds));
  round.renderAltitude = round.visualStartAltitude + (round.visualTargetAltitude-round.visualStartAltitude)*t;
}
