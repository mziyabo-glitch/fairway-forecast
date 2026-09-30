/** Tiny JSON store. Storage failures return null / false and never throw. */

export function createJsonStore(key) {
  const mem = new Map();

  function backend() {
    try {
      if (typeof localStorage !== "undefined") return localStorage;
    } catch {
      /* private mode */
    }
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => {
        mem.set(k, String(v));
      },
      removeItem: (k) => {
        mem.delete(k);
      },
    };
  }

  return {
    read() {
      try {
        const raw = backend().getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed;
      } catch {
        return null;
      }
    },
    write(value) {
      try {
        backend().setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        backend().removeItem(key);
      } catch {
        /* ignore */
      }
      mem.delete(key);
    },
  };
}
