/** bus.js — tiny synchronous pub/sub. Keeps components decoupled. */

const channels = new Map();

export function on(event, handler) {
  if (!channels.has(event)) channels.set(event, new Set());
  channels.get(event).add(handler);
  return () => off(event, handler);
}

export function off(event, handler) {
  channels.get(event)?.delete(handler);
}

export function emit(event, payload) {
  const set = channels.get(event);
  if (!set) return;
  // copy so handlers may unsubscribe during dispatch
  for (const handler of [...set]) {
    try {
      handler(payload);
    } catch (err) {
      console.error(`[bus] handler for "${event}" threw:`, err);
    }
  }
}
