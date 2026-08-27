/**
 * session.js — conversation memory for one sitting.
 *
 * Stored in sessionStorage so it survives a refresh but dies with the tab.
 * Only the question text, the answer text and a timestamp are kept; nothing
 * is transmitted anywhere.
 */

import { STORAGE_KEYS } from '../core/config.js';
import { ephemeral } from '../core/storage.js';
import { emit } from '../core/bus.js';

const MAX_ENTRIES = 40;

function load() {
  const raw = ephemeral.read(STORAGE_KEYS.session, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => e && typeof e.question === 'string' && typeof e.answer === 'string')
    .slice(-MAX_ENTRIES)
    .map((e) => ({
      question: e.question.slice(0, 300),
      answer: e.answer.slice(0, 400),
      mode: typeof e.mode === 'string' ? e.mode : 'general',
      kind: typeof e.kind === 'string' ? e.kind : 'auto',
      at: Number(e.at) || Date.now(),
    }));
}

let entries = load();
let lastTemplate = null;
let lastRaw = null;

function persist() {
  ephemeral.write(STORAGE_KEYS.session, entries);
}

export const session = {
  get entries() { return entries; },
  get length() { return entries.length; },

  /** Most recent first-to-last list, used for follow-up resolution. */
  history() { return entries; },

  last() { return entries[entries.length - 1] || null; },

  add(entry) {
    entries.push({
      question: String(entry.question).slice(0, 300),
      answer: String(entry.answer).slice(0, 400),
      mode: entry.mode || 'general',
      kind: entry.kind || 'auto',
      at: Date.now(),
    });
    if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
    persist();
    emit('session:change', { entries });
    return entries[entries.length - 1];
  },

  clear() {
    entries = [];
    lastTemplate = null;
    lastRaw = null;
    ephemeral.remove(STORAGE_KEYS.session);
    emit('session:change', { entries });
  },

  /** Repetition guards so Peter doesn't echo himself. */
  get lastTemplate() { return lastTemplate; },
  set lastTemplate(v) { lastTemplate = v; },
  get lastRaw() { return lastRaw; },
  set lastRaw(v) { lastRaw = v; },

  /** True when memory should influence the next answer. */
  hasContext() { return entries.length > 0; },
};
