/**
 * glitch.js — short visual disturbances. Intensity is operator-controlled and
 * every effect is skipped entirely under reduced motion.
 */

import { state } from '../core/state.js';
import { prefersReducedMotion } from '../core/dom.js';

let layer = null;
let peterEl = null;
let shellEl = null;
let busy = false;

export function initGlitch({ layerEl, peter, shell }) {
  layer = layerEl;
  peterEl = peter;
  shellEl = shell;
}

function motionOff() {
  return prefersReducedMotion() || state.prefs.reducedMotion;
}

/**
 * @param {number} [strength] 0-1; defaults to the operator's glitch setting.
 */
export function burst(strength) {
  if (motionOff() || busy || !layer) return;
  const s = Math.max(0, Math.min(1, strength ?? state.operator.glitch));
  if (s <= 0.001) return;

  busy = true;
  const dur = Math.round(220 + s * 460);
  layer.style.setProperty('--glitch-dur', `${dur}ms`);
  layer.style.opacity = String(0.25 + s * 0.75);
  layer.classList.remove('is-on');
  void layer.offsetWidth;                     // restart the animation
  layer.classList.add('is-on');

  if (peterEl && s > 0.25) {
    peterEl.classList.remove('is-glitching');
    void peterEl.offsetWidth;
    peterEl.classList.add('is-glitching');
    setTimeout(() => peterEl.classList.remove('is-glitching'), 460);
  }

  setTimeout(() => {
    layer.classList.remove('is-on');
    layer.style.opacity = '0';
    busy = false;
  }, dur + 40);
}

/** A single hard shake, used for refusals. */
export function shake() {
  if (motionOff() || !shellEl) return;
  shellEl.classList.remove('is-shaken');
  void shellEl.offsetWidth;
  shellEl.classList.add('is-shaken');
  setTimeout(() => shellEl.classList.remove('is-shaken'), 420);
}

/** Text-level chromatic jitter on any element. */
export function textGlitch(node) {
  if (motionOff() || !node) return;
  node.classList.remove('text-glitch');
  void node.offsetWidth;
  node.classList.add('text-glitch');
  setTimeout(() => node.classList.remove('text-glitch'), 560);
}

/** Occasional idle micro-glitch, scaled by the operator's intensity. */
export function startAmbientGlitch() {
  let timer = 0;
  const schedule = () => {
    clearTimeout(timer);
    const g = state.operator.glitch;
    if (g <= 0.02) { timer = setTimeout(schedule, 20000); return; }
    const wait = 22000 + Math.random() * 50000 * (1.2 - g);
    timer = setTimeout(() => {
      if (state.runtime.peterState === 'idle' && !document.hidden) burst(g * 0.45);
      schedule();
    }, wait);
  };
  schedule();
  return () => clearTimeout(timer);
}
