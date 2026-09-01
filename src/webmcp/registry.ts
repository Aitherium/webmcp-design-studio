/**
 * Dual-surface tool registry.
 *
 * ONE `ToolDefinition[]` (src/webmcp/tools) is the source of truth. On every
 * store change `reconcile()` walks it and, per tool:
 *   available(state) true  → ensure registered on document.modelContext
 *                            (navigator.modelContext pre-150 fallback),
 *                            one AbortController per tool;
 *   available(state) false → controller.abort() — the browser fires
 *                            `toolchange` itself; we never synthesize it.
 *
 * A tool that was aborted is unregistered; the next reconcile where the
 * predicate flips back creates a fresh controller and re-registers.
 *
 * Failures are NEVER swallowed: an absent API or a registerTool rejection
 * (NotAllowedError from Permissions-Policy, InvalidStateError…) is recorded
 * and surfaced through the status callback (StatusBar renders it LOUD).
 */
import type { ModelContextSurface, ModelContextTool, ProtocolEvent, RegisteredTool, StudioStateLike, ToolDefinition } from './types';
import { TOOL_DEFINITIONS } from './tools';
import type { WebMCPStatus } from '../state/store';

export interface RegistryCallbacks {
  /** Status changes (surface kind + LOUD failures). */
  onStatus(status: WebMCPStatus): void;
  /** Live tool names after every register/unregister (toolchange UI). */
  onToolsChanged?(names: string[]): void;
  /** Protocol-feed events (P1.2): register/unregister/toolchange/execute. */
  onTrace?(event: ProtocolEvent): void;
}

export function detectSurface(): ModelContextSurface | null {
  const doc = (document as { modelContext?: ModelContextSurface }).modelContext;
  if (doc) return doc;
  const nav = (navigator as { modelContext?: ModelContextSurface }).modelContext;
  if (nav) return nav;
  return null;
}

function surfaceKind(surface: ModelContextSurface | null): WebMCPStatus['surface'] {
  if (!surface) return 'off';
  return surface.isPolyfill ? 'polyfill' : 'real';
}

export class ToolRegistry {
  private controllers = new Map<string, AbortController>();
  private registered = new Set<string>();
  private failures = new Map<string, string>();
  private disposed = false;
  /** Last observed surface list — for the toolchange feed (P1.2). */
  private lastObserved: string[] = [];

  private chain: Promise<void> = Promise.resolve();
  private getSurface: () => ModelContextSurface | null;
  private callbacks: RegistryCallbacks;

  constructor(getSurface: () => ModelContextSurface | null, callbacks: RegistryCallbacks) {
    this.getSurface = getSurface;
    this.callbacks = callbacks;
  }

  reconcile(state: StudioStateLike): Promise<void> {
    this.chain = this.chain.then(() => this.reconcileNow(state));
    return this.chain;
  }

  /** Synchronize the browser surface with the current store state. */
  private async reconcileNow(state: StudioStateLike): Promise<void> {
    if (this.disposed) return;
    for (const def of TOOL_DEFINITIONS) {
      const wanted = !def.available || def.available(state);
      if (wanted) await this.ensureRegistered(def);
      else this.abortTool(def.name);
    }
    this.emitStatus();
    await this.refreshToolList();
  }

  get status(): WebMCPStatus {
    const surface = this.getSurface();
    return {
      surface: surfaceKind(surface),
      failures: [...this.failures.entries()].map(([name, error]) => ({ name, error })),
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.registered.clear();
  }

  private async ensureRegistered(def: ToolDefinition): Promise<void> {
    if (this.registered.has(def.name)) return;
    const surface = this.getSurface();
    if (!surface) {
      this.failures.set(def.name, 'WebMCP API is absent — tools are not discoverable by agents');
      return;
    }

    const controller = new AbortController();
    controller.signal.addEventListener(
      'abort',
      () => {
        // Abort = unregister (spec). Clean bookkeeping AND record the
        // unregister HERE, not in abortTool: the listener runs synchronously
        // during controller.abort() (measured 2026-08-31), so by the time
        // abortTool re-reads `registered` the name is already gone and its
        // `wasRegistered` is false — the unregister trace silently vanished.
        // Recording here is safe in both orderings: whichever half deletes
        // first, exactly one emission happens. The browser fires
        // `toolchange` itself — we never synthesize it.
        const wasRegistered = this.registered.delete(def.name);
        this.controllers.delete(def.name);
        if (wasRegistered) this.emitTrace({ kind: 'unregister', tool: def.name });
      },
      { once: true },
    );

    const tool: ModelContextTool = {
      name: def.name,
      title: def.title,
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: def.annotations,
      // P1.2: wrap execute so EVERY call — from a browser agent OR the
      // in-page agent — lands in the protocol feed with its input, verdict
      // and elapsed time.
      execute: async (input, options) => {
        const started = performance.now();
        try {
          const result = await def.execute(input, options);
          this.emitTrace({
            kind: 'execute',
            tool: def.name,
            detail: summarizeInput(input),
            // The tool's OWN verdict: every tool funnels user-facing errors
            // through fail() (execute-io), which sets isError — so a
            // fail()-return records ✗, never ✓ (P1.2).
            ok: (result as { isError?: boolean } | null)?.isError !== true,
            elapsedMs: Math.round(performance.now() - started),
          });
          return result;
        } catch (err) {
          this.emitTrace({
            kind: 'execute',
            tool: def.name,
            detail: summarizeInput(input),
            ok: false,
            elapsedMs: Math.round(performance.now() - started),
          });
          throw err;
        }
      },
    };
    try {
      await surface.registerTool(tool, { signal: controller.signal });
      if (controller.signal.aborted) {
        // Unregistered while the call was in flight — the abort listener
        // cleaned bookkeeping; the next reconcile re-registers it.
        return;
      }
      this.controllers.set(def.name, controller);
      this.registered.add(def.name);
      this.failures.delete(def.name);
      this.emitTrace({ kind: 'register', tool: def.name });
    } catch (err) {
      controller.abort(); // never leave a half-registered controller behind
      this.failures.set(def.name, describeError(err));
    }
  }

  private abortTool(name: string): void {
    const controller = this.controllers.get(name);
    if (controller) controller.abort(); // the abort listener records the unregister
    // Safety-net cleanup only — the listener owns bookkeeping + trace now.
    this.registered.delete(name);
    this.controllers.delete(name);
  }

  private emitStatus(): void {
    this.callbacks.onStatus(this.status);
  }

  /** Re-read the surface's live tool list for the toolchange UI. */
  private async refreshToolList(): Promise<void> {
    const surface = this.getSurface();
    if (!surface) {
      this.callbacks.onToolsChanged?.([]);
      return;
    }
    try {
      const tools = await surface.getTools();
      const names = tools.map((t: RegisteredTool) => t.name).sort();
      // P1.2: the toolchange feed — record when the SURFACE's roster moved
      // (the browser fires toolchange; this is the observed consequence).
      if (names.join(',') !== this.lastObserved.join(',')) {
        const added = names.filter((n) => !this.lastObserved.includes(n));
        const removed = this.lastObserved.filter((n) => !names.includes(n));
        const delta = [...added.map((n) => `+${n}`), ...removed.map((n) => `-${n}`)].join(' ');
        if (delta) this.emitTrace({ kind: 'toolchange', tool: delta });
        this.lastObserved = names;
      }
      this.callbacks.onToolsChanged?.(names);
    } catch (err) {
      this.failures.set('(getTools)', describeError(err));
      this.emitStatus();
    }
  }

  private emitTrace(event: Omit<ProtocolEvent, 'ts'>): void {
    this.callbacks.onTrace?.({ ts: Date.now(), ...event });
  }
}

/** The execute input as a short feed line (JSON, ~140 chars). */
function summarizeInput(input: unknown): string {
  if (input == null) return '{}';
  try {
    const json = typeof input === 'string' ? input : JSON.stringify(input);
    return json.length > 140 ? `${json.slice(0, 137)}…` : json;
  } catch {
    return String(input).slice(0, 140);
  }
}

function describeError(err: unknown): string {
  if (err instanceof DOMException) return `${err.name}: ${err.message}`;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
