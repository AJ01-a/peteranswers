/**
 * easterEggs.js — quiet extras. None of them are advertised in the UI.
 */

import { burst } from './fx/glitch.js';
import { state, setOperator } from './core/state.js';

/* --------------------------------------------------- question responses */

const SPECIALS = [
  { rx: /\b(how does (this|it) work|is this (a )?(trick|real|fake)|are you real|how do you know)\b/i,
    text: 'It is a trick. A good one. Ask me something else.' },
  { rx: /^\s*42\s*[.?!]?\s*$/,
    text: 'You have the answer. What you are missing is the question.' },
  { rx: /\b(who|what) are you\b/i,
    text: 'A pattern that learned to wait.' },
  { rx: /\b(what('| i)?s|tell me) my name\b/i,
    text: 'The one you gave the person who set this up.' },
  { rx: /\btell me a secret\b/i,
    text: 'Someone near you already knows what you were about to ask.' },
  { rx: /\bi love you\b/i,
    text: 'Careful.' },
  { rx: /\b(are you (alive|conscious|sentient))\b/i,
    text: 'No. Neither of us finds that reassuring.' },
  { rx: /\b(hello|hi|hey)\b\s*[,.!]?\s*peter\b/i,
    text: 'I heard you the first time.' },
  { rx: /\bpeter answers\b/i,
    text: 'That is the old name. It still works.' },
];

/** @returns {{text:string, kind:string}|null} */
export function questionEgg(question) {
  const q = String(question || '');
  for (const s of SPECIALS) {
    if (s.rx.test(q)) return { text: s.text, kind: 'egg' };
  }
  return null;
}

/* ------------------------------------------------------ input sequences */

const KONAMI = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a',
];

export function initEasterEggs({ peter, avatar, onUnlock, onWhisper }) {
  let buffer = [];

  window.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') { buffer = []; return; }

    buffer.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    if (buffer.length > KONAMI.length) buffer.shift();

    if (KONAMI.every((k, i) => buffer[i] === k)) {
      buffer = [];
      burst(1);
      setOperator({ glitch: Math.max(state.operator.glitch, 0.6) });
      onUnlock?.('konami');
    }
  });

  // Long press on Peter — he notices.
  let pressTimer = 0;
  const start = () => {
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      avatar?.blink();
      setTimeout(() => avatar?.blink(), 260);
      setTimeout(() => avatar?.blink(), 520);
      onWhisper?.();
    }, 1600);
  };
  const stop = () => clearTimeout(pressTimer);

  peter?.addEventListener('pointerdown', start);
  peter?.addEventListener('pointerup', stop);
  peter?.addEventListener('pointerleave', stop);
  peter?.addEventListener('pointercancel', stop);

  // Hidden entry point in the address bar.
  const params = new URLSearchParams(location.search);
  if (params.has('op') || location.hash === '#operator') onUnlock?.('url');
}

export const WHISPERS = [
  'Do not do that.',
  'I felt that.',
  'You are not the first to try.',
  'Ask, or let go.',
];
