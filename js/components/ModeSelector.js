/** ModeSelector.js — the channel rail. */

import { MODES, getMode } from '../core/config.js';
import { el } from '../core/dom.js';

export class ModeSelector {
  constructor({ rail, nameEl, hintEl, onChange }) {
    this.rail = rail;
    this.nameEl = nameEl;
    this.hintEl = hintEl;
    this.onChange = onChange;
    this.current = 'general';
    this.buttons = new Map();
    this._render();
  }

  _render() {
    const frag = document.createDocumentFragment();
    MODES.forEach((mode) => {
      const btn = el('button', {
        class: 'mode-chip',
        type: 'button',
        role: 'tab',
        id: `mode-${mode.id}`,
        'aria-selected': 'false',
        'data-mode': mode.id,
        text: mode.label,
        onclick: () => this.select(mode.id),
        onkeydown: (e) => this._nav(e, mode.id),
      });
      this.buttons.set(mode.id, btn);
      frag.append(btn);
    });
    this.rail.append(frag);
  }

  _nav(event, id) {
    const keys = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 };
    const step = keys[event.key];
    if (!step) return;
    event.preventDefault();
    const ids = MODES.map((m) => m.id);
    const next = ids[(ids.indexOf(id) + step + ids.length) % ids.length];
    this.buttons.get(next)?.focus();
    this.select(next);
  }

  /**
   * Bring a chip into view by scrolling the rail itself. `scrollIntoView`
   * is deliberately avoided: it also moves the document's sequential focus
   * navigation starting point, which silently skips the header in tab order.
   */
  _revealChip(btn, smooth) {
    const rail = this.rail;
    const left = btn.offsetLeft;
    const right = left + btn.offsetWidth;
    const viewLeft = rail.scrollLeft;
    const viewRight = viewLeft + rail.clientWidth;
    if (left >= viewLeft && right <= viewRight) return;
    const target = left < viewLeft ? left - 8 : right - rail.clientWidth + 8;
    rail.scrollTo({ left: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
  }

  select(id, { silent = false } = {}) {
    const mode = getMode(id);
    this.current = mode.id;

    for (const [key, btn] of this.buttons) {
      const on = key === mode.id;
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
      if (on) this._revealChip(btn, !silent);
    }

    document.documentElement.dataset.mode = mode.id;
    if (this.nameEl) this.nameEl.textContent = mode.label;
    if (this.hintEl) this.hintEl.textContent = mode.hint;

    if (!silent) this.onChange?.(mode);
  }
}
