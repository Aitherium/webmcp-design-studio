/**
 * The HOSTED agent lane — a ChatWorkerLike that talks to the fleet's
 * llama.cpp server through the tunnel host (same-origin `/api/chat/` on
 * studio-preview.aitherium.com, proxied to aither-llamacpp-bonsai:8090).
 *
 * Why this exists (measured 2026-08-28): a device without WebGPU (Tier C)
 * had NO agent brain — the loader's on-device worker cannot start, and the
 * studio claimed a "hosted tier" that did not exist. The design tools always
 * worked; the agent could not think. This lane gives Tier C devices the same
 * agent over the same `runToolLoop`, with the model's TEXT output flowing
 * through the same <tool_call> XML parsing as the on-device worker — no tools
 * array is sent, so llama.cpp stays in plain-text mode and the model follows
 * the XML spec in the system prompt (proven live: the 27B emitted a correct
 * create-design call from the XML block).
 *
 * role:'tool' messages are translated to role:'user' wrapped in
 * <tool_response> on the wire, mirroring what the on-device worker's
 * template renders (llama.cpp's native 'tool' role would fight the XML
 * convention).
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

function wireMessages(messages: WorkerRequest & { type: 'generate' }) {
  return messages.messages.map((m) =>
    m.role === 'tool'
      ? { role: 'user' as const, content: `<tool_response>\n${m.content}\n</tool_response>` }
      : m,
  );
}

export function createHostedChatWorker(): ChatWorkerLike {
  let disposed = false;
  const listeners = new Set<(msg: WorkerResponse) => void>();
  let controller: AbortController | null = null;

  const emit = (msg: WorkerResponse) => {
    for (const l of [...listeners]) l(msg);
  };

  const post = async (msg: WorkerRequest) => {
    if (msg.type !== 'generate' || disposed) return;
    controller = new AbortController();
    try {
      const res = await fetch(`${HOSTED_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: HOSTED_MODEL,
          messages: wireMessages(msg),
          // The 27B reasons BEFORE it writes content — the loop's 512-token
          // default got consumed by reasoning and the answer came back empty
          // (measured 2026-08-28). Give the hosted lane real headroom.
          max_tokens: Math.max(msg.maxTokens ?? 512, 2048),
          temperature: msg.temperature ?? 0.7,
          stream: true,
        }),
      });
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '');
        emit({
          type: 'error',
          message: `hosted agent HTTP ${res.status}${detail ? ': ' + detail.slice(0, 200) : ''}`,
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
          message: `hosted agent failed: ${err instanceof Error ? err.message : String(err)}`,
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
