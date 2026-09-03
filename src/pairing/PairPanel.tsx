/**
 * "Connect your own agent" — the pairing card (2026-09-03, WebMCP lane 4).
 *
 * Sits beside the BYOK lanes in the agent rail. One click mints a 6-char code
 * and shows the MCP URL the visitor pastes into ChatGPT or Claude; from then
 * on THEIR agent lists and calls this tab's live WebMCP tools. No key, no
 * account: the code is the capability, it lasts 30 minutes, and it grants
 * exactly what the roster exposes.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getPairState, startPairing, stopPairing, subscribePair } from './pairClient';

function statusLabel(status: string): string {
  switch (status) {
    case 'pairing':
      return 'minting a code…';
    case 'connecting':
      return 'connecting…';
    case 'connected':
      return 'paired — waiting for your agent';
    case 'reconnecting':
      return 'reconnecting…';
    case 'expired':
      return 'code expired — pair again';
    case 'error':
      return 'pairing failed';
    default:
      return '';
  }
}

export function PairPanel() {
  const pair = useSyncExternalStore(subscribePair, getPairState, getPairState);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Countdown — the visitor can see how long the code lives. The clock is
  // state; the label is derived during render (no setState inside the effect).
  const counting = !!pair.expiresAt && pair.status !== 'idle' && pair.status !== 'expired';
  useEffect(() => {
    if (!counting) return;
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, [counting]);
  let left = '';
  if (counting && pair.expiresAt) {
    const ms = Math.max(0, pair.expiresAt - now);
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    left = `${m}:${s.toString().padStart(2, '0')}`;
  }

  const copy = async () => {
    if (!pair.mcpUrl) return;
    try {
      await navigator.clipboard.writeText(pair.mcpUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard denied — the URL is selectable text below */
    }
  };

  const active = pair.status !== 'idle';

  return (
    <div className="agent-backend pair-panel" role="group" aria-label="connect your own agent">
      <span className="agent-backendlabel">Your own agent</span>
      {!active ? (
        <>
          <button
            className="chip chip-approve"
            onClick={() => {
              void startPairing().catch(() => {
                /* the store carries the error; nothing else to do */
              });
            }}
          >
            Connect your own agent
          </button>
          <p className="hint">
            Pair this tab to ChatGPT or Claude over MCP — their agent gets this studio's live tools
            for 30 minutes. No key needed.
          </p>
        </>
      ) : (
        <>
          <div className="pair-row">
            <span className="pair-code" aria-label="pairing code">
              {pair.code ?? '——————'}
            </span>
            <span className={`pair-status pair-status-${pair.status}`} role="status">
              {statusLabel(pair.status)}
              {left && pair.status !== 'error' ? ` · ${left}` : ''}
            </span>
          </div>
          {pair.error && <p className="pair-error">{pair.error}</p>}
          {pair.mcpUrl && (
            <div className="pair-row">
              <input
                className="agent-backendurl pair-url"
                readOnly
                value={pair.mcpUrl}
                aria-label="MCP server URL"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button className="chip" onClick={() => void copy()} aria-label="copy MCP URL">
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
          <p className="hint">
            <strong>ChatGPT:</strong> Settings → Connectors → Add MCP server → paste the URL.{' '}
            <strong>Claude:</strong> Settings → Connectors → Add custom connector → paste the URL.
            {pair.calls > 0 && (
              <>
                {' '}
                {pair.calls} call{pair.calls === 1 ? '' : 's'} served
                {pair.lastTool ? ` (last: ${pair.lastTool})` : ''}.
              </>
            )}
          </p>
          <button className="chip chip-discard" onClick={() => stopPairing()}>
            {pair.status === 'expired' || pair.status === 'error' ? 'Dismiss' : 'Disconnect'}
          </button>
        </>
      )}
    </div>
  );
}
