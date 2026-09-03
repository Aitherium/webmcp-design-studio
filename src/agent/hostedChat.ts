/**
 * OpenAI-compatible agent lanes — a ChatWorkerLike over any
 * /chat/completions endpoint with SSE streaming.
 *
 * TWO lanes share this adapter:
 *
 * 1. The HOSTED fleet lane — talks to the fleet's llama.cpp server through
 *    the tunnel host (same-origin `/api/chat/` on studio-preview.aitherium.com,
 *    proxied to aither-llamacpp-bonsai:8090). Why it exists (measured
 *    2026-08-28): a device without WebGPU (Tier C) had NO agent brain — the
 *    loader's on-device worker cannot start, and the studio claimed a "hosted
 *    tier" that did not exist. The design tools always worked; the agent could
 *    not think.
 *
 * 2. The CUSTOM BYOK lane (2026-08-30, the WebMCP Challenge "bring your own
 *    agent" feature) — a visitor plugs in their OWN OpenAI-compatible endpoint
 *    + API key + model name, and their agent drives the studio's 14 WebMCP
 *    tools through the same `runToolLoop`. The loop's protocol is
 *    model-agnostic (the tools live in the SYSTEM PROMPT as the Hermes
 *    `<tools>` XML block, no tools array on the wire), so GPT, Claude via
 *    gateway, local llama.cpp, vLLM — anything that speaks
 *    /v1/chat/completions — can drive the surface. "Your agent, our tools."
 *
 * role:'tool' messages are translated to role:'user' wrapped in
 * <tool_response> on the wire, mirroring what the on-device worker's
 * template renders (llama.cpp's native 'tool' role would fight the XML
 * convention; OpenAI-compatible servers accept the text form).
 */
import type { ChatWorkerLike, WorkerRequest, WorkerResponse } from './loader';

/**
 * Same-origin on the tunnel host; override per build with VITE_HOSTED_BASE.
 * On the PUBLIC origin (studio.aitherium.com is GitHub Pages — static, no
 * /api/chat/ of its own) the fleet lane is reached CROSS-ORIGIN through the
 * tunnel host's nginx proxy, which now answers CORS for this origin
 * (measured live 2026-08-30: completion 200 in 10s with
 * access-control-allow-origin: https://studio.aitherium.com).
 */
const HOSTED_BASE =
  (import.meta.env?.VITE_HOSTED_BASE as string | undefined) ??
  (typeof window !== 'undefined' && window.location.hostname === 'studio.aitherium.com'
    ? 'https://studio-preview.aitherium.com/api/chat'
    : '/api/chat');
const HOSTED_MODEL = 'bonsai-27b';

/** The SECOND fleet text lane — the orchestrator vLLM behind the studio's own
 * nginx (/api/chat2/ -> aither-vllm-fp16, CORS stamped by the proxy). Bonsai is
 * a 27B on one consumer GPU and segfaults when that card saturates (measured
 * 2026-09-01: a judge-facing turn died with "agent failed: network error"). A
 * turn that fails on the primary before producing a token is replayed here. */
const HOSTED_FALLBACK_BASE =
  (import.meta.env?.VITE_HOSTED_FALLBACK_BASE as string | undefined) ??
  (typeof window !== 'undefined' && window.location.hostname === 'studio.aitherium.com'
    ? 'https://studio-preview.aitherium.com/api/chat2'
    : '/api/chat2');
const HOSTED_FALLBACK_MODEL = 'aither-orchestrator-8b';

export interface OpenAICompatibleWorkerOptions {
  /** Ask a reasoning model to answer directly instead of thinking first.
   * Measured 2026-09-02 on the fleet 27B with a tool-shaped turn:
   *   thinking ON, 2048 tokens  → 40.35 s, create-design, 1083 reasoning chars
   *   thinking OFF, 512         →  3.99 s, create-design, args parse
   *   thinking OFF, 2048        →  2.36 s, create-design, args parse
   * Same tool, same valid arguments, 17x faster — so the August workaround
   * (give every lane 2048 tokens of headroom) was paying for thinking the
   * agent never needed. Fleet lanes only: a visitor's BYOK endpoint may be
   * OpenAI proper, which rejects unknown body fields. */
  disableThinking?: boolean;
  /** Base — accepts 'https://host', 'https://host/v1' or a full
   * '/chat/completions' URL; the adapter normalizes. */
  baseUrl: string;
  model: string;
  /** Sent as `Authorization: Bearer` when set (BYOK). */
  apiKey?: string;
}

/** Normalize a user-supplied base URL to the full /chat/completions URL. */
export function chatCompletionsUrl(base: string): string {
  const b = base.trim().replace(/\/+$/, '');
  if (!b) return '';
  if (b.endsWith('/chat/completions')) return b;
  if (b.endsWith('/v1')) return `${b}/chat/completions`;
  return `${b}/v1/chat/completions`;
}

function wireMessages(messages: WorkerRequest & { type: 'generate' }) {
  return messages.messages.map((m) =>
    m.role === 'tool'
      ? { role: 'user' as const, content: `<tool_response>\n${m.content}\n</tool_response>` }
      : m,
  );
}

export function createOpenAICompatibleWorker(opts: OpenAICompatibleWorkerOptions): ChatWorkerLike {
  const url = chatCompletionsUrl(opts.baseUrl);
  let disposed = false;
  const listeners = new Set<(msg: WorkerResponse) => void>();
  let controller: AbortController | null = null;

  const emit = (msg: WorkerResponse) => {
    for (const l of [...listeners]) l(msg);
  };

  const post = async (msg: WorkerRequest) => {
    if (msg.type !== 'generate' || disposed) return;
    if (!url) {
      emit({ type: 'error', message: 'custom agent: no base URL configured' });
      return;
    }
    controller = new AbortController();
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: opts.model,
          messages: wireMessages(msg),
          // Reasoning models write AFTER thinking — the loop's 512-token
          // default got consumed by reasoning and the answer came back empty
          // (measured 2026-08-28 on the fleet 27B). Give every lane headroom.
          max_tokens: Math.max(msg.maxTokens ?? 512, 2048),
          temperature: msg.temperature ?? 0.7,
          stream: true,
          ...(opts.disableThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
        }),
      });
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '');
        emit({
          type: 'error',
          message: `agent HTTP ${res.status}${detail ? ': ' + detail.slice(0, 200) : ''}`,
        });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let full = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const j = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const delta = j.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              full += delta;
              emit({ type: 'token', text: delta });
            }
          } catch {
            /* partial SSE chunk — skip */
          }
        }
      }
      emit({ type: 'done', text: full });
    } catch (err) {
      if (!disposed) {
        emit({
          type: 'error',
          message: `agent failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  };

  return {
    post,
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    interrupt() {
      controller?.abort();
    },
    dispose() {
      disposed = true;
      controller?.abort();
      listeners.clear();
    },
  };
}

/**
 * Primary/secondary pair: a request that ERRORS on the primary before any
 * token was streamed is replayed on the secondary, and the secondary's events
 * are relayed as if they were the primary's. A request that already streamed
 * output is never replayed (the user would see the answer twice). Interrupt
 * and dispose fan out to both.
 */
export function createFallbackChatWorker(
  primary: ChatWorkerLike,
  secondary: ChatWorkerLike,
  onFallback?: (reason: string) => void,
): ChatWorkerLike {
  const listeners = new Set<(msg: WorkerResponse) => void>();
  let last: WorkerRequest | null = null;
  let sawOutput = false;
  let active: 'primary' | 'secondary' = 'primary';
  const emit = (msg: WorkerResponse) => {
    for (const l of listeners) l(msg);
  };
  primary.on((msg) => {
    if (active !== 'primary') return;
    if (msg.type === 'error' && !sawOutput && last) {
      active = 'secondary';
      onFallback?.(msg.message);
      secondary.post(last);
      return;
    }
    if (msg.type === 'token') sawOutput = true;
    emit(msg);
  });
  secondary.on((msg) => {
    if (active === 'secondary') emit(msg);
  });
  return {
    post(msg) {
      last = msg;
      sawOutput = false;
      active = 'primary';
      primary.post(msg);
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    interrupt() {
      primary.interrupt();
      secondary.interrupt();
    },
    dispose() {
      primary.dispose();
      secondary.dispose();
      listeners.clear();
    },
  };
}

/** The fleet brain lane — Bonsai through the studio's proxy, with the
 * orchestrator lane as the fallback for a turn that fails before its first token. */
export function createHostedChatWorker(): ChatWorkerLike {
  return createFallbackChatWorker(
    createOpenAICompatibleWorker({ baseUrl: HOSTED_BASE, model: HOSTED_MODEL, disableThinking: true }),
    createOpenAICompatibleWorker({ baseUrl: HOSTED_FALLBACK_BASE, model: HOSTED_FALLBACK_MODEL, disableThinking: true }),
    (reason) => {
      // eslint-disable-next-line no-console
      console.warn(`[fleet] primary text lane failed (${reason}) — replaying on the orchestrator lane`);
    },
  );
}
