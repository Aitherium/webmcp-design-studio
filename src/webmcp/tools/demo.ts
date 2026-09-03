/**
 * demo-credits / gpu-burst (lane 3, 2026-09-03) — the visitor's allowance and
 * the on-demand cloud GPU, both governed server-side by
 * `AitherOS/services/studio/demo_governor.py` (`/api/demo/`).
 *
 * demo-credits is read-only: the balances + the owner's policy, so an agent
 * can answer "how much demo is left?" and plan its turns.
 *
 * gpu-burst RENTS a cloud GPU (vast.ai through MediaForge) under the OWNER'S
 * daily cap. The governor is the only door to that spend: it refuses with a
 * reason a UI can show (402 credits_exhausted, 429 daily_burst_cap_reached /
 * burst_disabled, 502 burst_up_failed) and tears an idle instance down after
 * `burst_idle_teardown_min`. Refusals come back as `{isError:true}` carrying
 * the server's reason — and, for credits_exhausted, its `fix` — so the
 * agent's next step is named rather than guessed.
 */
import type { ToolDefinition } from '../types';
import { ok, fail } from '../execute-io';
import { argEnum, ToolError } from './helpers';
import {
  CreditsExhausted,
  DemoRefused,
  ensureVisitor,
  getBurstStatus,
  releaseBurst,
  requestBurst,
} from '../../demo/credits';

export const BURST_ACTIONS = ['status', 'request', 'release'] as const;
export type BurstAction = (typeof BURST_ACTIONS)[number];

/** Shape a governor refusal for the agent: reason always, fix when the server gave one. */
export function refusalText(err: unknown): string {
  if (err instanceof CreditsExhausted) {
    return JSON.stringify({ reason: err.reason, fix: err.fix });
  }
  if (err instanceof DemoRefused) {
    const extra: Record<string, unknown> = {};
    if (typeof err.detail.usd_left_today === 'number') extra.usd_left_today = err.detail.usd_left_today;
    if (typeof err.detail.error === 'string') extra.error = err.detail.error;
    return JSON.stringify({ reason: err.reason, status: err.status, ...extra });
  }
  return JSON.stringify({ reason: 'demo_governor_unreachable', error: err instanceof Error ? err.message : String(err) });
}

export const demoCreditsTool: ToolDefinition = {
  name: 'demo-credits',
  title: 'Demo credits left',
  description:
    'Read this visitor\'s demo allowance: hosted turns and dollars left, plus the owner\'s policy (turns/usd per visitor, daily GPU-burst cap). Hosted (fleet) turns are metered; on-device and bring-your-own-key lanes are free.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  annotations: { readOnlyHint: true },
  available: () => true,
  async execute() {
    try {
      const c = await ensureVisitor();
      return ok(
        JSON.stringify({
          turns_left: c.turns_left,
          usd_left: c.usd_left,
          policy: c.policy,
        }),
      );
    } catch (e) {
      return fail(refusalText(e));
    }
  },
};

export const gpuBurstTool: ToolDefinition = {
  name: 'gpu-burst',
  title: 'Cloud GPU burst',
  description:
    'Rent a cloud GPU (ComfyUI) on demand for heavy image/media work. It costs the OWNER real money under a daily cap — the governor refuses past the cap or when this visitor\'s credits are gone, and tears the GPU down after idle. action: status | request (returns comfyui_url, gpu, price_per_hour, usd_left_today) | release.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: [...BURST_ACTIONS], description: 'status | request | release' },
    },
    required: ['action'],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  available: () => true,
  async execute(args) {
    try {
      const action = argEnum(args, 'action', BURST_ACTIONS) as BurstAction | undefined;
      if (!action) throw new ToolError('"action" is required');
      if (action === 'status') {
        const s = await getBurstStatus();
        return ok(
          JSON.stringify({
            up: s.up,
            gpu: s.gpu,
            price_per_hour: s.price_per_hour,
            hours_up: s.hours_up,
            usd_left_today: s.usd_left_today,
            policy: s.policy,
          }),
        );
      }
      if (action === 'request') {
        const g = await requestBurst();
        return ok(
          JSON.stringify({
            comfyui_url: g.comfyui_url,
            gpu: g.gpu,
            price_per_hour: g.price_per_hour,
            usd_left_today: g.usd_left_today,
            reused: g.reused,
          }),
        );
      }
      const r = await releaseBurst();
      return ok(JSON.stringify({ released: r.ok, was_up: r.was_up }));
    } catch (e) {
      if (e instanceof ToolError) return fail(e.message);
      return fail(refusalText(e));
    }
  },
};

export const DEMO_TOOLS: ToolDefinition[] = [demoCreditsTool, gpuBurstTool];
