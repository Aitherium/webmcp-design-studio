/**
 * ProductionCard (P2.3, 2026-08-31) — the Potential Impact exhibit in the rail.
 *
 * "This week: N pieces" — read from public/production-log.json,
 * the same file the production-log WebMCP tool serves to agents. The log is
 * appended to daily by the AitherOS dm-production-daily routine and carried
 * here by the Pages deploy, so the card is the same exhibit the tool returns:
 * no marketing line, just the production ledger.
 */
import { useEffect, useState } from 'react';
import type { ProductionLog } from '../webmcp/tools/production';

interface CardState {
  total: number;
  days: number;
  lastRun: ProductionLog['entries'][number] | null;
  error: string | null;
}

export function ProductionCard() {
  const [state, setState] = useState<CardState>({ total: 0, days: 0, lastRun: null, error: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${location.origin}/production-log.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const log = (await res.json()) as ProductionLog;
        if (!alive || !Array.isArray(log.entries)) return;
        setState({
          total: log.entries.reduce((n, e) => n + (e.produced || 0), 0),
          days: log.entries.length,
          lastRun: log.entries.at(-1) ?? null,
          error: null,
        });
      } catch (err) {
        if (alive) setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const last = state.lastRun;
  return (
    <div className="rail-card rail-card-production">
      <h2>Studio production</h2>
      {state.error ? (
        <p className="feed-empty">Production log unavailable — {state.error}</p>
      ) : (
        <>
          <p className="production-total">
            <strong>{state.total}</strong> piece{state.total === 1 ? '' : 's'} across{' '}
            <strong>{state.days}</strong> production day{state.days === 1 ? '' : 's'}
          </p>
          {last ? (
            <p className="production-last">
              Last run {new Date(last.run).toLocaleString()}: {last.produced} produced
              {last.errors?.length ? ` · ${last.errors.length} error(s)` : ''}
            </p>
          ) : (
            <p className="production-last">No production runs yet — the lane starts tonight.</p>
          )}
          <p className="production-note">
            The studio has been producing real print pieces — flyers, posters, posts — since 2026-08-31;
            every day the production routine renders the day's brief through the studio's image lane
            and appends the outcome here. Ask the agent: “what has the studio produced this week?”
          </p>
        </>
      )}
    </div>
  );
}
