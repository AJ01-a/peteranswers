#!/usr/bin/env node
/**
 * index.mjs — PETER's backend.
 *
 *   Browser  ──▶  this server  ──▶  Ollama
 *
 * Ollama is never reachable from the browser. There is no passthrough proxy:
 * exactly three narrow endpoints are exposed, each with its own validation,
 * body cap and rate limit. Binds to 127.0.0.1 unless told otherwise.
 *
 *   node server/index.mjs
 *   PORT=3000 OLLAMA_MODEL=llama3.2 node server/index.mjs
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

import { readFileSync } from 'node:fs';

import { config, ROOT, publicConfig } from './config.mjs';
import { getStatus, invalidateStatus } from './ollama.mjs';
import { validate } from './validate.mjs';
import { present } from './present.mjs';

/* ------------------------------------------------------------- static --- */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/** Files the browser has no business fetching. */
const BLOCKED = [/^\/?\.env/i, /^\/?server\//i, /^\/?node_modules\//i, /^\/?\.git/i];

/* --------------------------------------------------------- rate limit --- */

const hits = new Map();
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [key, list] of hits) {
    const kept = list.filter((t) => t > cutoff);
    if (kept.length) hits.set(key, kept);
    else hits.delete(key);
  }
}, 30_000).unref();

function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > config.rateLimitPerMinute;
}

/* ------------------------------------------------------------ helpers --- */

function send(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > config.maxBodyBytes) {
      const err = new Error('body too large');
      err.code = 'TOO_LARGE';
      throw err;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const err = new Error('invalid json');
    err.code = 'BAD_JSON';
    throw err;
  }
}

const str = (v, max = 400) => String(v ?? '').slice(0, max);

/** Never log operator text unless explicitly enabled. */
function log(...parts) {
  console.log(`[peter ${new Date().toISOString().slice(11, 19)}]`, ...parts);
}

/* --------------------------------------------------------------- api ---- */

async function handleApi(req, res, url) {
  const ip = req.socket.remoteAddress || 'local';
  if (rateLimited(ip)) return send(res, 429, { error: 'slow_down' });

  /* ---- status ---- */
  if (url.pathname === '/api/peter/status' && req.method === 'GET') {
    const force = url.searchParams.get('force') === '1';
    if (force) invalidateStatus();
    const status = await getStatus(force);
    return send(res, 200, {
      state: status.state,
      model: status.model,
      models: status.models,
      latencyMs: status.latencyMs,
      ...(status.wanted ? { wanted: status.wanted } : {}),
      config: publicConfig(status),
    });
  }

  /* ---- validate ---- */
  if (url.pathname === '/api/peter/validate' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return send(res, err.code === 'TOO_LARGE' ? 413 : 400, { error: 'bad_request' });
    }

    const field = ['petition', 'capture'].includes(body.field) ? body.field : 'answer';
    const text = str(body.text, 400);
    const trigger = str(body.trigger, 1) || '.';
    const model = str(body.model, 80);

    const started = Date.now();
    try {
      const result = await validate({ text, field, trigger, model });
      log('validate', field, result.status, `${result.source}`, `${Date.now() - started}ms`,
        config.logText ? JSON.stringify(text) : '');
      return send(res, 200, result);
    } catch (err) {
      log('validate failed:', err.message);
      // Never let a backend fault stop the performance.
      return send(res, 200, {
        status: 'valid', confidence: 1, original: text, corrected: text,
        changes: [], needs_confirmation: false, needs_edit: false,
        source: 'none', notes: ['PETER could not be reached.'],
        mechanic: { triggerConflict: false },
      });
    }
  }

  /* ---- present ---- */
  if (url.pathname === '/api/peter/present' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return send(res, err.code === 'TOO_LARGE' ? 413 : 400, { error: 'bad_request' });
    }

    const answer = str(body.answer, 400);
    const question = str(body.question, 300);
    const mode = str(body.mode, 24) || 'general';
    const model = str(body.model, 80);
    const history = Array.isArray(body.history)
      ? body.history.slice(-3).map((h) => ({
          question: str(h?.question, 200),
          answer: str(h?.answer, 200),
        }))
      : [];

    const started = Date.now();
    try {
      const result = await present({ answer, question, mode, history, model });
      log('present', result.ok ? 'ollama' : `fallback(${result.reason})`, `${Date.now() - started}ms`);
      return send(res, 200, result.ok
        ? { ok: true, text: result.text, source: 'ollama' }
        : { ok: false, source: 'fallback', reason: result.reason });
    } catch (err) {
      log('present failed:', err.message);
      return send(res, 200, { ok: false, source: 'fallback', reason: 'error' });
    }
  }

  return send(res, 404, { error: 'not_found' });
}

/* ------------------------------------------------------- environment ---- */

/** WSL2 has its own network namespace: 127.0.0.1 is not the Windows host. */
function wslHostHint() {
  if (process.platform !== 'linux') return null;
  try {
    if (!/microsoft/i.test(readFileSync('/proc/version', 'utf8'))) return null;
  } catch {
    return null;
  }
  if (!/\/\/(127\.0\.0\.1|localhost)\b/.test(config.ollamaUrl)) return null;

  // Default gateway from /proc/net/route — that is the Windows side.
  try {
    const rows = readFileSync('/proc/net/route', 'utf8').trim().split('\n').slice(1);
    for (const row of rows) {
      const [, destination, gateway] = row.split(/\s+/);
      if (destination !== '00000000' || !gateway) continue;
      const ip = gateway.match(/../g).reverse().map((h) => parseInt(h, 16)).join('.');
      return `http://${ip}:11434`;
    }
  } catch { /* not fatal */ }
  return null;
}

/* ------------------------------------------------------------- server --- */

const server = createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (err) {
      log('api error:', err.message);
      if (!res.headersSent) send(res, 500, { error: 'server_error' });
    }
    return;
  }

  // ---- static ----
  try {
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';

    if (BLOCKED.some((rx) => rx.test(path))) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }

    const target = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!target.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(target);
    const file = info.isDirectory() ? join(target, 'index.html') : target;
    const body = await readFile(file);

    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

server.listen(config.port, config.host, async () => {
  log(`PETER → http://${config.host}:${config.port}`);
  const status = await getStatus(true);
  if (status.state === 'online') {
    log(`ollama online · model "${status.model}" · ${status.latencyMs}ms`);
  } else if (status.state === 'model_unavailable') {
    log(`ollama online but model "${status.wanted || '?'}" is not installed`);
    log(`installed: ${status.models.join(', ') || 'none'}`);
  } else {
    log(`ollama offline (${status.error}) — PETER runs on its own engine`);
    const hint = wslHostHint();
    if (hint) {
      log('running under WSL: 127.0.0.1 here is not the Windows machine.');
      log(`  if Ollama runs on Windows, try  OLLAMA_URL=${hint} npm start`);
      log('  (and set OLLAMA_HOST=0.0.0.0 on the Windows side)');
    }
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log('shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
