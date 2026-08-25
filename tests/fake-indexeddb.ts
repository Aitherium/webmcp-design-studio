/**
 * Minimal in-memory IndexedDB for jsdom tests (this repo's own code — no
 * external dependency). Implements exactly the surface `state/memory.ts`
 * uses: open(name, version) with onupgradeneeded, objectStoreNames.contains,
 * createObjectStore, transaction().objectStore(name) with put/get/clear, and
 * async request delivery via queueMicrotask (mirrors real IDB's task queue).
 * Anything else (cursors, indexes, ranges) intentionally throws.
 */

type EventHandler = ((this: unknown, ev: Event) => unknown) | null;

class FakeRequest<T = unknown> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: EventHandler = null;
  onerror: EventHandler = null;
  readonly readyState: 'pending' | 'done' = 'done';
  readonly source: unknown = null;

  succeed(value: T): void {
    this.result = value;
    queueMicrotask(() => {
      if (this.onsuccess) this.onsuccess(new Event('success'));
    });
  }

  fail(message: string): void {
    this.error = new DOMException(message, 'UnknownError');
    queueMicrotask(() => {
      if (this.onerror) this.onerror(new Event('error'));
    });
  }
}

class FakeOpenRequest extends FakeRequest<FakeDatabase> {
  onupgradeneeded: EventHandler = null;
  readonly transaction: unknown = null;
}

class FakeStoreNames {
  constructor(private names: string[]) {}

  get length(): number {
    return this.names.length;
  }

  contains(name: string): boolean {
    return this.names.includes(name);
  }

  item(index: number): string | null {
    return this.names[index] ?? null;
  }
}

class FakeObjectStore {
  private data = new Map<string, unknown>();

  put(value: unknown, key?: string): FakeRequest<string> {
    const req = new FakeRequest<string>();
    const k = key ?? `auto_${Math.random().toString(36).slice(2)}`;
    this.data.set(k, value);
    req.succeed(k);
    return req;
  }

  get(key: string): FakeRequest<unknown> {
    const req = new FakeRequest<unknown>();
    req.succeed(this.data.get(String(key)));
    return req;
  }

  clear(): FakeRequest<undefined> {
    const req = new FakeRequest<undefined>();
    this.data.clear();
    req.succeed(undefined);
    return req;
  }
}

class FakeTransaction {
  oncomplete: EventHandler = null;
  onerror: EventHandler = null;
  readonly error: DOMException | null = null;
  readonly mode = 'readwrite';

  constructor(
    private db: FakeDatabase,
    private storeNames: string | string[],
  ) {}

  objectStore(name: string): FakeObjectStore {
    const store = this.db.stores.get(name);
    if (!store) throw new Error(`object store "${name}" not found`);
    return store;
  }

  abort(): void {
    /* no-op */
  }
}

class FakeDatabase {
  readonly stores = new Map<string, FakeObjectStore>();
  version: number;

  constructor(
    public readonly name: string,
    version: number,
  ) {
    this.version = version;
  }

  get objectStoreNames(): FakeStoreNames {
    return new FakeStoreNames([...this.stores.keys()]);
  }

  createObjectStore(name: string): FakeObjectStore {
    const store = new FakeObjectStore();
    this.stores.set(name, store);
    return store;
  }

  transaction(storeNames: string | string[]): FakeTransaction {
    return new FakeTransaction(this, storeNames);
  }

  close(): void {
    /* no-op */
  }
}

export function createFakeIndexedDB(): IDBFactory {
  const databases = new Map<string, FakeDatabase>();

  return {
    open(name: string, version?: number): IDBOpenDBRequest {
      const req = new FakeOpenRequest();
      const targetVersion = version ?? 1;
      queueMicrotask(() => {
        let db = databases.get(name);
        if (!db || db.version < targetVersion) {
          db = new FakeDatabase(name, targetVersion);
          databases.set(name, db);
          if (req.onupgradeneeded) {
            req.result = db;
            req.onupgradeneeded(new Event('upgradeneeded'));
          }
        }
        req.succeed(db);
      });
      return req as unknown as IDBOpenDBRequest;
    },

    deleteDatabase(name: string): IDBOpenDBRequest {
      const req = new FakeOpenRequest();
      queueMicrotask(() => {
        databases.delete(name);
        req.succeed(null as unknown as FakeDatabase);
      });
      return req as unknown as IDBOpenDBRequest;
    },

    databases(): Promise<IDBDatabaseInfo[]> {
      return Promise.resolve(
        [...databases.entries()].map(([name, db]) => ({ name, version: db.version })),
      );
    },

    cmp(): number {
      throw new Error('fake-indexeddb: cmp not implemented');
    },
  } as unknown as IDBFactory;
}
