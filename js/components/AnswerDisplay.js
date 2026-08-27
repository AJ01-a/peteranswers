/** AnswerDisplay.js — the reveal: typewriter, caret, emphasis. */

import { el, sleep, prefersReducedMotion } from '../core/dom.js';
import { state } from '../core/state.js';

export class AnswerDisplay {
  constructor({ root, textEl, metaLabel, metaTag, onType }) {
    this.root = root;
    this.textEl = textEl;
    this.metaLabel = metaLabel;
    this.metaTag = metaTag;
    this.onType = onType;
    this.caret = el('span', { class: 'caret is-hidden', 'aria-hidden': 'true' });
    this.textEl.after(this.caret);
    this._token = 0;
    this.current = '';
  }

  idle(message = 'Nothing has been asked yet.') {
    this._token++;
    this.current = '';
    this.root.classList.remove('is-revealed', 'is-refusal');
    this.textEl.classList.add('is-idle');
    this.textEl.textContent = message;
    this.metaLabel.textContent = 'Peter is silent';
    this.metaTag.hidden = true;
    this.caret.classList.add('is-hidden');
  }

  /** Shown while Peter is thinking. */
  thinking(message = 'Peter is silent…') {
    this._token++;
    this.root.classList.remove('is-revealed', 'is-refusal');
    this.textEl.classList.add('is-idle');
    this.textEl.textContent = message;
    this.metaLabel.textContent = 'Listening';
    this.metaTag.hidden = true;
    this.caret.classList.add('is-hidden');
  }

  /**
   * @param {string} text
   * @param {{kind?:string, tag?:string, typewriter?:boolean}} opts
   */
  async reveal(text, opts = {}) {
    const token = ++this._token;
    const kind = opts.kind || 'auto';
    const isRefusal = kind === 'refusal' || kind === 'unavailable';

    this.current = text;
    this.textEl.classList.remove('is-idle');
    this.root.classList.toggle('is-refusal', isRefusal);
    this.metaLabel.textContent = isRefusal ? 'Peter declines' : 'Peter has answered';
    if (opts.tag) { this.metaTag.hidden = false; this.metaTag.textContent = opts.tag; }
    else this.metaTag.hidden = true;

    const instant = opts.typewriter === false
      || prefersReducedMotion()
      || state.prefs.reducedMotion
      || !state.prefs.typewriter;

    if (instant) {
      this.textEl.textContent = text;
      this.caret.classList.add('is-hidden');
      this.root.classList.add('is-revealed');
      return;
    }

    this.textEl.textContent = '';
    this.caret.classList.remove('is-hidden');
    this.root.classList.add('is-revealed');

    const chars = [...text];
    for (let i = 0; i < chars.length; i++) {
      if (token !== this._token) return;            // superseded
      const ch = chars[i];
      this.textEl.textContent += ch;
      if (ch.trim()) this.onType?.(ch, i);

      // Human-ish cadence: slower after punctuation, quicker inside words.
      let delay = 26 + Math.random() * 34;
      if ('.…!?'.includes(ch)) delay += 320;
      else if (',;:—'.includes(ch)) delay += 140;
      else if (ch === ' ') delay += 12;
      await sleep(delay);
    }

    if (token !== this._token) return;
    await sleep(400);
    if (token === this._token) this.caret.classList.add('is-hidden');
  }

  stop() { this._token++; }
}
