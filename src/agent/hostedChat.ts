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

export interface OpenAICompatibleWorkerOptions {
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

/** The fleet brain lane — the same adapter pointed at the studio's proxy. */
export function createHostedChatWorker(): ChatWorkerLike {
  return createOpenAICompatibleWorker({ baseUrl: HOSTED_BASE, model: HOSTED_MODEL });
}
