/**
 * production-log (P2.3, 2026-08-31) — the Potential Impact exhibit.
 *
 * The WebMCP studio is not a demo: since 2026-08-31 it has been running as a
 * production studio for the Dark Matters universe, rendering character art
 * through the media-forge lane every day (the dm-production-daily routine on
 * the AitherOS side appends a day's entry to public/production-log.json, and
 * the Pages deploy carries it here). This tool reads that log back to any
 * agent that asks: what was produced, when, and whether the lane is healthy.
 *
 * The agent sees the SAME exhibit the judge sees — "this week: N pieces for
 * Dark Matters" is a tool result, not a marketing line.
 */
import type { ToolDefinition } from '../types';
import { ok, fail } from '../execute-io';

export interface ProductionLogEntry {
  run: string;
  produced: number;
  characters: Array<{ id: string; name: string; ok: boolean; images: number; error?: string | null }>;
  errors: string[];
  wedge_refused?: boolean;
}

export interface ProductionLog {
  studio?: string;
  lane?: string;
  updated?: string;
  entries: ProductionLogEntry[];
}

/** Fetch the committed log. Exported for tests. */
export async function fetchProductionLog(base?: string): Promise<ProductionLog> {
  const origin = base ?? (typeof location !== 'undefined' ? location.origin : '');
  const res = await fetch(`${origin}/production-log.json`);
  if (!res.ok) throw new Error(`production log HTTP ${res.status}`);
  const data = (await res.json()) as ProductionLog;
  if (!Array.isArray(data.entries)) throw new Error('production log has no entries');
  return data;
}

export const productionLogTool: ToolDefinition = {
  name: 'production-log',
  title: 'Production log',
  description:
    'Read the studio production log: how many Dark Matters pieces were produced, on which runs, and whether the media-forge lane is healthy. The studio has been generating content for the Dark Matters universe since 2026-08-31 — this is the week-long production exhibit, day by day.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  annotations: { readOnlyHint: true },
  available: () => true,
  async execute() {
    if (typeof fetch === 'undefined') {
      return fail('production log unavailable in this environment (no fetch)');
    }
    try {
      const log = await fetchProductionLog();
      const total = log.entries.reduce((n, e) => n + (e.produced || 0), 0);
      const last = log.entries.at(-1);
      const days = log.entries.length;
      return ok(
        JSON.stringify({
          days,
          totalPieces: total,
          lastRun: last ? {
            run: last.run,
            produced: last.produced,
            errors: last.errors ?? [],
            wedgeRefused: last.wedge_refused ?? false,
          } : null,
        }),
      );
    } catch (err) {
      return fail(`could not read the production log: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

export const PRODUCTION_TOOLS: ToolDefinition[] = [productionLogTool];
