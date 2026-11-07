// Canvas setup, resize handling, and world→screen transform.
import { game } from './state.js';

export const cvs = document.getElementById('c');
export const ctx = cvs.getContext('2d');
export const view = { W: 0, H: 0, DPR: 1 };

function resize() {
  view.DPR = Math.min(window.devicePixelRatio || 1, 2);
  view.W = window.innerWidth; view.H = window.innerHeight;
  cvs.width = Math.round(view.W * view.DPR);
  cvs.height = Math.round(view.H * view.DPR);
  cvs.style.width = view.W + 'px'; cvs.style.height = view.H + 'px';
  ctx.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
}
window.addEventListener('resize', resize);
resize();

export function w2s(x, y) {
  return [x - game.cam.x + view.W / 2, y - game.cam.y + view.H / 2];
}
