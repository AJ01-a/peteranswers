/**
 * VoiceManager.js — optional speech synthesis.
 * Degrades silently and completely on browsers without the API.
 */

const PREFERRED = [
  /google uk english male/i,
  /daniel/i,
  /google us english/i,
  /microsoft (guy|david|ryan)/i,
  /alex/i,
  /en-gb/i,
];

export class VoiceManager {
  constructor() {
    this.supported = typeof window !== 'undefined'
      && 'speechSynthesis' in window
      && typeof window.SpeechSynthesisUtterance === 'function';
    this.enabled = false;
    this.voice = null;
    this.rate = 0.82;
    this.pitch = 0.72;
    this.volume = 0.95;
    this._queue = [];
    this._speaking = false;

    if (this.supported) {
      this._loadVoices();
      try {
        window.speechSynthesis.addEventListener('voiceschanged', () => this._loadVoices());
      } catch { /* older engines */ }
      // Chrome pauses long utterances; a periodic nudge keeps it alive.
      this._keepAlive = setInterval(() => {
        const s = window.speechSynthesis;
        if (this._speaking && s.paused) { try { s.resume(); } catch { /* ignore */ } }
      }, 6000);
    }
  }

  _loadVoices() {
    if (!this.supported) return;
    let voices = [];
    try { voices = window.speechSynthesis.getVoices() || []; } catch { return; }
    if (!voices.length) return;

    const english = voices.filter((v) => /^en/i.test(v.lang || ''));
    const pool = english.length ? english : voices;

    for (const rx of PREFERRED) {
      const hit = pool.find((v) => rx.test(v.name) || rx.test(v.lang || ''));
      if (hit) { this.voice = hit; return; }
    }
    this.voice = pool[0] || null;
  }

  get voices() {
    if (!this.supported) return [];
    try { return window.speechSynthesis.getVoices() || []; } catch { return []; }
  }

  setVoiceByName(name) {
    const hit = this.voices.find((v) => v.name === name);
    if (hit) this.voice = hit;
    return Boolean(hit);
  }

  setEnabled(flag) {
    this.enabled = Boolean(flag) && this.supported;
    if (!this.enabled) this.cancel();
    return this.enabled;
  }

  /** Split on punctuation so Peter breathes between clauses. */
  _chunk(text) {
    return String(text)
      .split(/(?<=[.!?…,;:—-])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /**
   * @param {string} text
   * @param {{force?:boolean, onEnd?:Function}} [opts]
   */
  speak(text, opts = {}) {
    if (!this.supported) return false;
    if (!this.enabled && !opts.force) return false;
    const clean = String(text).trim();
    if (!clean) return false;

    this.cancel();
    const parts = this._chunk(clean);
    this._speaking = true;

    let index = 0;
    const next = () => {
      if (index >= parts.length) {
        this._speaking = false;
        opts.onEnd?.();
        return;
      }
      const u = new SpeechSynthesisUtterance(parts[index++]);
      if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; }
      u.rate = this.rate;
      u.pitch = this.pitch;
      u.volume = this.volume;
      u.onend = () => setTimeout(next, 180);
      u.onerror = () => { this._speaking = false; opts.onEnd?.(); };
      try { window.speechSynthesis.speak(u); }
      catch { this._speaking = false; opts.onEnd?.(); }
    };
    next();
    return true;
  }

  cancel() {
    if (!this.supported) return;
    this._speaking = false;
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  }

  destroy() {
    clearInterval(this._keepAlive);
    this.cancel();
  }
}
