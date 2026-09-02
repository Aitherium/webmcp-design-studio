/**
 * One-shot, non-streaming completion against the SAME text lane the in-page
 * agent uses (fleet Bonsai, the visitor's BYOK endpoint, or the orchestrator
 * fallback). The streaming worker in hostedChat.ts is the right shape for a
 * conversation; a tool that fans N drafts out at once wants a plain promise.
 *
 * Why fan-out is worth a helper at all — measured 2026-09-02 on this fleet
 * with AitherOS/dev/tools/bench_lane_concurrency.py: the orchestrator vLLM
 * served 16 concurrent 96-token completions in 1.6 s wall (≈61 tok/s each,
 * ~1000 aggregate) versus 0.5-1.3 s for a single one. Sixteen answers for
 * roughly the price of one is a product decision, not a micro-optimization:
 * the agent can offer the human options instead of one draft.
 */
import { chatCompletionsUrl } from './hostedChat';
import { loadTextAgentConfig, type TextAgentConfig } from './textAgentConfig';

/** Where a one-shot completion should go, given the panel's configuration. */
export interface TextLane {
  url: string;
  model: string;
  apiKey?: string;
  /** 'on-device' resolves to the fleet lane — a tool cannot drive the WebGPU
   * worker, and a dead end is worse than a hosted call (the D-2291 lesson
   * from the image tool, where an on-device panel choice made the hosted tier
   * answer "no backend configured" while the fleet lane sat unused). */
  resolvedFrom: TextAgentConfig['mode'];
}

const FLEET_BASE =
  (import.meta.env?.VITE_HOSTED_BASE as string | undefined) ??
  (typeof window !== 'undefined' && window.location.hostname === 'studio.aitherium.com'
    ? 'https://studio-preview.aitherium.com/api/chat'
    : '/api/chat');
const FLEET_MODEL = 'bonsai-27b';

export function resolveTextLane(cfg: TextAgentConfig = loadTextAgentConfig()): TextLane {
  if (cfg.mode === 'custom' && cfg.baseUrl.trim()) {
    return {
      url: chatCompletionsUrl(cfg.baseUrl),
      model: cfg.model.trim() || 'gpt-4o-mini',
      apiKey: cfg.apiKey.trim() || undefined,
      resolvedFrom: 'custom',
    };
  }
  return { url: chatCompletionsUrl(FLEET_BASE), model: FLEET_MODEL, resolvedFrom: cfg.mode };
}

export interface CompleteOnceOptions {
  lane: TextLane;
  prompt: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

/** POST one chat completion and return its message text. Throws with the hop
 * named on any failure — a caller fanning out needs to know WHICH one died. */
export async function completeOnce(opts: CompleteOnceOptions): Promise<string> {
  const { lane, prompt, system, maxTokens = 220, temperature = 0.9, signal } = opts;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (lane.apiKey) headers.Authorization = `Bearer ${lane.apiKey}`;
  const messages = system
    ? [{ role: 'system', content: system }, { role: 'user', content: prompt }]
    : [{ role: 'user', content: prompt }];
  let res: Response;
  try {
    res = await fetch(lane.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: lane.model, messages, max_tokens: maxTokens, temperature, stream: false }),
      signal,
    });
  } catch (err) {
    throw new Error(`text lane unreachable at ${lane.url}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`text lane HTTP ${res.status} at ${lane.url}${detail ? `: ${detail.slice(0, 160)}` : ''}`);
  }
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }>;
  };
  const choice = body.choices?.[0]?.message;
  const text = typeof choice?.content === 'string' ? choice.content.trim() : '';
  if (text) return text;
  // Reasoning models can spend the whole budget thinking and return an EMPTY
  // content with the thoughts in reasoning_content (measured on bonsai-27b,
  // 2026-09-02) — that is a budget problem, not an empty answer, and saying so
  // is more useful than returning "".
  const thought = typeof choice?.reasoning_content === 'string' ? choice.reasoning_content.trim() : '';
  throw new Error(
    thought
      ? 'the model spent its whole token budget reasoning and returned no answer — raise max_tokens'
      : 'the text lane returned no message content',
  );
}
