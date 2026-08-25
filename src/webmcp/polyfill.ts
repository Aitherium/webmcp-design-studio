/**
 * WebMCP polyfill — a spec-shaped shim for `document.modelContext`.
 *
 * ⚠️ SHIM: this implements the *shape* of the WebMCP API (register/get/
 * execute/toolchange/abort) so the studio runs in every browser and in
 * tests. It is NOT the real browser API: tools registered here are only
 * visible to this tab. The StatusBar always shows when the polyfill is in
 * use so nobody mistakes the shim for the real thing in a demo.
 *
 * It mirrors the spec's rejection cases exactly (index.bs:604-642):
 * - duplicate name → InvalidStateError
 * - empty / bad-charset / >128-char name → InvalidStateError
 * - empty description → InvalidStateError
 * - non-serializable inputSchema → InvalidStateError
 * - unregister = aborting the signal passed at registration (fires toolchange)
 */
import type {
  GetToolsOptions,
  ModelContextSurface,
  ModelContextTool,
  RegisteredTool,
  RegisterOptions,
} from './types';
import { isValidToolName } from './types';

function invalidState(message: string): DOMException {
  return new DOMException(message, 'InvalidStateError');
}

interface Registration {
  tool: ModelContextTool;
  window: Window | null;
  origin: string | null;
}

function deepCopy<T>(value: T): T {
  // Schemas were validated JSON-serializable at registration, so a JSON
  // round-trip is a faithful deep copy (and avoids structuredClone on
  // objects that may carry function-valued extras).
  return JSON.parse(JSON.stringify(value)) as T;
}

export class ModelContextPolyfill extends EventTarget implements ModelContextSurface {
  /** Distinguishes the shim from the real API. */
  readonly isPolyfill = true;
  readonly kind = 'polyfill' as const;

  private registrations = new Map<string, Registration>();

  async registerTool(tool: ModelContextTool, options?: RegisterOptions): Promise<void> {
    if (!tool || typeof tool !== 'object') throw invalidState('tool is required');
    if (!isValidToolName(tool.name)) {
      throw invalidState(
        `invalid tool name ${JSON.stringify(tool.name)} — must be 1-128 chars of [a-zA-Z0-9_.-]`,
      );
    }
    if (typeof tool.description !== 'string' || tool.description.trim() === '') {
      throw invalidState(`tool "${tool.name}": description is required`);
    }
    if (typeof tool.execute !== 'function') {
      throw invalidState(`tool "${tool.name}": execute callback is required`);
    }
    let schemaJson: string;
    try {
      schemaJson = JSON.stringify(tool.inputSchema);
    } catch {
      throw invalidState(`tool "${tool.name}": inputSchema must be JSON-serializable`);
    }
    if (!schemaJson || schemaJson === 'null' || schemaJson === 'undefined') {
      throw invalidState(`tool "${tool.name}": inputSchema must be a JSON object`);
    }
    if (this.registrations.has(tool.name)) {
      throw invalidState(`tool "${tool.name}" is already registered`);
    }

    this.registrations.set(tool.name, {
      tool,
      window: typeof window !== 'undefined' ? window : null,
      origin: typeof location !== 'undefined' ? location.origin : null,
    });
    this.dispatchToolChange();

    // Abort → unregister (spec: unregistration = aborting the signal).
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted) {
        this.unregister(tool.name);
      } else {
        signal.addEventListener(
          'abort',
          () => {
            this.unregister(tool.name);
          },
          { once: true },
        );
      }
    }
  }

  async getTools(_options?: GetToolsOptions): Promise<RegisteredTool[]> {
    const out: RegisteredTool[] = [];
    for (const [name, reg] of this.registrations) {
      out.push({
        name,
        title: reg.tool.title,
        description: reg.tool.description,
        inputSchema: deepCopy(reg.tool.inputSchema),
        window: reg.window,
        origin: reg.origin,
        annotations: reg.tool.annotations ? { ...reg.tool.annotations } : undefined,
      });
    }
    return out;
  }

  async executeTool(
    tool: RegisteredTool | string,
    input?: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<string> {
    const name = typeof tool === 'string' ? tool : tool.name;
    const reg = this.registrations.get(name);
    if (!reg) throw new DOMException(`tool "${name}" is not registered`, 'NotFoundError');
    const { signal } = options ?? {};
    if (signal?.aborted) {
      throw new DOMException('execution aborted', 'AbortError');
    }
    const result = await reg.tool.execute(input ?? {}, { signal: signal ?? new AbortController().signal });
    return JSON.stringify(result);
  }

  private unregister(name: string): void {
    if (!this.registrations.delete(name)) return;
    this.dispatchToolChange();
  }

  private dispatchToolChange(): void {
    this.dispatchEvent(new Event('toolchange'));
  }
}

/**
 * Install the polyfill on `document.modelContext` when no real API exists.
 * Idempotent. Returns the surface now in use.
 */
export function installModelContextPolyfill(): ModelContextSurface {
  const doc = (document as { modelContext?: ModelContextSurface }).modelContext;
  if (doc) return doc;
  const nav = (navigator as { modelContext?: ModelContextSurface }).modelContext;
  if (nav) return nav;

  const polyfill = new ModelContextPolyfill();
  Object.defineProperty(document, 'modelContext', {
    value: polyfill,
    configurable: true,
    enumerable: false,
    writable: false,
  });
  return polyfill;
}
