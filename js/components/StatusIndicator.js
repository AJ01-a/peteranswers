/** StatusIndicator.js — the small connection readout (and a hidden way in). */

import { STATUS_TEXT } from '../core/config.js';
import { setRuntime } from '../core/state.js';

export class StatusIndicator {
  constructor({ root, label, onSecretUnlock }) {
    this.root = root;
    this.label = label;
    this.onSecretUnlock = onSecretUnlock;
    this._clicks = 0;
    this._timer = 0;

    // Hidden entry point: five deliberate taps on the status dot.
    this.root.addEventListener('click', () => {
      this._clicks += 1;
      clearTimeout(this._timer);
      this._timer = setTimeout(() => { this._clicks = 0; }, 900);
      if (this._clicks >= 5) {
        this._clicks = 0;
        this.onSecretUnlock?.();
      }
    });
  }

  set(stateName, text = null) {
    const key = STATUS_TEXT[stateName] ? stateName : 'connected';
    this.root.dataset.state = key;
    this.label.textContent = text || STATUS_TEXT[key];
    setRuntime({ status: key });
  }
}
