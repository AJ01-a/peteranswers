/**
 * peterAI.js — the browser's only link to PETER's backend.
 *
 * Three deliberate properties:
 *   1. Nothing here is required for PETER to work. Every method resolves to a
 *      usable value, never rejects, and every caller has a deterministic path.
 *   2. Nothing here is visible to an ordinary visitor. Status, model names and
 *      confidence are operator-facing only.
 *   3. The authoritative answer is verified again on this side before any
 *      generated wording is allowed on screen.
 */

import { emit } from '../core/bus.js';

/**
 * Resolved against the page, not the domain root, so the app works when it is
 * served from a sub-path (e.g. a GitHub Pages project site). On a static host
 * these simply 404, which is handled as "no backend".
 */
const base = (path) => new URL(path, document.baseURI).toString();

const ENDPOINT = {
  status: base('api/peter/status'),
  validate: base('api/peter/validate'),
  present: base('api/peter/present'),
};

/** @typedef {'unknown'|'checking'|'online'|'offline'|'model_unavailable'|'no_backend'} AIState */

const REMEMBER_KEY = 'peter.backend.v1';

/**
 * Is a backend plausibly there?
 *
 * On a static host (GitHub Pages and friends) there is none, and probing for
 * one would log a 404 into every visitor's console — noise that also hints at
 * machinery the audience is not meant to know about. So an ordinary visitor
 * never makes the request. The operator always does, because opening the
 * console forces a probe regardless of what this returns.
 */
function backendPlausible() {
  const host = location.hostname;
  if (location.protocol === 'file:') return false;
  if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (host.endsWith('.local')) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  // A backend was found on this origin before.
  try { return localStorage.getItem(REMEMBER_KEY) === 'yes'; } catch { return false; }
}

function remember(found) {
  try { localStorage.setItem(REMEMBER_KEY, found ? 'yes' : 'no'); } catch { /* ignore */ }
}

const state = {
  /** @type {AIState} */ status: 'unknown',
  model: null,
  models: [],
  latencyMs: 0,
  wanted: null,
  config: null,
  lastCheck: 0,
};

function setStatus(patch) {
  Object.assign(state, patch);
  emit('ai:status', { ...state });
}

async function call(path, { method = 'GET', body, timeout = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(path, {
      method,
      signal: controller.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, error: err?.name === 'AbortError' ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

export const peterAI = {
  get state() { return { ...state }; },
  get online() { return state.status === 'online'; },

  /**
   * Ask the backend how things stand. Safe to call often.
   * @param {{force?:boolean, probe?:boolean}} opts
   *   `probe: true` bypasses the static-host guard (used when the operator
   *   deliberately opens the console or presses Re-check).
   */
  async refresh({ force = false, probe = false } = {}) {
    if (!probe && !backendPlausible()) {
      setStatus({ status: 'no_backend', model: null, models: [], config: null, lastCheck: Date.now() });
      return state;
    }
    setStatus({ status: 'checking' });
    const res = await call(`${ENDPOINT.status}${force ? '?force=1' : ''}`, { timeout: 6000 });

    if (!res.ok) {
      // No backend at all — the site is being served as plain static files.
      remember(false);
      setStatus({ status: 'no_backend', model: null, models: [], config: null, lastCheck: Date.now() });
      return state;
    }

    remember(true);
    const d = res.data || {};
    setStatus({
      status: ['online', 'offline', 'model_unavailable'].includes(d.state) ? d.state : 'offline',
      model: d.model ?? null,
      models: Array.isArray(d.models) ? d.models : [],
      latencyMs: Number(d.latencyMs) || 0,
      wanted: d.wanted ?? null,
      config: d.config ?? null,
      lastCheck: Date.now(),
    });
    return state;
  },

  /**
   * Check a piece of operator input.
   * Always resolves; on any failure it returns a "leave it alone" result.
   * @param {{text:string, field?:'answer'|'petition', trigger?:string}} args
   */
  async validate({ text, field = 'answer', trigger = '.', model = '' }) {
    const original = String(text ?? '');
    const res = await call(ENDPOINT.validate, {
      method: 'POST',
      timeout: 16000,
      body: { text: original, field, trigger, model },
    });

    if (!res.ok || !res.data || typeof res.data.corrected !== 'string') {
      return {
        status: 'valid',
        confidence: 1,
        original,
        corrected: original,
        changes: [],
        needs_confirmation: false,
        needs_edit: false,
        source: 'none',
        notes: [res.ok ? 'PETER returned nothing usable.' : 'PETER could not be reached.'],
        mechanic: { triggerConflict: Boolean(trigger) && original.includes(trigger) },
      };
    }
    return res.data;
  },

  /**
   * Ask for wording around an answer that has ALREADY been decided.
   * @param {{answer:string, question:string, mode?:string, history?:Array, timeout?:number}} args
   * @returns {Promise<string|null>} wording, or null to use the deterministic text
   */
  async present({ answer, question, mode = 'general', history = [], model = '', timeout = 10000 }) {
    const authoritative = String(answer ?? '').trim();
    if (!authoritative) return null;

    const res = await call(ENDPOINT.present, {
      method: 'POST',
      timeout,
      body: { answer: authoritative, question, mode, history, model },
    });

    if (!res.ok || !res.data?.ok || typeof res.data.text !== 'string') return null;

    // Defence in depth: the backend already verified this, but the wording is
    // about to be shown to an audience, so check it here too.
    if (!containsAuthoritative(res.data.text, authoritative)) return null;
    return res.data.text;
  },
};

/** The operator's answer must survive verbatim, ignoring case and final stops. */
export function containsAuthoritative(text, answer) {
  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').replace(/[.!?…]+$/, '').trim();
  const needle = norm(answer);
  if (!needle) return false;
  return norm(text).includes(needle);
}
