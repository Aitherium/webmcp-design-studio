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
import type { ModelContextSurface, ModelContextTool, RegisteredTool, StudioStateLike, ToolDefinition } from './types';
import { TOOL_DEFINITIONS } from './tools';
import type { WebMCPStatus } from '../state/store';

export interface RegistryCallbacks {
  /** Status changes (surface kind + LOUD failures). */
  onStatus(status: WebMCPStatus): void;
  /** Live tool names after every register/unregister (toolchange UI). */
  onToolsChanged?(names: string[]): void;
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
        // Abort = unregister (spec). Clean bookkeeping; the browser fires
        // `toolchange` itself — we never synthesize it.
        this.registered.delete(def.name);
        this.controllers.delete(def.name);
      },
      { once: true },
    );

    const tool: ModelContextTool = {
      name: def.name,
      title: def.title,
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: def.annotations,
      execute: def.execute,
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
    } catch (err) {
      controller.abort(); // never leave a half-registered controller behind
      this.failures.set(def.name, describeError(err));
    }
  }

  private abortTool(name: string): void {
    const controller = this.controllers.get(name);
    if (controller) controller.abort();
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
      this.callbacks.onToolsChanged?.(tools.map((t: RegisteredTool) => t.name).sort());
    } catch (err) {
      this.failures.set('(getTools)', describeError(err));
      this.emitStatus();
    }
  }
}

function describeError(err: unknown): string {
  if (err instanceof DOMException) return `${err.name}: ${err.message}`;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
