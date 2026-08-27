/** SettingsPanel.js — audience-facing preferences (all local). */

import { el } from '../core/dom.js';
import { state, setPref } from '../core/state.js';
import { on } from '../core/bus.js';

export class SettingsPanel {
  constructor({ root, rows, toggleBtn, voice, onChange }) {
    this.root = root;
    this.rowsEl = rows;
    this.toggleBtn = toggleBtn;
    this.voice = voice;
    this.onChange = onChange;
    this.switches = new Map();

    this.definitions = [
      { key: 'ambient', label: 'Ambient sound', desc: 'A low room tone. Starts only when you switch it on.' },
      { key: 'voice', label: "Peter's voice", desc: this.voice?.supported ? 'Speaks each answer aloud.' : 'Not supported in this browser.', disabled: !this.voice?.supported },
      { key: 'typewriter', label: 'Typewriter reveal', desc: 'Answers appear one character at a time.' },
      { key: 'sequence', label: 'Analysis sequence', desc: 'Show the steps while Peter thinks.' },
      { key: 'reducedMotion', label: 'Reduce motion', desc: 'Calms the background, glow and glitches.' },
    ];

    this._render();

    toggleBtn?.addEventListener('click', () => this.toggle());
    on('prefs:change', () => this.sync());
  }

  _render() {
    const frag = document.createDocumentFragment();
    for (const def of this.definitions) {
      const sw = el('button', {
        class: 'switch',
        type: 'button',
        role: 'switch',
        'aria-checked': String(Boolean(state.prefs[def.key])),
        'aria-label': def.label,
        disabled: def.disabled || undefined,
        onclick: () => {
          if (def.disabled) return;
          setPref({ [def.key]: !state.prefs[def.key] });
          this.onChange?.(def.key, state.prefs[def.key]);
        },
      });
      this.switches.set(def.key, sw);

      frag.append(
        el('div', { class: 'setting-row' }, [
          el('div', {}, [
            el('div', { class: 'setting-row__label', text: def.label }),
            el('div', { class: 'setting-row__desc', text: def.desc }),
          ]),
          sw,
        ])
      );
    }

    if (this.voice?.supported) {
      const select = el('select', {
        class: 'op-select',
        'aria-label': "Peter's voice",
        style: 'max-width:190px',
        onchange: (e) => this.voice.setVoiceByName(e.target.value),
      });
      const fill = () => {
        const voices = this.voice.voices.filter((v) => /^en/i.test(v.lang || ''));
        const pool = voices.length ? voices : this.voice.voices;
        select.innerHTML = '';
        for (const v of pool.slice(0, 24)) {
          select.append(el('option', { value: v.name, text: `${v.name}`, selected: this.voice.voice?.name === v.name || undefined }));
        }
        if (!pool.length) select.append(el('option', { text: 'System default' }));
      };
      fill();
      setTimeout(fill, 800);

      frag.append(
        el('div', { class: 'setting-row' }, [
          el('div', {}, [
            el('div', { class: 'setting-row__label', text: 'Voice' }),
            el('div', { class: 'setting-row__desc', text: 'Which system voice Peter uses.' }),
          ]),
          select,
        ])
      );
    }

    this.rowsEl.append(frag);
  }

  sync() {
    for (const [key, sw] of this.switches) {
      sw.setAttribute('aria-checked', String(Boolean(state.prefs[key])));
    }
  }

  toggle(force) {
    const open = force ?? this.root.hidden;
    this.root.hidden = !open;
    this.toggleBtn?.setAttribute('aria-expanded', String(open));
    if (open) this.root.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}
