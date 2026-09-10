// Keyboard + touch input. Left half of the screen is a virtual
// stick, right half is the fire button.
import { view } from './canvas.js';
import { audioInit } from './audio.js';
import { game, startGame, recoverPilot, resumeCampaign } from './state.js';
import { hasSavedCampaign } from './persistence.js';
import { launchBomb } from './bombs.js';
import { launchTorpedo } from './torpedoes.js';
import { requestCarrier } from './carrier.js';

export const keys = {};
export const stick = { active: false, id: -1, ax: 0, ay: 0, dx: 0, dy: 0 };
export const fireTouch = { active: false, id: -1 };
const touchMedia = window.matchMedia?.('(any-pointer: coarse)');
export let isTouchDevice = navigator.maxTouchPoints > 0 || ('ontouchstart' in window)
  || !!touchMedia?.matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '');

export function launchOrdnance() { if (game.paused) return false; return game.player?.loadout === 'bombs' ? launchBomb(game) : launchTorpedo(); }

function continueAction() {
  for (const key of Object.keys(keys)) keys[key] = false;
  stick.active = fireTouch.active = false;
  if (game.mode === 'recovery') recoverPilot();
  else if (game.mode === 'title' && hasSavedCampaign()) resumeCampaign();
  else startGame();
}
export function initInput(cvs) {
  document.getElementById('menu-start').addEventListener('click', e => { e.stopPropagation(); audioInit(); continueAction(); });
  document.getElementById('menu-new').addEventListener('click', e => { e.stopPropagation(); audioInit(); startGame(); });

  // Resolve hints from actual input too: tablets and embedded browsers may hide
  // their touch capabilities until the first contact.
  window.addEventListener('pointerdown', e => { if (e.pointerType === 'touch' || e.pointerType === 'pen') isTouchDevice = true; }, true);
  touchMedia?.addEventListener('change', e => { if (e.matches) isTouchDevice = true; });
  const torpedoButton = document.getElementById('torpedo-action');
  // Secondary touches do not reliably generate clicks while the steering thumb
  // remains down. Fire on pointerdown, without stealing the stick's capture.
  torpedoButton.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    launchOrdnance();
  });
  // Keep keyboard/assistive activation, but ignore the pointer's follow-up click.
  torpedoButton.addEventListener('click', e => { if (e.detail === 0) launchOrdnance(); });
  document.getElementById('carrier-action').addEventListener('click', () => requestCarrier(game));
  window.addEventListener('blur', () => {
    for (const key of Object.keys(keys)) keys[key] = false;
    stick.active = fireTouch.active = false;
  });
  window.addEventListener('keydown', e => {
    if (game.paused || (e.target instanceof HTMLElement && e.target.closest('button,select,details'))) return;
    if (['KeyW','KeyA','KeyS','KeyD','KeyT','KeyL','Space','Enter','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) isTouchDevice = false;
    if (game.mode === 'play' && e.code === 'KeyT' && !e.repeat) launchOrdnance();
    if (game.mode === 'play' && e.code === 'KeyL' && !e.repeat) requestCarrier(game);
    keys[e.code] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    audioInit();
    if (game.mode !== 'play' && !e.repeat && (e.code === 'Space' || e.code === 'Enter')) continueAction();
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; }, true);

  cvs.addEventListener('pointerdown', e => {
    if (game.paused) return;
    audioInit();
    if (game.mode !== 'play') { continueAction(); return; }
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
