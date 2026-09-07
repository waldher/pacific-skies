// Keyboard + touch input. Left half of the screen is a virtual
// stick, right half is the fire button.
import { view } from './canvas.js';
import { audioInit } from './audio.js';
import { game, startGame } from './state.js';
import { requestCarrier } from './carrier.js';
import { nextTarget } from './campaign.js';

export const keys = {};
export const stick = { active: false, id: -1, ax: 0, ay: 0, dx: 0, dy: 0 };
export const fireTouch = { active: false, id: -1 };
export const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

export function initInput(cvs) {
  document.getElementById('carrier-action').addEventListener('click', () => requestCarrier(game));
  document.getElementById('target-action').addEventListener('click', () => nextTarget(game));
  window.addEventListener('blur', () => {
    for (const key of Object.keys(keys)) keys[key] = false;
    stick.active = fireTouch.active = false;
  });
  window.addEventListener('keydown', e => {
    if (game.mode === 'play' && e.code === 'KeyL' && !e.repeat) requestCarrier(game);
    if (game.mode === 'play' && e.code === 'Tab') { e.preventDefault(); if (!e.repeat) nextTarget(game); }
    keys[e.code] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    audioInit();
    if (game.mode !== 'play' && (e.code === 'Space' || e.code === 'Enter')) startGame();
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });

  cvs.addEventListener('pointerdown', e => {
    audioInit();
    if (game.mode !== 'play') { startGame(); return; }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cvs.setPointerCapture(e.pointerId);
    if (e.clientX < view.W * 0.5 && !stick.active) {
      stick.active = true; stick.id = e.pointerId;
      stick.ax = e.clientX; stick.ay = e.clientY; stick.dx = 0; stick.dy = 0;
    } else if (!fireTouch.active) {
      fireTouch.active = true; fireTouch.id = e.pointerId;
    }
  });
  cvs.addEventListener('pointermove', e => {
    if (stick.active && e.pointerId === stick.id) {
      stick.dx = e.clientX - stick.ax; stick.dy = e.clientY - stick.ay;
      const m = Math.hypot(stick.dx, stick.dy), max = 70;
      if (m > max) { stick.dx *= max / m; stick.dy *= max / m; }
    }
  });
  function pointerEnd(e) {
    if (e.pointerId === stick.id) { stick.active = false; stick.id = -1; stick.dx = stick.dy = 0; }
    if (e.pointerId === fireTouch.id) { fireTouch.active = false; fireTouch.id = -1; }
  }
  cvs.addEventListener('pointerup', pointerEnd);
  cvs.addEventListener('pointercancel', pointerEnd);
}
