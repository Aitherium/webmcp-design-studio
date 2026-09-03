/**
 * IndexedDB preference store.
 *
 * Keys are scoped `studio:prefs:{key}` inside a single object store — the
 * same tenant-scoping idea the Aither World memory layer uses, applied to a
 * standalone studio so nothing leaks across apps on the same origin.
 * Survives reloads. Backs remember-preference / recall-preference.
 */
const DB_NAME = 'webmcp-design-studio';
const DB_VERSION = 1;
const STORE_NAME = 'prefs';
const KEY_PREFIX = 'studio:prefs:';

function scopedKey(key: string): string {
  return `${KEY_PREFIX}${key}`;
}

export class PrefsUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(
      'Preferences need IndexedDB, which is not available in this environment.',
      cause === undefined ? undefined : { cause },
    );
    this.name = 'PrefsUnavailableError';
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      reject(new PrefsUnavailableError());
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(new PrefsUnavailableError(err));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new PrefsUnavailableError(req.error ?? undefined));
  });
}

function requestResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new PrefsUnavailableError(req.error ?? undefined));
  });
}

export async function setPref(key: string, value: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await requestResult(tx.objectStore(STORE_NAME).put(value, scopedKey(key)));
  } finally {
    db.close();
  }
}

export async function getPref(key: string): Promise<string | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const value = await requestResult(tx.objectStore(STORE_NAME).get(scopedKey(key)));
    return typeof value === 'string' ? value : null;
  } finally {
    db.close();
  }
}

/**
 * Every saved preference, unscoped keys. Backs search-preferences: the
 * embedder ranks these by meaning at QUERY time, so remember-preference
 * stays a plain write (no model on the save path).
 */
export async function listPrefs(): Promise<Array<{ key: string; value: string }>> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const [keys, values] = await Promise.all([
      requestResult(store.getAllKeys()),
      requestResult(store.getAll()),
    ]);
    const out: Array<{ key: string; value: string }> = [];
    keys.forEach((k, i) => {
      const v = values[i];
      if (typeof k === 'string' && k.startsWith(KEY_PREFIX) && typeof v === 'string') {
        out.push({ key: k.slice(KEY_PREFIX.length), value: v });
      }
    });
    return out;
  } finally {
    db.close();
  }
}

/** Test/dev helper: wipe every preference. */
export async function clearPrefs(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await requestResult(tx.objectStore(STORE_NAME).clear());
  } finally {
    db.close();
  }
}
