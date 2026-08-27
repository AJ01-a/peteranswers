/**
 * OperatorConsole.js — the hidden control dashboard.
 *
 * Entirely client-side: it mutates local state only. There is no backdoor,
 * no server, and nothing about it is exposed in the public DOM until it is
 * opened (the panel is `hidden` and empty until first use).
 */

import { el, escapeHTML } from '../core/dom.js';
import { PERSONALITIES, MODES } from '../core/config.js';
import { state, setOperator, setPref, resetOperator } from '../core/state.js';
import { on } from '../core/bus.js';
import { session } from '../engine/session.js';

const TABS = [
  { id: 'answer', label: 'Answer' },
  { id: 'mind', label: 'Mind' },
  { id: 'effects', label: 'Effects' },
  { id: 'system', label: 'System' },
  { id: 'keys', label: 'Keys' },
];

const AI_STATE_LABEL = {
  unknown: 'Not checked',
  checking: 'Checking…',
  online: 'Online',
  offline: 'Offline',
  model_unavailable: 'Model unavailable',
  no_backend: 'No backend',
};

export class OperatorConsole {
  constructor(opts) {
    this.root = opts.root;
    this.handlers = opts;
    this.built = false;
    this.open = false;
    this.tab = 'answer';
    this.fields = {};
    this.ai = {};
    this._lastFocus = null;

    on('operator:change', () => this.sync());
    on('prefs:change', () => this.sync());
    on('runtime:change', () => this.syncReadout());
    on('session:change', () => this.syncReadout());
  }

  /* ------------------------------------------------------------- building */

  _field(labelText, control, valueEl = null) {
    return el('label', { class: 'op-field' }, [
      el('span', { class: 'op-field__label' }, [
        el('span', { text: labelText }),
        valueEl,
      ]),
      control,
    ]);
  }

  _group(title, children) {
    return el('div', { class: 'op-group' }, [
      el('div', { class: 'op-group__title', text: title }),
      ...children,
    ]);
  }

  _toggle(key, label, hint, source = 'operator') {
    const btn = el('button', {
      class: 'switch',
      type: 'button',
      role: 'switch',
      'aria-label': label,
      'aria-checked': String(Boolean(state[source][key])),
      onclick: () => {
        const next = !state[source][key];
        if (source === 'operator') setOperator({ [key]: next });
        else setPref({ [key]: next });
        this.handlers.onToggle?.(key, next, source);
      },
    });
    this.fields[`${source}.${key}`] = btn;
    return el('div', { class: 'op-toggle' }, [
      el('div', {}, [
        el('div', { class: 'op-toggle__label', text: label }),
        hint ? el('div', { class: 'op-toggle__hint', text: hint }) : null,
      ]),
      btn,
    ]);
  }

  _range(key, label, { min, max, step, format }) {
    const value = el('span', { class: 'op-field__val', text: format(state.operator[key]) });
    const input = el('input', {
      class: 'op-range',
      type: 'range',
      min, max, step,
      value: state.operator[key],
      'aria-label': label,
      oninput: (e) => {
        const v = Number(e.target.value);
        setOperator({ [key]: v });
        value.textContent = format(v);
        e.target.style.setProperty('--pct', `${((v - min) / (max - min)) * 100}%`);
        this.handlers.onRange?.(key, v);
      },
    });
    input.style.setProperty('--pct', `${((state.operator[key] - min) / (max - min)) * 100}%`);
    this.fields[`range.${key}`] = input;
    this.fields[`rangeval.${key}`] = value;
    this.fields[`rangefmt.${key}`] = { min, max, format };
    return this._field(label, input, value);
  }

  build() {
    if (this.built) return;
    this.built = true;
    const r = this.root;
    r.innerHTML = '';

    /* -------- head -------- */
    r.append(
      el('header', { class: 'op__head' }, [
        el('span', { class: 'op__title', text: 'Peter Operator Console' }),
        el('button', {
          class: 'op__close', type: 'button', 'aria-label': 'Close operator console',
          text: '×', onclick: () => this.close(),
        }),
      ])
    );

    /* -------- tabs -------- */
    const tabBar = el('div', { class: 'op__tabs', role: 'tablist', 'aria-label': 'Operator sections' });
    this.tabButtons = new Map();
    for (const t of TABS) {
      const btn = el('button', {
        class: 'op__tab', type: 'button', role: 'tab',
        id: `op-tab-${t.id}`, 'aria-controls': `op-pane-${t.id}`,
        'aria-selected': String(t.id === this.tab),
        text: t.label,
        onclick: () => this.setTab(t.id),
      });
      this.tabButtons.set(t.id, btn);
      tabBar.append(btn);
    }
    r.append(tabBar);

    /* -------- body -------- */
    const body = el('div', { class: 'op__body' });
    this.panes = new Map();

    body.append(this._buildAnswerPane());
    body.append(this._buildMindPane());
    body.append(this._buildEffectsPane());
    body.append(this._buildSystemPane());
    body.append(this._buildKeysPane());
    r.append(body);

    /* -------- foot -------- */
    this.footState = el('span', { text: 'idle' });
    r.append(
      el('footer', { class: 'op__foot' }, [
        el('span', { text: 'Local only' }),
        this.footState,
      ])
    );

    this.setTab(this.tab);
    this.sync();
    this.syncReadout();
  }

  _pane(id, children) {
    const pane = el('div', {
      class: 'op__pane', id: `op-pane-${id}`, role: 'tabpanel',
      'aria-labelledby': `op-tab-${id}`, tabindex: '0',
    }, children);
    pane.hidden = id !== this.tab;
    this.panes.set(id, pane);
    return pane;
  }

  /* --------------------------------------------------------------- panes */


  /* ------------------------------------------------- intelligent layer -- */

  _aiStatusStrip({ compact = false } = {}) {
    const dot = el('span', { class: 'ai-dot', 'data-state': 'unknown', text: AI_STATE_LABEL.unknown });
    const model = el('span', { class: 'ai-strip__val is-empty', text: 'none' });

    const rows = [
      el('div', { class: 'ai-strip__row' }, [el('span', { text: 'PETER' }), dot]),
      el('div', { class: 'ai-strip__row' }, [el('span', { text: 'Model' }), model]),
    ];

    let meter = null;
    let meterFill = null;
    let meterValue = null;
    if (!compact) {
      meterFill = el('div', { class: 'ai-meter__fill' });
      meterValue = el('b', { text: '—' });
      meter = el('div', { class: 'ai-meter' }, [
        el('div', { class: 'ai-meter__track' }, [meterFill]),
        el('div', { class: 'ai-meter__caption' }, [
          el('span', { text: 'Confidence' }), meterValue,
        ]),
      ]);
      rows.push(meter);
    }

    const strip = el('div', { class: 'ai-strip' }, rows);
    const handle = { strip, dot, model, meter, meterFill, meterValue };
    (this.ai.strips ||= []).push(handle);
    return strip;
  }

  /** Render a suggestion, or clear the panel when given null. */
  showCorrection(result) {
    const host = this.ai.fixHost;
    if (!host) return;
    host.innerHTML = '';
    if (!result) return;

    const needsEdit = Boolean(result.needs_edit);
    const needsConfirm = Boolean(result.needs_confirmation);
    const tone = needsEdit ? 'edit' : needsConfirm ? 'confirm' : 'applied';

    const head = needsEdit
      ? "PETER couldn't confidently determine what you intended"
      : needsConfirm
        ? 'PETER noticed a possible correction'
        : result.status === 'valid'
          ? 'PETER found nothing to fix'
          : 'PETER corrected this for you';

    const kids = [el('div', { class: 'ai-fix__head', text: head })];

    if (!needsEdit && result.corrected !== result.original) {
      kids.push(
        el('div', { class: 'ai-fix__pair' }, [
          el('span', { class: 'ai-fix__label', text: 'Original' }),
          el('div', { class: 'ai-fix__text ai-fix__text--was', text: result.original }),
        ]),
        el('div', { class: 'ai-fix__pair' }, [
          el('span', { class: 'ai-fix__label', text: needsConfirm ? 'Suggested' : 'Applied' }),
          el('div', { class: 'ai-fix__text ai-fix__text--now', text: result.corrected }),
        ])
      );
    }

    if (result.changes?.length) {
      kids.push(el('ul', { class: 'ai-fix__changes' },
        result.changes.slice(0, 6).map((c) => el('li', { text: c }))));
    }
    if (result.notes?.length) {
      kids.push(el('ul', { class: 'ai-notes' },
        result.notes.slice(0, 4).map((n) => el('li', { text: n }))));
    }

    if (needsEdit) {
      kids.push(el('div', { class: 'op-btns op-btns--full' }, [
        el('button', {
          class: 'op-btn', type: 'button', text: 'Edit input',
          onclick: () => { this.showCorrection(null); this.fields.secret?.focus(); },
        }),
      ]));
    } else if (needsConfirm) {
      kids.push(el('div', { class: 'op-btns' }, [
        el('button', {
          class: 'op-btn op-btn--primary', type: 'button', text: 'Accept correction',
          onclick: () => this.handlers.onAcceptCorrection?.(result),
        }),
        el('button', {
          class: 'op-btn', type: 'button', text: 'Keep original',
          onclick: () => this.handlers.onKeepOriginal?.(result),
        }),
      ]));
    }

    host.append(el('div', { class: 'ai-fix', 'data-tone': tone }, kids));
  }

  /** Reflect backend status in every strip that is on screen. */
  setAIStatus(status) {
    const label = AI_STATE_LABEL[status.status] || AI_STATE_LABEL.unknown;
    for (const s of this.ai.strips || []) {
      s.dot.dataset.state = status.status;
      s.dot.textContent = label;
      const name = status.model || (status.wanted ? `${status.wanted} (missing)` : '');
      s.model.textContent = name || 'none';
      s.model.classList.toggle('is-empty', !name);
    }
    if (this.ai.modelSelect) this._fillModelSelect(status);
    if (this.ai.detail) {
      this.ai.detail.textContent =
        status.status === 'no_backend'
          ? 'Serving as static files — start the backend to enable PETER.'
          : status.status === 'offline'
            ? 'Ollama is not answering. PETER runs on its own engine.'
            : status.status === 'model_unavailable'
              ? `Ollama is up but "${status.wanted || 'the model'}" is not installed.`
              : status.status === 'online'
                ? `Responded in ${status.latencyMs} ms.`
                : '';
    }
  }

  setConfidence(value) {
    const pct = value == null ? null : Math.round(Math.max(0, Math.min(1, value)) * 100);
    for (const s of this.ai.strips || []) {
      if (!s.meter) continue;
      s.meterFill.style.width = pct == null ? '0%' : `${pct}%`;
      s.meterValue.textContent = pct == null ? '—' : `${pct}%`;
      s.meter.dataset.band = pct == null ? 'none' : pct >= 95 ? 'high' : pct >= 70 ? 'mid' : 'low';
    }
  }

  _fillModelSelect(status) {
    const sel = this.ai.modelSelect;
    if (!sel) return;
    const current = state.operator.model || '';
    sel.innerHTML = '';
    sel.append(el('option', { value: '', text: 'Auto (first suitable)' }));
    for (const name of status.models || []) {
      sel.append(el('option', { value: name, text: name, selected: name === status.model || undefined }));
    }
    if (current && !(status.models || []).includes(current)) {
      sel.append(el('option', { value: current, text: `${current} (not installed)`, selected: true }));
    }
    sel.disabled = !(status.models || []).length;
  }

  _buildMindPane() {
    this.ai.detail = el('p', { class: 'op-note', text: '' });
    this.ai.modelSelect = el('select', {
      class: 'op-select', 'aria-label': 'Model',
      disabled: true,
      onchange: (e) => this.handlers.onModelPick?.(e.target.value),
    }, [el('option', { value: '', text: 'Auto (first suitable)' })]);

    return this._pane('mind', [
      this._group('Connection', [
        this._aiStatusStrip(),
        this.ai.detail,
        el('div', { class: 'op-btns' }, [
          el('button', { class: 'op-btn', type: 'button', text: 'Re-check', onclick: () => this.handlers.onRecheck?.() }),
          el('button', { class: 'op-btn', type: 'button', text: 'Check input', onclick: () => this.handlers.onCheck?.() }),
        ]),
      ]),

      this._group('Model', [
        this._field('Preferred model', this.ai.modelSelect),
        el('p', { class: 'op-note', html:
          'Pin a model here for this browser, or set <code>OLLAMA_MODEL</code> in <code>.env</code> ' +
          'to fix it for everyone. Auto picks the first suitable model that is installed.' }),
      ]),

      this._group('Behaviour', [
        this._toggle('aiValidation', 'Validation',
          'Check the secret answer and petition before they are used.'),
        this._toggle('aiAutoCorrect', 'Auto-correction',
          'Apply corrections silently when confidence is at least 95%.'),
        this._toggle('aiPresentation', 'Response wording',
          'Let PETER phrase the answer he has already decided.'),
      ]),

      this._group('Rules', [
        el('p', { class: 'op-note', text:
          'PETER may repair spelling, spacing, duplicated words and punctuation. He may never ' +
          'change a name into a different name, alter a number, reword your meaning, or invent ' +
          'an answer. Anything that would do so is discarded and your original is kept.' }),
        el('p', { class: 'op-note', text:
          'When the wording layer is on, the answer you supplied still appears verbatim. If PETER ' +
          'drifts, the wording is thrown away and the plain answer is shown instead.' }),
      ]),
    ]);
  }

  _buildAnswerPane() {
    this.fields.target = el('input', {
      class: 'op-input', type: 'text', placeholder: 'Sarah', autocomplete: 'off',
      value: state.operator.target, 'aria-label': 'Target name',
      oninput: (e) => setOperator({ target: e.target.value }),
    });

    this.fields.secret = el('input', {
      class: 'op-input', type: 'text', placeholder: 'Daniel', autocomplete: 'off',
      value: state.operator.secretAnswer, 'aria-label': 'Secret answer',
      oninput: (e) => setOperator({ secretAnswer: e.target.value }),
      onkeydown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.handlers.onSend?.(); }
      },
    });

    this.fields.petitionAnswer = el('input', {
      class: 'op-input', type: 'text', autocomplete: 'off',
      value: state.operator.petitionText, 'aria-label': 'PETER petition',
      oninput: (e) => setOperator({ petitionText: e.target.value }),
    });

    this.ai.fixHost = el('div', {});

    this.fields.personality = el('select', {
      class: 'op-select', 'aria-label': 'Response style',
      onchange: (e) => setOperator({ personality: e.target.value }),
    }, Object.entries(PERSONALITIES).map(([id, p]) =>
      el('option', { value: id, text: p.label, selected: state.operator.personality === id || undefined })));

    this.fields.responseType = el('select', {
      class: 'op-select', 'aria-label': 'Response type',
      onchange: (e) => setOperator({ responseType: e.target.value }),
    }, [
      el('option', { value: 'normal', text: 'Normal' }),
      el('option', { value: 'yes', text: 'Force yes' }),
      el('option', { value: 'no', text: 'Force no' }),
      el('option', { value: 'refusal', text: 'Force refusal' }),
    ]);

    this.fields.modeSelect = el('select', {
      class: 'op-select', 'aria-label': 'Channel',
      onchange: (e) => this.handlers.onModeChange?.(e.target.value),
    }, MODES.map((m) => el('option', { value: m.id, text: m.label })));

    this.readout = {
      root: el('div', { class: 'op-readout' }),
      queued: el('span', { class: 'op-readout__v is-empty', text: 'none' }),
      captured: el('span', { class: 'op-readout__v is-empty', text: 'none' }),
      question: el('span', { class: 'op-readout__v is-empty', text: '—' }),
      peter: el('span', { class: 'op-readout__v', text: 'idle' }),
      capture: el('span', { class: 'op-readout__v is-empty', text: 'closed' }),
    };
    this.readout.root.append(
      el('div', { class: 'op-readout__row' }, [el('span', { class: 'op-readout__k', text: 'Queued' }), this.readout.queued]),
      el('div', { class: 'op-readout__row' }, [el('span', { class: 'op-readout__k', text: 'From petition' }), this.readout.captured]),
      el('div', { class: 'op-readout__row' }, [el('span', { class: 'op-readout__k', text: 'Capture' }), this.readout.capture]),
      el('div', { class: 'op-readout__row' }, [el('span', { class: 'op-readout__k', text: 'Question' }), this.readout.question]),
      el('div', { class: 'op-readout__row' }, [el('span', { class: 'op-readout__k', text: 'Peter' }), this.readout.peter])
    );

    return this._pane('answer', [
      this._group('Response', [
        this._field('Target', this.fields.target),
        this._field('Secret answer', this.fields.secret),
        this._field('PETER petition', this.fields.petitionAnswer),
        this._aiStatusStrip({ compact: true }),
        el('div', { class: 'op-btns' }, [
          el('button', {
            class: 'op-btn', type: 'button', text: 'Check with PETER',
            onclick: () => this.handlers.onCheck?.(),
          }),
          el('button', {
            class: 'op-btn', type: 'button', text: 'Check petition',
            onclick: () => this.handlers.onCheck?.('petition'),
          }),
        ]),
        this.ai.fixHost,
        this._field('Response style', this.fields.personality),
        this._field('Response type', this.fields.responseType),
        this._field('Channel', this.fields.modeSelect),
      ]),

      this._group('Timing', [
        this._range('delay', 'Delay', { min: 0, max: 20, step: 0.1, format: (v) => `${Number(v).toFixed(1)} s` }),
        this._range('delayJitter', 'Natural variation', { min: 0, max: 8, step: 0.1, format: (v) => `± ${Number(v).toFixed(1)} s` }),
        this._toggle('autoRespond', 'Automatic response',
          'Off = Peter waits until you press Send answer.'),
      ]),

      this._group('Live', [this.readout.root]),

      el('div', { class: 'op-btns op-btns--sticky' }, [
        el('button', { class: 'op-btn op-btn--primary', type: 'button', text: 'Send answer', onclick: () => this.handlers.onSend?.() }),
        el('button', { class: 'op-btn', type: 'button', text: 'Clear answer', onclick: () => this.handlers.onClearAnswer?.() }),
        el('button', { class: 'op-btn', type: 'button', text: 'Trigger glitch', onclick: () => this.handlers.onGlitch?.() }),
        el('button', { class: 'op-btn op-btn--danger', type: 'button', text: 'Trigger refusal', onclick: () => this.handlers.onRefuse?.() }),
      ]),
    ]);
  }

  _buildEffectsPane() {
    this.fields.pauseBtn = el('button', {
      class: 'op-btn op-btn--danger', type: 'button',
      'aria-pressed': String(state.operator.paused),
      text: state.operator.paused ? 'Resume Peter' : 'Pause Peter',
      onclick: () => this.handlers.onPauseToggle?.(),
    });

    return this._pane('effects', [
      this._group('Output', [
        this._toggle('voice', "Peter's voice", 'Speech synthesis, if the browser has it.'),
        this._toggle('ambient', 'Ambient sound', 'Low room tone plus interface cues.'),
      ]),

      this._group('Presentation', [
        this._toggle('typewriter', 'Typewriter reveal', 'Answers type themselves out.', 'prefs'),
        this._toggle('sequence', 'Analysis sequence', 'Show the thinking steps.', 'prefs'),
        this._toggle('reducedMotion', 'Reduce motion', 'Overrides all ambient animation.', 'prefs'),
      ]),

      this._group('Intensity', [
        this._range('glitch', 'Glitch intensity', { min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` }),
        this._range('animation', 'Peter animation', { min: 0, max: 1.5, step: 0.05, format: (v) => `${Math.round(v * 100)}%` }),
        this._range('refusalChance', 'Spontaneous refusal', { min: 0, max: 0.5, step: 0.01, format: (v) => `${Math.round(v * 100)}%` }),
      ]),

      this._group('Peter', [
        el('div', { class: 'op-btns op-btns--full' }, [this.fields.pauseBtn]),
        el('p', { class: 'op-note', text: 'Paused: Peter stops animating and refuses every question with “Peter is unavailable.”' }),
      ]),
    ]);
  }

  _buildSystemPane() {
    this.fields.petitionText = el('input', {
      class: 'op-input', type: 'text', autocomplete: 'off',
      value: state.operator.petitionText, 'aria-label': 'Petition sentence',
      oninput: (e) => setOperator({ petitionText: e.target.value }),
    });
    this.fields.trigger = el('input', {
      class: 'op-input', type: 'text', maxlength: '1', autocomplete: 'off',
      value: state.operator.trigger, 'aria-label': 'Trigger character',
      style: 'max-width:76px;text-align:center',
      oninput: (e) => setOperator({ trigger: e.target.value || '.' }),
    });
    this.fields.shortcut = el('input', {
      class: 'op-input', type: 'text', autocomplete: 'off',
      value: state.operator.shortcut, 'aria-label': 'Console shortcut',
      placeholder: 'ctrl+shift+p',
      oninput: (e) => setOperator({ shortcut: e.target.value }),
    });

    return this._pane('system', [
      this._group('Mechanic', [
        this._field('Petition sentence', this.fields.petitionText),
        this._field('Trigger character', this.fields.trigger),
        this._toggle('strictPetition', 'Strict petition',
          'Refuse unless the petition sentence is actually finished.'),
        el('p', {
          class: 'op-note',
          html: `Type <code>${escapeHTML(state.operator.trigger)}</code> in the petition field to arm it, ` +
                `then type the answer, then <code>${escapeHTML(state.operator.trigger)}</code> again. ` +
                `Keep typing anything to finish the sentence.`,
        }),
      ]),

      this._group('Memory', [
        this._toggle('sessionMemory', 'Session memory', 'Peter follows up on earlier questions.'),
        el('div', { class: 'op-btns' }, [
          el('button', { class: 'op-btn', type: 'button', text: 'Reset session', onclick: () => this.handlers.onResetSession?.() }),
          el('button', { class: 'op-btn', type: 'button', text: 'Clear all state', onclick: () => this.handlers.onHardReset?.() }),
        ]),
      ]),

      this._group('Console', [
        this._field('Open shortcut', this.fields.shortcut),
        el('div', { class: 'op-btns' }, [
          el('button', { class: 'op-btn', type: 'button', text: 'Restore defaults', onclick: () => { resetOperator(); this.rebuildNotes(); } }),
          el('button', { class: 'op-btn', type: 'button', text: 'Close console', onclick: () => this.close() }),
        ]),
      ]),
    ]);
  }

  _buildKeysPane() {
    const rows = [
      ['Open / close this console', state.operator.shortcut.toUpperCase().replace(/\+/g, ' + ')],
      ['Close this console', 'ESC'],
      ['Send the queued answer', 'CTRL + ENTER'],
      ['Reset the session', 'CTRL + SHIFT + R'],
      ['Trigger a glitch', 'CTRL + SHIFT + G'],
      ['Trigger a refusal', 'CTRL + SHIFT + X'],
      ['Pause / resume Peter', 'CTRL + SHIFT + Z'],
      ['Ask (from the question box)', 'ENTER'],
      ['Newline in the question box', 'SHIFT + ENTER'],
      ['Open the console without a keyboard', 'Tap the status dot ×5'],
    ];
    this.keysList = el('div', { class: 'op-keys' },
      rows.map(([what, key]) => el('div', { class: 'op-key' }, [
        el('span', { text: what }),
        el('kbd', { text: key }),
      ])));

    return this._pane('keys', [
      this._group('Shortcuts', [this.keysList]),
      this._group('The mechanic', [
        el('p', { class: 'op-note', html:
          'The petition field is the trick. Typing the trigger character arms it; ' +
          'from then on every key you press prints the <em>next letter of the petition sentence</em> ' +
          'instead of what you typed, while the letters you actually pressed are collected as the ' +
          'secret answer. A second trigger ends the capture, so you can finish the sentence with any keys. ' +
          'Backspace unwinds it. Nothing leaves the browser.' }),
        el('p', { class: 'op-note', html:
          'Prefer not to type it live? Put the answer in <strong>Secret answer</strong> above and it will be used ' +
          'for the next question.' }),
      ]),
      this._group('House rules', [
        el('p', { class: 'op-note', text:
          'Peter is an entertainment illusion. He has no supernatural ability and no access to anyone’s data. ' +
          'Keep the answers harmless — no threats, no claims about real private information, and no targeting people who did not opt in.' }),
      ]),
    ]);
  }

  /** Petition/trigger notes mention live values, so refresh them on change. */
  rebuildNotes() {
    if (!this.built) return;
    this.fields.petitionText.value = state.operator.petitionText;
    if (this.fields.petitionAnswer) this.fields.petitionAnswer.value = state.operator.petitionText;
    this.fields.trigger.value = state.operator.trigger;
    this.fields.shortcut.value = state.operator.shortcut;
    this.sync();
  }

  /* --------------------------------------------------------------- state */

  setTab(id) {
    this.tab = id;
    for (const [key, btn] of this.tabButtons) btn.setAttribute('aria-selected', String(key === id));
    for (const [key, pane] of this.panes) pane.hidden = key !== id;
  }

  sync() {
    if (!this.built) return;
    const o = state.operator;
    if (this.fields.target && document.activeElement !== this.fields.target) this.fields.target.value = o.target;
    if (this.fields.secret && document.activeElement !== this.fields.secret) this.fields.secret.value = o.secretAnswer;
    // The petition is editable from two tabs; keep them in step.
    for (const key of ['petitionAnswer', 'petitionText']) {
      const node = this.fields[key];
      if (node && document.activeElement !== node) node.value = o.petitionText;
    }
    if (this.fields.personality) this.fields.personality.value = o.personality;
    if (this.fields.responseType) this.fields.responseType.value = o.responseType;
    if (this.fields.modeSelect) this.fields.modeSelect.value = state.prefs.mode;

    for (const key of ['delay', 'delayJitter', 'glitch', 'animation', 'refusalChance']) {
      const input = this.fields[`range.${key}`];
      const label = this.fields[`rangeval.${key}`];
      const meta = this.fields[`rangefmt.${key}`];
      if (!input || !meta) continue;
      if (document.activeElement !== input) input.value = o[key];
      label.textContent = meta.format(o[key]);
      input.style.setProperty('--pct', `${((o[key] - meta.min) / (meta.max - meta.min)) * 100}%`);
    }

    for (const [key, sw] of Object.entries(this.fields)) {
      if (!key.startsWith('operator.') && !key.startsWith('prefs.')) continue;
      const [source, prop] = key.split('.');
      sw.setAttribute('aria-checked', String(Boolean(state[source][prop])));
    }

    if (this.fields.pauseBtn) {
      this.fields.pauseBtn.textContent = o.paused ? 'Resume Peter' : 'Pause Peter';
      this.fields.pauseBtn.setAttribute('aria-pressed', String(o.paused));
    }
  }

  syncReadout() {
    if (!this.built || !this.readout) return;
    const put = (node, value, empty) => {
      node.textContent = value || empty;
      node.classList.toggle('is-empty', !value);
    };
    put(this.readout.queued, state.operator.secretAnswer, 'none');
    put(this.readout.captured, state.runtime.secretFromPetition, 'none');

    // Live capture state, then the verdict on the last one taken.
    const live = this.handlers.getCaptureState?.();
    const diag = state.runtime.captureDiagnosis;
    let captureText = 'closed';
    let captureWarn = false;
    if (live?.captureOpen) {
      captureText = 'OPEN — closing trigger not typed yet';
      captureWarn = true;
    } else if (diag?.wasOpen) {
      captureText = diag.repaired
        ? `left open · trimmed "${diag.trimmed || '…'}"`
        : 'left open · nothing to trim';
      captureWarn = true;
    }
    this.readout.capture.textContent = captureText;
    this.readout.capture.classList.toggle('is-empty', !captureWarn);
    this.readout.capture.style.color = captureWarn ? 'var(--warn)' : '';
    put(this.readout.question, state.runtime.lastQuestion, '—');
    this.readout.peter.textContent = state.runtime.peterState;
    if (this.footState) {
      this.footState.textContent =
        `${state.runtime.peterState} · ${session.length} in memory`;
    }
  }

  /* ---------------------------------------------------------------- open */

  toggle() { this.open ? this.close() : this.show(); }

  show() {
    this.build();
    this._lastFocus = document.activeElement;
    this.root.hidden = false;
    // next frame so the transform transition actually runs
    requestAnimationFrame(() => {
      this.root.classList.add('is-open');
      this.open = true;
      this.rebuildNotes();
      this.syncReadout();
      this.fields.secret?.focus({ preventScroll: true });
    });
    this.handlers.onOpen?.();
  }

  close() {
    if (!this.built) { this.root.hidden = true; this.open = false; return; }
    this.root.classList.remove('is-open');
    this.open = false;
    const done = () => { this.root.hidden = true; };
    setTimeout(done, 420);
    try { this._lastFocus?.focus?.({ preventScroll: true }); } catch { /* ignore */ }
    this.handlers.onClose?.();
  }
}
