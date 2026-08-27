/**
 * PeterAvatar.js — Peter's body language.
 * States: idle | attentive | processing | answering | refusing | paused
 */

import { CAPTIONS } from '../core/config.js';
import { pickDistinct, prefersReducedMotion } from '../core/dom.js';
import { state, setRuntime } from '../core/state.js';

const MAX_GAZE = 3.2;   // SVG units the iris may travel

export class PeterAvatar {
  constructor({ root, iris, caption }) {
    this.root = root;
    this.iris = iris;
    this.caption = caption;
    this.state = 'idle';
    this.lastCaption = null;
    this.gaze = { x: 0, y: 0 };
    this.pointer = { x: 0.5, y: 0.5 };
    this._timers = new Set();

    this._bindPointer();
    this._scheduleBlink();
    this._scheduleWander();
  }

  /* --------------------------------------------------------------- timers */

  _later(fn, ms) {
    const id = setTimeout(() => { this._timers.delete(id); fn(); }, ms);
    this._timers.add(id);
    return id;
  }

  _motionOff() {
    return prefersReducedMotion() || state.prefs.reducedMotion || this.state === 'paused';
  }

  /* ----------------------------------------------------------------- gaze */

  _bindPointer() {
    const onMove = (e) => {
      const point = e.touches?.[0] || e;
      this.pointer.x = point.clientX / window.innerWidth;
      this.pointer.y = point.clientY / window.innerHeight;
      this._applyGaze();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('blur', () => { this.pointer = { x: 0.5, y: 0.5 }; this._applyGaze(); });
  }

  _applyGaze() {
    if (!this.iris) return;
    if (this._motionOff()) { this.iris.style.transform = ''; return; }

    const rect = this.root.getBoundingClientRect();
    const cx = (rect.left + rect.width / 2) / window.innerWidth;
    const cy = (rect.top + rect.height / 2) / window.innerHeight;

    let dx = (this.pointer.x - cx) * 2;
    let dy = (this.pointer.y - cy) * 2;
    const len = Math.hypot(dx, dy) || 1;
    if (len > 1) { dx /= len; dy /= len; }

    // Peter is coy when idle, direct when answering.
    const reach = this.state === 'answering' ? 0.35
      : this.state === 'processing' ? 0.55
      : this.state === 'attentive' ? 1 : 0.7;

    const x = (dx * MAX_GAZE + this.gaze.x) * reach;
    const y = (dy * MAX_GAZE * 0.75 + this.gaze.y) * reach;
    this.iris.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
  }

  /** Slow autonomous drift so Peter looks alive even without a pointer. */
  _scheduleWander() {
    const run = () => {
      if (!this._motionOff() && this.state !== 'answering') {
        const spread = this.state === 'processing' ? 2.2 : 1.3;
        this.gaze.x = (Math.random() - 0.5) * spread;
        this.gaze.y = (Math.random() - 0.5) * spread * 0.7;
        this._applyGaze();
      }
      this._later(run, 2200 + Math.random() * 3600);
    };
    this._later(run, 1500);
  }

  _scheduleBlink() {
    const run = () => {
      if (!this._motionOff() && this.state !== 'processing') this.blink();
      this._later(run, 3400 + Math.random() * 6200);
    };
    this._later(run, 2600);
  }

  blink() {
    if (this._motionOff()) return;
    this.root.dataset.blink = '1';
    setTimeout(() => { this.root.dataset.blink = '0'; }, 200);
  }

  /* ---------------------------------------------------------------- state */

  setState(next, { caption = true } = {}) {
    if (this.state === next) return;
    this.state = next;
    this.root.dataset.state = next;
    setRuntime({ peterState: next });
    if (caption) this.say(next);
    this._applyGaze();
  }

  /** Swap the caption line with a soft cross-fade. */
  say(key, explicit = null) {
    if (!this.caption) return;
    const pool = CAPTIONS[key] || CAPTIONS.idle;
    const line = explicit || pickDistinct(pool, this.lastCaption);
    if (line === this.caption.textContent) return;
    this.lastCaption = line;

    this.caption.classList.add('is-fading');
    setTimeout(() => {
      this.caption.textContent = line;
      this.caption.classList.remove('is-fading');
    }, 220);
  }

  destroy() {
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
  }
}
