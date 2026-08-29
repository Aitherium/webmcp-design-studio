/**
 * The in-page agent tool loop — a clean-room reimplementation of the Hermes
 * tool-loop pattern (<tools> / <tool_call> / <tool_response> rendering +
 * lenient parsing). No proprietary runtime code is imported; the pattern is
 * reimplemented from its public specification.
 *
 * "Our agent speaks the same protocol the browser agent does": when the real
 * WebMCP surface exists (`document.modelContext`), the loop discovers and
 * executes tools through `getTools()` / `executeTool()` — the browser mediates,
 * exactly like ChatGPT's agent. The registry/polyfill direct path is used only
 * when the API is absent.
 *
 * Parsing is deliberately lenient: a 0.6-4B model malforms XML often (missing
 * opening tag, trailing commas, single quotes). A parse failure must surface
 * VISIBLY (the raw text stays in the transcript) — never silently degrade to
 * an answer that pretends no tool existed.
 */
import type { ChatMessage, ChatWorkerLike, WorkerResponse } from './loader';
import type { ModelContextSurface, RegisteredTool } from '../webmcp/types';
import { TOOL_DEFINITIONS } from '../webmcp/tools';

export interface ToolSpec {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** Hard cap on execute→regenerate rounds per user turn (loop protection). */
export const MAX_TOOL_ROUNDS = 3;

/**
 * The <tools> declaration block — byte-compatible with the chat template the
 * worker's tokenizer renders inside the system turn.
 */
export function renderToolsSystemBlock(specs: ToolSpec[]): string {
  let out = 'You may call functions to help answer the user.\n\n';
  out += 'You are provided with function signatures within <tools></tools> XML tags:\n';
  out += '<tools>';
  for (const tool of specs) out += '\n' + JSON.stringify(tool);
  out += '\n</tools>\n\n';
  out += 'For each function call, return a json object with function name and ';
  out += 'arguments within <tool_call></tool_call> XML tags:\n';
  out += '<tool_call>\n{"name": <function-name>, "arguments": <args-json-object>}\n</tool_call>';
  return out;
}

export interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
  raw: string;
}

/** Extract tool calls from generated text; `rest` is the text with calls removed. */
export function parseToolCalls(text: string): { calls: ParsedToolCall[]; rest: string } {
  const calls: ParsedToolCall[] = [];
  let rest = text;
  // Well-formed pairs first; then a lone opening tag to end-of-text (truncated
  // generations stop mid-call more often than they close the tag).
  const patterns = [
    /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g,
    /<tool_call>\s*(\{[\s\S]*\})\s*$/g,
  ];
  for (const re of patterns) {
    rest = rest.replace(re, (whole, body: string) => {
      const parsed = tryParseCallBody(body);
      if (parsed) {
        calls.push({ ...parsed, raw: whole });
        return '';
      }
      return whole; // unparseable — leave it visible in the transcript
    });
    if (calls.length) break;
  }
  return { calls, rest: rest.trim() };
}

function tryParseCallBody(body: string): { name: string; arguments: Record<string, unknown> } | null {
  const candidates = [
    body,
    // Nested-wrapper repair: a small model sometimes re-wraps its own call —
    // <tool_call><tool_call>{json}</tool_call></tool_call>. The outer regex
    // stops at the FIRST close, so the body carries a stray opening tag.
    // Measured live 2026-08-29 on bonsai-8b: rounds 2-3 nested exactly this way.
    body.replace(/<\/?tool_call>/g, '').trim(),
    // Small-model repairs: trailing commas, single→double quotes on keys.
    body.replace(/,\s*([}\]])/g, '$1'),
    body.replace(/'/g, '"').replace(/,\s*([}\]])/g, '$1'),
    body.replace(/<\/?tool_call>/g, '').replace(/,\s*([}\]])/g, '$1').trim(),
    body.replace(/<\/?tool_call>/g, '').replace(/'/g, '"').replace(/,\s*([}\]])/g, '$1').trim(),
  ];
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c) as { name?: unknown; arguments?: unknown; parameters?: unknown };
      const name = obj?.name;
      if (typeof name === 'string' && name) {
        const args = obj.arguments ?? obj.parameters ?? {};
        return { name, arguments: typeof args === 'object' && args ? (args as Record<string, unknown>) : {} };
      }
    } catch {
      /* try next repair */
    }
  }
  return null;
}

/** Build the tool specs the loop declares — inputSchema is the same JSON Schema. */
export function toolSpecsFromDefinitions(): ToolSpec[] {
  return TOOL_DEFINITIONS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: {
      type: 'object' as const,
      properties: (t.inputSchema.properties ?? {}) as Record<string, unknown>,
      required: t.inputSchema.required as string[] | undefined,
    },
  }));
}

/* ── execution through the REAL WebMCP API ────────────────────────────────── */

export interface ToolExecutor {
  (name: string, args: Record<string, unknown>): Promise<string>;
}

/**
 * Execute one tool call. When the real WebMCP surface exists, the call goes
 * through the BROWSER: getTools() → executeTool() — the same protocol the
 * judge's agent uses. Otherwise it runs directly against the tool registry
 * (polyfill/absent surface).
 */
export function createToolExecutor(opts?: {
  surface?: ModelContextSurface | null;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
}): ToolExecutor {
  const surface = opts?.surface === undefined ? webmcpSurface() : opts.surface;
  // Small-model tolerance: the on-device brain mangles case and spacing —
  // measured live 2026-08-29 (bonsai-8b emitted create-Design / list-Designs /
  // get-Design-State — every one a case error away from a real tool). A
  // strict exact match turned each into a "not registered" response that the
  // model amplified into nesting + stutter until the round cap. The registry
  // is case-normalized, so the RESOLVED name is what the surface executes.
  const norm = (s: string) => s.trim().toLowerCase();
  return async (name, args) => {
    opts?.onToolCall?.(name, args);
    if (surface) {
      let tools: RegisteredTool[] = [];
      try {
        tools = await surface.getTools();
      } catch {
        tools = [];
      }
      const registered = tools.find((t) => norm(t.name) === norm(name));
      if (registered) {
        try {
          // The spec: executeTool resolves to a DOMString (stringified).
          // Chrome 152 reality (measured D4, 2026-08-25): the SECOND argument
          // is also a DOMString — a bare object throws
          // `UnknownError: Failed to parse input arguments`. Stringify here
          // so the polyfill and the real API agree.
          return await surface.executeTool(registered, JSON.stringify(args));
        } catch (err) {
          return `tool '${name}' failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      const available = tools.map((t) => t.name).join(', ') || '(none)';
      return `tool '${name}' is not registered on the WebMCP surface right now — available: ${available}. Call get-design-state or list-designs to see the current state.`;
    }
    // Direct registry path (no WebMCP API at all).
    const def = TOOL_DEFINITIONS.find((t) => norm(t.name) === norm(name));
    if (!def) {
      return `unknown tool '${name}' — available: ${TOOL_DEFINITIONS.map((t) => t.name).join(', ')}`;
    }
    try {
      const out = await def.execute(args, { signal: new AbortController().signal });
      return typeof out === 'string' ? out : JSON.stringify(out);
    } catch (err) {
      return `tool '${name}' failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

function webmcpSurface(): ModelContextSurface | null {
  const doc = (document as { modelContext?: ModelContextSurface }).modelContext;
  if (doc) return doc;
  return (navigator as { modelContext?: ModelContextSurface }).modelContext ?? null;
}

/* ── the loop ─────────────────────────────────────────────────────────────── */

export interface LoopCallbacks {
  /** Streamed answer tokens as they arrive (channel 'answer'). */
  onToken?: (text: string) => void;
  /** A tool call was parsed out of the model's output. */
  onToolCall?: (call: ParsedToolCall, round: number) => void;
  /** A tool call was executed; `response` is what the model will see. */
  onToolResult?: (call: ParsedToolCall, response: string, round: number) => void;
  /** The loop gave up (rounds exhausted) — the raw text is still returned. */
  onMaxRounds?: (lastText: string) => void;
}

export interface LoopOptions extends LoopCallbacks {
  worker: ChatWorkerLike;
  systemPrompt: string;
  userMessage: string;
  executor: ToolExecutor;
  maxTokens?: number;
  temperature?: number;
  maxRounds?: number;
}

export interface LoopResult {
  text: string;
  rounds: number;
  toolCalls: ParsedToolCall[];
  exhausted: boolean;
}

/**
 * Transcript merge for the FINAL answer. Streamed token deltas are a PREVIEW;
 * the worker's assembled `done` text is the truth — it trims partial-token
 * artifacts the stream cannot (measured live 2026-08-29, on-device 8B: the
 * stream doubled every word into "TheThe design design for for your your…"
 * while the assembled reply was clean, and the tool call in the same turn
 * was perfectly formed). Returns the transcript with the last agent bubble
 * replaced by the final text; appends when nothing streamed.
 */
export function applyFinalAnswer<T extends { role: string; text: string }>(bubbles: T[], finalText: string): T[] {
  if (!finalText.trim()) return bubbles;
  const next = [...bubbles];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].role === 'agent') {
      next[i] = { ...next[i], text: finalText };
      return next;
    }
  }
  next.push({ role: 'agent' as const, text: finalText } as T);
  return next;
}

/**
 * Run one user turn: generate → parse <tool_call>s → execute through the
 * executor → append role:'tool' → regenerate, up to MAX_TOOL_ROUNDS.
 */
export async function runToolLoop(opts: LoopOptions): Promise<LoopResult> {
  const maxRounds = opts.maxRounds ?? MAX_TOOL_ROUNDS;
  const messages: ChatMessage[] = [
    { role: 'system', content: opts.systemPrompt },
    { role: 'user', content: opts.userMessage },
  ];
  const allCalls: ParsedToolCall[] = [];
  let exhausted = false;

  for (let round = 0; round < maxRounds; round++) {
    const text = await generateOnce(opts, messages);
    const { calls, rest } = parseToolCalls(text);
    if (calls.length === 0) {
      return { text, rounds: round + 1, toolCalls: allCalls, exhausted: false };
    }

    for (const call of calls) {
      allCalls.push(call);
      opts.onToolCall?.(call, round);
      // Keep the assistant turn in the transcript: its visible text (rest) and
      // the call itself — the worker's template renders role:'tool' as
      // <tool_response>, closing the cycle.
      messages.push({ role: 'assistant', content: rest || text });
      const response = await opts.executor(call.name, call.arguments);
      opts.onToolResult?.(call, response, round);
      messages.push({ role: 'tool', content: response });
    }
  }

  exhausted = true;
  // Rounds exhausted: report the LAST answer (no tool re-entry).
  const last = messages[messages.length - 1];
  const text = last?.role === 'assistant' ? last.content : '';
  opts.onMaxRounds?.(text);
  return { text, rounds: maxRounds, toolCalls: allCalls, exhausted };
}

function generateOnce(
  opts: LoopOptions,
  messages: ChatMessage[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    let done = false;
    let unsub: (() => void) | void;
    const finish = (err: Error | null) => {
      if (done) return;
      done = true;
      unsub?.();
      if (err) reject(err);
      else resolve(text);
    };
    const onMsg = (msg: WorkerResponse) => {
      if (msg.type === 'token' && msg.channel !== 'thinking') {
        text += msg.text;
        opts.onToken?.(msg.text);
      } else if (msg.type === 'done') {
        if (msg.text) {
          if (!text) {
            // Non-streaming runtimes deliver the whole reply in `done`.
            text = msg.text;
            opts.onToken?.(msg.text);
          } else {
            // Streaming path: prefer the final assembled reply over the deltas
            // (the worker trims partial-token artifacts from the stream).
            text = msg.text;
          }
        }
        finish(null);
      } else if (msg.type === 'error') {
        finish(new Error(msg.message));
      }
    };
    unsub = opts.worker.on(onMsg);
    opts.worker.post({
      type: 'generate',
      messages,
      maxTokens: opts.maxTokens ?? 512,
      temperature: opts.temperature ?? 0.7,
    });
  });
}
