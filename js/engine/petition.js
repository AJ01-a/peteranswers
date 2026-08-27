/**
 * petition.js — THE CORE PETER ANSWERS MECHANIC.
 * =============================================================================
 * This is the original illusion, preserved and hardened. Nothing about the
 * secret is transmitted anywhere; it lives in this object for the length of
 * one question.
 *
 * How it works, exactly as the classic site does:
 *
 *   1. The petition field behaves like an ordinary text input. Anyone typing
 *      normally just types normally — the illusion is invisible.
 *
 *   2. The moment the operator types the TRIGGER character (default `.`), the
 *      field is ARMED. The trigger itself is swallowed: nothing appears.
 *
 *   3. While armed, every keystroke is intercepted. Instead of the typed
 *      character, the NEXT character of the petition sentence
 *      ("Peter, please answer the following question:") is written to the
 *      screen. To the audience it looks like the operator is simply typing
 *      the petition.
 *
 *   4. While armed AND capturing, the characters the operator actually typed
 *      are collected into the hidden answer. Typing the trigger a second time
 *      ends capture; from then on further keystrokes still spool out the
 *      petition text, so the operator can finish the sentence with any keys.
 *
 *   5. Backspace unwinds all of it symmetrically.
 *
 * Improvements over the original, none of which change the trick:
 *   - Works on touch keyboards (beforeinput + an input-diff reconciler),
 *     not just desktop keydown.
 *   - If the field already holds a prefix of the petition when the trigger
 *     fires, the sentence continues from there instead of restarting.
 *   - Paste is decomposed into individual characters.
 *   - The trigger character and petition sentence are configurable.
 * =============================================================================
 */

const NOOP = () => {};

/**
 * Repair a capture the operator never closed.
 *
 * If the second trigger is forgotten, capture stays open and every remaining
 * keystroke — the filler used to finish the petition sentence — is appended
 * to the answer. On screen the petition still looks perfect, so the mistake
 * is invisible until PETER answers "Danielqqqqqqqqqq".
 *
 * Filler is almost always one key held or mashed, or a short block repeated.
 * Both are stripped conservatively; anything less obvious is left alone for
 * the intelligent layer (or the operator) to judge.
 *
 * @param {string} secret
 * @returns {{text:string, trimmed:string, reason:string|null}}
 */
export function repairOpenCapture(secret) {
  const original = String(secret ?? '');
  let text = original;

  // 1 — a single character held down: "Danielqqqqqqqq"
  //     Four or more is required: no name ends in four identical letters.
  const run = text.match(/(.)\1{3,}$/);
  if (run) {
    const candidate = text.slice(0, text.length - run[0].length);
    if (candidate.trim()) {
      return {
        text: candidate.trimEnd(),
        trimmed: text.slice(candidate.length),
        reason: `removed ${run[0].length} repeated "${run[1]}" characters`,
      };
    }
  }

  // 2 — a short block typed over and over: "Danielasdasdasd"
  for (let size = 2; size <= 4; size++) {
    const rx = new RegExp(`((.{${size}}))\\1{2,}$`);
    const hit = text.match(rx);
    if (!hit) continue;
    const candidate = text.slice(0, text.length - hit[0].length);
    if (candidate.trim()) {
      return {
        text: candidate.trimEnd(),
        trimmed: hit[0],
        reason: `removed a repeated "${hit[1]}" block`,
      };
    }
  }

  return { text: original, trimmed: '', reason: null };
}

export class PetitionEngine {
  /**
   * @param {HTMLInputElement} input
   * @param {{getPetitionText:()=>string, getTrigger:()=>string, onChange?:Function}} opts
   */
  constructor(input, opts) {
    this.input = input;
    this.getPetitionText = opts.getPetitionText;
    this.getTrigger = opts.getTrigger;
    this.onChange = opts.onChange || NOOP;

    this.armed = false;
    this.capturing = false;
    this.secret = '';
    this.consumed = 0;         // petition characters already revealed
    this.display = '';         // authoritative visible value
    this.composing = false;
    this.lastCapture = null;

    this._bind();
  }

  /* ---------------------------------------------------------------- events */

  _bind() {
    const i = this.input;
    i.addEventListener('beforeinput', this._onBeforeInput);
    i.addEventListener('input', this._onInput);
    i.addEventListener('compositionstart', () => { this.composing = true; });
    i.addEventListener('compositionend', () => {
      this.composing = false;
    this.lastCapture = null;
      this._reconcile();
    });
    // Never let the caret sit mid-string while armed.
    i.addEventListener('click', this._pinCaret);
    i.addEventListener('keyup', this._pinCaret);
  }

  _pinCaret = () => {
    if (!this.armed) return;
    const end = this.input.value.length;
    try { this.input.setSelectionRange(end, end); } catch { /* ignore */ }
  };

  _onBeforeInput = (event) => {
    if (this.composing) return;
    const type = event.inputType;
    const trigger = this.getTrigger();

    // --- not armed: only the trigger is interesting -----------------------
    if (!this.armed) {
      if (type === 'insertText' && event.data === trigger) {
        event.preventDefault();
        this._arm();
        return;
      }
      return; // let the browser type normally
    }

    // --- armed: we own every mutation -------------------------------------
    event.preventDefault();

    switch (type) {
      case 'insertText':
      case 'insertCompositionText':
        for (const ch of event.data ?? '') this._insert(ch);
        break;
      case 'insertFromPaste':
      case 'insertFromDrop': {
        const text = event.dataTransfer?.getData('text') ?? '';
        for (const ch of text) this._insert(ch);
        break;
      }
      case 'insertLineBreak':
      case 'insertParagraph':
        break; // ignored; submission is handled by the form
      case 'deleteContentBackward':
      case 'deleteWordBackward':
      case 'deleteByCut':
        this._deleteBack();
        break;
      case 'deleteContentForward':
      case 'deleteWordForward':
        break;
      case 'historyUndo':
      case 'historyRedo':
        break;
      default:
        if (event.data) for (const ch of event.data) this._insert(ch);
    }

    this._flush();
  };

  /** Fallback path: some soft keyboards fire non-cancelable beforeinput. */
  _onInput = () => {
    if (this.composing) return;
    if (!this.armed) {
      // Ordinary typing: the browser owns the value, we just mirror it.
      // A trigger that slipped through a non-cancelable beforeinput is caught here.
      const trigger = this.getTrigger();
      const raw = this.input.value;
      const idx = raw.indexOf(trigger, this.display.length ? 0 : 0);
      if (idx !== -1 && raw.length > this.display.length) {
        this.display = raw.slice(0, idx) + raw.slice(idx + 1);
        this._arm();
        this._flush();
        return;
      }
      this.display = raw;
      this._emit();
      return;
    }
    this._reconcile();
  };

  /** Re-derive intent by diffing the DOM value against our model. */
  _reconcile() {
    const raw = this.input.value;
    if (raw === this.display) return;

    const a = this.display;
    const b = raw;
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let s = 0;
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;

    const removed = a.length - p - s;
    const inserted = b.slice(p, b.length - s);

    for (let n = 0; n < removed; n++) this._deleteBack();
    for (const ch of inserted) {
      if (!this.armed && ch === this.getTrigger()) this._arm();
      else this._insert(ch);
    }
    this._flush();
  }

  /* ---------------------------------------------------------------- model */

  _arm() {
    const petition = this.getPetitionText();
    this.armed = true;
    this.capturing = true;
    this.secret = '';
    // Continue the sentence if what's already typed is a prefix of it.
    const typed = this.display;
    this.consumed =
      typed.length && petition.toLowerCase().startsWith(typed.toLowerCase())
        ? typed.length
        : 0;
    if (this.consumed === 0 && typed.length) {
      // Not a prefix — keep the stray text, spool the petition after it.
      this.consumed = 0;
    }
    this._emit();
  }

  _insert(ch) {
    if (!this.armed) { this.display += ch; return; }

    const trigger = this.getTrigger();
    if (this.capturing && ch === trigger) {
      this.capturing = false;              // second trigger closes capture
      return;
    }
    if (this.capturing) {
      if (this.secret.length < 400) this.secret += ch;
    }

    const petition = this.getPetitionText();
    if (this.consumed < petition.length) {
      this.display += petition[this.consumed];
      this.consumed += 1;
    }
    // Petition exhausted → further keys are silently absorbed.
  }

  _deleteBack() {
    if (!this.armed) {
      this.display = this.display.slice(0, -1);
      return;
    }
    if (this.consumed > 0) {
      this.consumed -= 1;
      this.display = this.display.slice(0, -1);
      if (this.capturing) this.secret = this.secret.slice(0, -1);
      return;
    }
    // Nothing of the petition left → disarm and behave normally again.
    this.armed = false;
    this.capturing = false;
    this.secret = '';
    this.display = this.display.slice(0, -1);
  }

  _flush() {
    if (this.input.value !== this.display) this.input.value = this.display;
    this._pinCaret();
    this._emit();
  }

  _emit() {
    this.onChange(this.snapshot());
  }

  /* ---------------------------------------------------------------- public */

  snapshot() {
    const petition = this.getPetitionText();
    return {
      armed: this.armed,
      capturing: this.capturing,
      secret: this.secret.trim(),
      display: this.display,
      progress: petition.length ? Math.min(1, this.consumed / petition.length) : 0,
      complete: this.consumed >= petition.length,
      /** True while the closing trigger is still outstanding. */
      captureOpen: this.armed && this.capturing,
    };
  }

  /**
   * Take the captured secret and forget it.
   *
   * If capture is still open the closing trigger was never typed, so the tail
   * is filler rather than answer. It is repaired here, and the details are
   * left on `lastCapture` for the operator console to report.
   */
  takeSecret() {
    const raw = this.secret.trim();
    const wasOpen = this.capturing && this.armed;

    let text = raw;
    let repair = { text: raw, trimmed: '', reason: null };
    if (wasOpen && raw) {
      repair = repairOpenCapture(raw);
      text = repair.text;
    }

    this.lastCapture = {
      raw,
      text,
      wasOpen,
      trimmed: repair.trimmed,
      reason: repair.reason,
      repaired: repair.text !== raw,
    };

    this.secret = '';
    this.capturing = false;
    return text;
  }

  /**
   * Is the petition acceptable?
   * Lenient (default): any reasonable amount of text.
   * Strict: must actually match the petition sentence.
   */
  validate({ strict = false } = {}) {
    const petition = this.getPetitionText().trim().toLowerCase();
    const typed = this.display.trim();
    if (!typed) return { ok: false, reason: 'empty' };

    const lower = typed.toLowerCase();
    const isPrefix = petition.startsWith(lower) || lower.startsWith(petition);
    const ratio = petition.length ? Math.min(1, lower.length / petition.length) : 1;

    if (strict) {
      if (!isPrefix || ratio < 0.9) return { ok: false, reason: 'incomplete' };
      return { ok: true };
    }
    if (typed.length < 6) return { ok: false, reason: 'short' };
    return { ok: true };
  }

  reset({ keepText = false } = {}) {
    this.armed = false;
    this.capturing = false;
    this.secret = '';
    this.consumed = 0;
    if (!keepText) {
      this.display = '';
      this.input.value = '';
    }
    this._emit();
  }
}
