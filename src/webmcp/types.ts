/**
 * Spec-faithful WebMCP types (from the WebMCP explainer / index.bs IDL).
 *
 * `document.modelContext` is the entry point (Chrome 150+); the pre-150
 * spelling `navigator.modelContext` is the fallback. See registry.ts for the
 * detection, polyfill.ts for the dev/non-Chrome shim.
 */
import type { PendingBatch, DesignDoc } from '../state/doc';

/** `ModelContextTool` — what registerTool accepts (index.bs). */
export interface ModelContextTool {
  /** `[a-zA-Z0-9_.-]`, ≤128 chars. Required. */
  name: string;
  title?: string;
  /** Agent-facing description. Required. */
  description: string;
  /** JSON Schema object. Required; must be JSON-serializable. */
  inputSchema: Record<string, unknown>;
  /**
   * Receives the validated input object plus an AbortSignal. The return
   * value is JSON-stringified and handed to the agent as a DOMString.
   */
  execute: (input: Record<string, unknown>, options: { signal: AbortSignal }) => Promise<unknown>;
  annotations?: ToolAnnotations;
}

/** Tool annotations — the WebMCP pair (readOnly / untrustedContent) plus the
 * MCP-standard destructive / idempotent hints the fleet tools declare. */
export interface ToolAnnotations {
  /** Tool does not mutate state. */
  readOnlyHint?: boolean;
  /** Output may contain untrusted content. */
  untrustedContentHint?: boolean;
  /** Tool may perform destructive updates (MCP). */
  destructiveHint?: boolean;
  /** Repeating the call with the same args has no additional effect (MCP). */
  idempotentHint?: boolean;
}

/** Callback signature of `execute`. */
export type ToolExecuteCallback = ModelContextTool['execute'];

/** `RegisteredTool` — what getTools() resolves to (index.bs). */
export interface RegisteredTool {
  name: string;
  title?: string;
  description: string;
  /** Deep copy of the registration-time schema. */
  inputSchema: Record<string, unknown>;
  /** The window that registered the tool. */
  window: Window | null;
  /** Origin of the registering document. */
  origin: string | null;
  annotations?: ToolAnnotations;
}

/** `registerTool(tool, options)` — index.bs. */
export interface RegisterOptions {
  /** Origins this tool is exposed to (registerer side of cross-origin). */
  exposedTo?: string[];
  /** Aborting this signal unregisters the tool. */
  signal?: AbortSignal;
}

export interface GetToolsOptions {
  /** Origins to include in addition to same-origin documents in the tree. */
  fromOrigins?: string[];
}

/**
 * Our registry entry: a ModelContextTool plus an availability predicate
 * driving dynamic registration (`available(state)` false → unregistered).
 */
export interface ToolDefinition extends ModelContextTool {
  available?: (state: StudioStateLike) => boolean;
}

/**
 * The slice of store state predicates need. Structural only — a predicate
 * must never read element data.
 */
export interface StudioStateLike {
  docs: readonly DesignDoc[];
  currentDocId: string | null;
  pendingBatch: PendingBatch | null;
  /** P1.3: true while the current design has committed versions to roll
   * back (the version stacks are a store closure, so this is exposed). */
  canUndo: boolean;
}

/** One line of the protocol feed (P1.2, 2026-08-31) — the WebMCP Leverage
 * exhibit: register/unregister/toolchange/execute recorded by the registry,
 * rendered as a monospace scrollback so a judge SEES the protocol working. */
export interface ProtocolEvent {
  ts: number;
  /** `step`: one sub-step of a COMPOUND tool (iris-produce, 2026-09-03) —
   * `tool` is the step name (`iris.enhance`), `detail` its one-line summary,
   * `ok`/`elapsedMs` the outcome. Pushed by the tool itself, not the registry. */
  kind: 'register' | 'unregister' | 'toolchange' | 'execute' | 'step';
  tool: string;
  /** execute: the input args (JSON, truncated). toolchange: the delta. step: the summary. */
  detail?: string;
  ok?: boolean;
  elapsedMs?: number;
}

/** The runtime surface we register against. The real browser API satisfies
 * this structurally; the polyfill implements it literally. */
export interface ModelContextSurface {
  registerTool(tool: ModelContextTool, options?: RegisterOptions): Promise<void>;
  getTools(options?: GetToolsOptions): Promise<RegisteredTool[]>;
  executeTool(
    tool: RegisteredTool | string,
    input?: Record<string, unknown> | string,
    options?: { signal?: AbortSignal },
  ): Promise<string>;
  addEventListener(type: 'toolchange', listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: 'toolchange', listener: EventListenerOrEventListenerObject): void;
  /** Present only on our shim — always visible in the UI. */
  readonly isPolyfill?: boolean;
}

/** Validate a tool name against the spec charset + length. */
export function isValidToolName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 128 &&
    /^[a-zA-Z0-9_.-]+$/.test(name)
  );
}
