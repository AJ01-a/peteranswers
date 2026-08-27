/** Toasts.js — brief, non-blocking notices. */

import { el } from '../core/dom.js';

let stack = null;

export function initToasts(node) { stack = node; }

export function toast(message, { variant = '', duration = 2600 } = {}) {
  if (!stack) return;
  const node = el('div', {
    class: `toast${variant ? ` toast--${variant}` : ''}`,
    role: 'status',
    text: message,
  });
  stack.append(node);
  setTimeout(() => {
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 260);
  }, duration);
}
