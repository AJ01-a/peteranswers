/**
 * ProcessingSequence.js — the fake analysis readout.
 * Purely presentational: no data is inspected, fetched or stored.
 */

import { SEQUENCE_STEPS } from '../core/config.js';
import { el, sleep } from '../core/dom.js';

export class ProcessingSequence {
  constructor({ root, onStep }) {
    this.root = root;
    this.onStep = onStep;
    this.cancelled = false;
  }

  reset() {
    this.cancelled = false;
    this.root.innerHTML = '';
    this.root.hidden = true;
  }

  cancel() { this.cancelled = true; }

  /**
   * Runs the whole sequence, spending `totalMs` across the steps.
   * @param {number} totalMs
   * @param {{skip?:boolean}} [opts]
   */
  async run(totalMs, opts = {}) {
    this.reset();
    if (opts.skip) { await sleep(Math.min(totalMs, 700)); return; }

    this.root.hidden = false;
    const steps = SEQUENCE_STEPS;
    const weightSum = steps.reduce((a, s) => a + s.weight, 0);

    let previous = null;
    for (let i = 0; i < steps.length; i++) {
      if (this.cancelled) return;
      const step = steps[i];

      if (previous) {
        previous.node.classList.remove('is-active');
        previous.node.classList.add('is-done');
        previous.mark.textContent = '✓';
      }

      const mark = el('span', { class: 'seq-step__mark', 'aria-hidden': 'true', text: '›' });
      const node = el('div', { class: 'seq-step is-active' }, [
        mark,
        el('span', { text: step.label }),
        el('span', { class: 'seq-step__bar', 'aria-hidden': 'true' }),
      ]);
      this.root.append(node);
      this.onStep?.(step, i / steps.length);
      previous = { node, mark };

      // Uneven pacing: each step gets its weighted share, wobbled a little.
      const share = (step.weight / weightSum) * totalMs;
      const wobble = share * (0.72 + Math.random() * 0.56);
      await sleep(Math.max(180, wobble));
    }

    if (previous && !this.cancelled) {
      previous.node.classList.remove('is-active');
      previous.node.classList.add('is-done');
      previous.mark.textContent = '✓';
    }
  }

  hide() {
    this.root.hidden = true;
    this.root.innerHTML = '';
  }
}
