/**
 * CreditsMeter — the visible half of the demo governor (lane 3, 2026-09-03).
 * "Demo credits: 27 / 30 turns · $0.48" beside the agent panel's tier line,
 * and "GPU burst: RTX 4090 · $0.55/h · $x left today" while a burst is up.
 * Reads the credits store; never fetches on its own beyond the first load
 * and a slow burst-status refresh while the burst is up.
 */
import { useEffect, useSyncExternalStore, type JSX } from 'react';
import { ensureVisitor, getBurstStatus, getDemoSnapshot, subscribeCredits } from './credits';

const BURST_REFRESH_MS = 60_000;

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function CreditsMeter(): JSX.Element | null {
  const snap = useSyncExternalStore(subscribeCredits, getDemoSnapshot, getDemoSnapshot);

  useEffect(() => {
    // Best-effort: a dev origin without the governor shows no meter at all
    // rather than a broken one (the error is kept for the title attribute).
    void ensureVisitor().catch(() => undefined);
    void getBurstStatus().catch(() => undefined);
  }, []);

  const burstUp = snap.burst?.up === true;
  useEffect(() => {
    if (!burstUp) return;
    const id = setInterval(() => void getBurstStatus().catch(() => undefined), BURST_REFRESH_MS);
    return () => clearInterval(id);
  }, [burstUp]);

  if (!snap.credits) return null;
  const c = snap.credits;
  const total = c.policy?.turns_per_visitor;
  const turns = total !== undefined ? `${c.turns_left} / ${total} turns` : `${c.turns_left} turns`;
  return (
    <span className="credits-meter" role="status" aria-label="demo credits" title={snap.error ?? undefined}>
      <span className={`credits-chip ${c.turns_left <= 0 ? 'credits-chip-empty' : ''}`}>
        Demo credits: {turns} · {usd(c.usd_left)}
      </span>
      {burstUp && snap.burst && (
        <span className="credits-chip credits-chip-burst">
          GPU burst: {snap.burst.gpu ?? 'cloud GPU'}
          {snap.burst.price_per_hour !== null ? ` · ${usd(snap.burst.price_per_hour)}/h` : ''}
          {` · ${usd(snap.burst.usd_left_today)} left today`}
        </span>
      )}
    </span>
  );
}
