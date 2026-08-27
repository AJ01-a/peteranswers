/**
 * ollama.mjs — the only place that talks to Ollama.
 *
 * Never reachable from the browser directly: the public API exposes three
 * narrow endpoints, not a proxy. Every call is time-boxed and every failure
 * is turned into a value, never an exception that could reach a visitor.
 */

import { config } from './config.mjs';

/* ------------------------------------------------------------ status ---- */

let statusCache = { at: 0, value: null };

/** @typedef {'online'|'offline'|'model_unavailable'} OllamaState */

async function request(path, { method = 'GET', body, timeout } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${config.ollamaUrl}${path}`, {
      method,
      signal: controller.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'timeout' : 'unreachable';
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

/** Choose a model: the pinned one if present, else the best installed match. */
function chooseModel(installed) {
  const names = installed.map((m) => m.name || m.model).filter(Boolean);
  if (!names.length) return { model: null, state: 'model_unavailable' };

  if (config.ollamaModel) {
    const exact = names.find(
      (n) => n === config.ollamaModel || n.split(':')[0] === config.ollamaModel
    );
    if (exact) return { model: exact, state: 'online' };
    return { model: null, state: 'model_unavailable', wanted: config.ollamaModel };
  }

  for (const pref of config.modelPreference) {
    const hit = names.find((n) => n === pref || n.split(':')[0] === pref);
    if (hit) return { model: hit, state: 'online' };
  }
  return { model: names[0], state: 'online' };
}

/**
 * @param {boolean} [force] bypass the short cache
 * @returns {Promise<{state:OllamaState, model:string|null, models:string[], error?:string, latencyMs:number}>}
 */
export async function getStatus(force = false) {
  const now = Date.now();
  if (!force && statusCache.value && now - statusCache.at < config.statusCacheMs) {
    return statusCache.value;
  }

  const started = now;
  const res = await request('/api/tags', { timeout: config.statusTimeout });
  const latencyMs = Date.now() - started;

  let value;
  if (!res.ok) {
    value = { state: 'offline', model: null, models: [], error: res.error, latencyMs };
  } else {
    const installed = Array.isArray(res.data?.models) ? res.data.models : [];
    const picked = chooseModel(installed);
    value = {
      state: picked.state,
      model: picked.model,
      models: installed.map((m) => m.name || m.model).filter(Boolean),
      latencyMs,
      ...(picked.wanted ? { wanted: picked.wanted } : {}),
    };
  }

  statusCache = { at: Date.now(), value };
  return value;
}

export function invalidateStatus() {
  statusCache = { at: 0, value: null };
}

/* -------------------------------------------------------------- chat ---- */

/** Strip fences / prose and pull the first balanced JSON object out. */
export function extractJSON(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim();

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  const start = s.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * One non-streaming chat completion.
 * @returns {Promise<{ok:true, text:string, model:string, ms:number}|{ok:false, error:string}>}
 */
export async function chat({ system, user, timeout, json = false, temperature = 0.1, numPredict = 300, model = '' }) {
  const status = await getStatus();
  if (status.state !== 'online' || !status.model) {
    return { ok: false, error: status.state === 'offline' ? 'offline' : 'model_unavailable' };
  }

  // A caller may prefer a model, but only one that is actually installed.
  // Anything else is ignored rather than forwarded to Ollama.
  const requested = String(model || '').slice(0, 80);
  const chosen = requested && status.models.includes(requested) ? requested : status.model;

  const started = Date.now();
  const res = await request('/api/chat', {
    method: 'POST',
    timeout,
    body: {
      model: chosen,
      stream: false,
      ...(json ? { format: 'json' } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      options: {
        temperature,
        top_p: 0.9,
        num_predict: numPredict,
      },
    },
  });

  if (!res.ok) {
    // A dead socket mid-flight should re-probe on the next call.
    if (res.error === 'unreachable') invalidateStatus();
    return { ok: false, error: res.error };
  }

  const text = res.data?.message?.content;
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'empty_response' };

  return { ok: true, text, model: chosen, ms: Date.now() - started };
}
