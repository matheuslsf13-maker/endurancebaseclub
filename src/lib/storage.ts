export interface KeyValueStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

// Module-level fallback shared by every safeLocalStorage() instance, plus the
// set of keys that have fallen back to it after window.localStorage threw.
// Once a key falls back it keeps using the in-memory store for its lifetime,
// so a single flaky call can't leave a key split across two backing stores.
const fallback = memoryStorage();
const fallbackKeys = new Set<string>();

export function safeLocalStorage(): KeyValueStorage {
  return {
    getItem(k) {
      if (fallbackKeys.has(k)) return fallback.getItem(k);
      try {
        return window.localStorage.getItem(k);
      } catch {
        fallbackKeys.add(k);
        return fallback.getItem(k);
      }
    },
    setItem(k, v) {
      if (fallbackKeys.has(k)) {
        fallback.setItem(k, v);
        return;
      }
      try {
        window.localStorage.setItem(k, v);
      } catch {
        fallbackKeys.add(k);
        fallback.setItem(k, v);
      }
    },
    removeItem(k) {
      if (fallbackKeys.has(k)) {
        fallback.removeItem(k);
        fallbackKeys.delete(k);
        return;
      }
      try {
        window.localStorage.removeItem(k);
      } catch {
        fallbackKeys.add(k);
        fallback.removeItem(k);
      }
    },
  };
}

/** True when `k` could not be kept in window.localStorage and lives only in this page's memory
 * (lost on reload) — lets a screen warn that what it keeps is not persisted. */
export function isMemoryOnly(k: string): boolean {
  return fallbackKeys.has(k);
}

export function readJSON<T>(s: KeyValueStorage, key: string, fallbackValue: T): T {
  try {
    const raw = s.getItem(key);
    if (raw === null) return fallbackValue;
    return JSON.parse(raw) as T;
  } catch {
    return fallbackValue;
  }
}

export function writeJSON(s: KeyValueStorage, key: string, value: unknown): void {
  try {
    s.setItem(key, JSON.stringify(value));
  } catch {
    // memoryStorage() never throws and safeLocalStorage() already falls
    // back internally; swallow anything else so callers never crash on save.
  }
}
