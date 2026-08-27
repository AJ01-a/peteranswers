/** SessionHistory.js — the running transcript for this sitting. */

import { el } from '../core/dom.js';
import { session } from '../engine/session.js';
import { on } from '../core/bus.js';

export class SessionHistory {
  constructor({ list, emptyEl, clearBtn, onClear }) {
    this.list = list;
    this.emptyEl = emptyEl;
    this.onClear = onClear;

    clearBtn?.addEventListener('click', () => {
      session.clear();
      this.onClear?.();
    });

    on('session:change', () => this.render());
    this.render();
  }

  render() {
    const entries = session.entries;
    this.list.innerHTML = '';

    if (!entries.length) {
      this.emptyEl.hidden = false;
      this.list.hidden = true;
      return;
    }
    this.emptyEl.hidden = true;
    this.list.hidden = false;

    const frag = document.createDocumentFragment();
    entries.forEach((entry, i) => {
      const refusal = entry.kind === 'refusal' || entry.kind === 'unavailable';
      frag.append(
        el('li', { class: `hist-item${refusal ? ' is-refusal' : ''}` }, [
          el('span', { class: 'hist-item__n mono', text: String(i + 1).padStart(2, '0') }),
          el('div', {}, [
            el('p', { class: 'hist-item__q', text: entry.question }),
            el('p', { class: 'hist-item__a', text: entry.answer }),
          ]),
        ])
      );
    });
    this.list.append(frag);
    this.list.scrollTop = this.list.scrollHeight;
  }
}
