/**
 * config.mjs — runtime configuration for PETER's backend.
 *
 * Everything is environment-driven. Nothing sensitive is hard-coded and
 * nothing here is ever sent to the browser except the small, deliberate
 * subset exposed by `publicConfig()`.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env reader — no dependency, no surprises. */
async function loadEnvFile() {
  const file = resolve(ROOT, '.env');
  if (!existsSync(file)) return;
  let text = '';
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Real environment variables always win over the file.
    if (!(key in process.env)) process.env[key] = value;
  }
}

await loadEnvFile();

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (v, fallback) => {
  if (v == null || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(v));
};

export const config = {
  /* ---- web server ---- */
  host: process.env.HOST || '127.0.0.1',
  port: num(process.env.PORT, 8080),

  /* ---- ollama ---- */
  ollamaUrl: (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, ''),
  /** Empty means "discover whatever is installed". */
  ollamaModel: process.env.OLLAMA_MODEL || '',
  /** Preference order used when no model is pinned. */
  modelPreference: (process.env.OLLAMA_MODEL_PREFERENCE ||
    'llama3.2,llama3.1,llama3,qwen2.5,mistral,gemma2,phi3,llama2')
    .split(',').map((s) => s.trim()).filter(Boolean),

  /* ---- timeouts (ms) ---- */
  statusTimeout: num(process.env.OLLAMA_STATUS_TIMEOUT, 2500),
  validateTimeout: num(process.env.OLLAMA_VALIDATE_TIMEOUT, 12000),
  presentTimeout: num(process.env.OLLAMA_PRESENT_TIMEOUT, 9000),

  /* ---- features ---- */
  validationEnabled: bool(process.env.PETER_VALIDATION, true),
  presentationEnabled: bool(process.env.PETER_PRESENTATION, true),

  /* ---- confidence thresholds ---- */
  autoApplyAt: num(process.env.PETER_AUTO_APPLY_CONFIDENCE, 0.95),
  confirmAt: num(process.env.PETER_CONFIRM_CONFIDENCE, 0.70),

  /* ---- safety ---- */
  maxBodyBytes: num(process.env.PETER_MAX_BODY, 16 * 1024),
  rateLimitPerMinute: num(process.env.PETER_RATE_LIMIT, 60),
  /** When false, request text is never written to logs. */
  logText: bool(process.env.PETER_LOG_TEXT, false),
  statusCacheMs: num(process.env.OLLAMA_STATUS_CACHE, 8000),
};

/**
 * The only configuration the browser is ever allowed to see.
 * Note what is absent: the Ollama URL, prompts, and every timeout that could
 * help someone probe the backend.
 */
export function publicConfig(status) {
  return {
    model: status?.model || null,
    validationEnabled: config.validationEnabled,
    presentationEnabled: config.presentationEnabled,
    autoApplyAt: config.autoApplyAt,
    confirmAt: config.confirmAt,
  };
}
