/**
 * state.js — single mutable store for operator settings + public prefs.
 * Mutation goes through setters so every listener sees the same truth.
 */

import { OPERATOR_DEFAULTS, PREF_DEFAULTS, STORAGE_KEYS, MODE_IDS, PERSONALITY_IDS } from './config.js';
import { persistent } from './storage.js';
import { emit } from './bus.js';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function sanitizeOperator(raw) {
  const o = { ...OPERATOR_DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  o.target = String(o.target ?? '').slice(0, 80);
  o.secretAnswer = String(o.secretAnswer ?? '').slice(0, 400);
  o.personality = PERSONALITY_IDS.includes(o.personality) ? o.personality : OPERATOR_DEFAULTS.personality;
  o.responseType = ['normal', 'refusal', 'yes', 'no'].includes(o.responseType) ? o.responseType : 'normal';
  o.delay = clamp(Number(o.delay) || 0, 0, 30);
  o.delayJitter = clamp(Number(o.delayJitter) || 0, 0, 10);
  o.glitch = clamp(Number(o.glitch) || 0, 0, 1);
  o.animation = clamp(Number(o.animation) || 0, 0, 1.5);
  o.refusalChance = clamp(Number(o.refusalChance) || 0, 0, 1);
  o.trigger = String(o.trigger || OPERATOR_DEFAULTS.trigger).slice(0, 1) || OPERATOR_DEFAULTS.trigger;
  o.petitionText = String(o.petitionText || OPERATOR_DEFAULTS.petitionText).slice(0, 200);
  o.shortcut = String(o.shortcut || OPERATOR_DEFAULTS.shortcut).toLowerCase().slice(0, 40);
  o.model = String(o.model ?? '').slice(0, 80);
  for (const k of ['autoRespond', 'sessionMemory', 'voice', 'ambient', 'strictPetition', 'paused',
    'aiValidation', 'aiAutoCorrect', 'aiPresentation']) {
    o[k] = Boolean(o[k]);
  }
  return o;
}

function sanitizePrefs(raw) {
  const p = { ...PREF_DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  p.mode = MODE_IDS.includes(p.mode) ? p.mode : PREF_DEFAULTS.mode;
  for (const k of ['voice', 'ambient', 'reducedMotion', 'typewriter', 'sequence']) p[k] = Boolean(p[k]);
  return p;
}

export const state = {
  operator: sanitizeOperator(persistent.read(STORAGE_KEYS.operator)),
  prefs: sanitizePrefs(persistent.read(STORAGE_KEYS.prefs)),

  /** Runtime-only (never persisted). */
  runtime: {
    peterState: 'idle',        // idle | attentive | processing | answering | refusing | paused
    status: 'connected',
    busy: false,
    lastAnswer: '',
    lastQuestion: '',
    pendingResolve: null,      // set while waiting for a manual operator send
    consoleOpen: false,
    operatorUnlocked: false,
    secretFromPetition: '',    // answer captured through the petition field
    aiStatus: 'unknown',       // operator-facing only; never shown publicly
    aiModel: null,
    lastConfidence: null,
    pendingCorrection: null,   // a suggestion awaiting ACCEPT / KEEP ORIGINAL
  },
};

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persistent.write(STORAGE_KEYS.operator, state.operator);
    persistent.write(STORAGE_KEYS.prefs, state.prefs);
  }, 180);
}

/** Update one or more operator settings. */
export function setOperator(patch) {
  const next = sanitizeOperator({ ...state.operator, ...patch });
  const changed = Object.keys(patch).filter((k) => next[k] !== state.operator[k]);
  state.operator = next;
  scheduleSave();
  if (changed.length) emit('operator:change', { changed, operator: next });
  return next;
}

/** Update one or more public preferences. */
export function setPref(patch) {
  const next = sanitizePrefs({ ...state.prefs, ...patch });
  const changed = Object.keys(patch).filter((k) => next[k] !== state.prefs[k]);
  state.prefs = next;
  scheduleSave();
  if (changed.length) emit('prefs:change', { changed, prefs: next });
  return next;
}

/** Runtime values are transient; they still broadcast. */
export function setRuntime(patch) {
  Object.assign(state.runtime, patch);
  emit('runtime:change', { patch, runtime: state.runtime });
}

export function resetOperator() {
  state.operator = sanitizeOperator({ ...OPERATOR_DEFAULTS, shortcut: state.operator.shortcut });
  scheduleSave();
  emit('operator:change', { changed: Object.keys(OPERATOR_DEFAULTS), operator: state.operator });
}
