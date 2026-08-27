/**
 * storage.js — defensive localStorage/sessionStorage wrapper.
 * Private-mode Safari and hardened browsers throw on access; never let that
 * take the page down. Nothing leaves the device.
 */

function safe(getStore) {
  try {
    const store = getStore();
    const probe = '__peter_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

const local = safe(() => window.localStorage);
const session = safe(() => window.sessionStorage);

function make(store) {
  const memory = new Map();
  return {
    available: Boolean(store),
    read(key, fallback = null) {
      try {
        const raw = store ? store.getItem(key) : memory.get(key);
        if (raw == null) return fallback;
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    write(key, value) {
      const raw = JSON.stringify(value);
      try {
        if (store) store.setItem(key, raw);
        else memory.set(key, raw);
        return true;
      } catch {
        memory.set(key, raw);
        return false;
      }
    },
    remove(key) {
      try {
        if (store) store.removeItem(key);
      } catch { /* ignore */ }
      memory.delete(key);
    },
  };
}

export const persistent = make(local);
export const ephemeral = make(session);
