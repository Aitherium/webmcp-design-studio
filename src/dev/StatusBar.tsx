/**
 * StatusBar — WebMCP presence, live tool list, on-device tier + model slot,
 * and LOUD registration errors.
 *
 * The surface badge answers the demo's most important question honestly:
 * real browser API (green), our polyfill shim (amber — always visible so
 * nobody mistakes the shim for the real thing), or off (red). Registration
 * failures (NotAllowedError from Permissions-Policy, absent API) render as
 * red rows — never silently swallowed.
 *
 * The agent line shows the detected gating tier (A/B/C), which model family
 * holds the SINGLE-MODEL SLOT, and a LOUD red row when a load failed (the
 * tier stays disabled for the session — that is the contract).
 */
import { useStudio } from '../state/store';

const TIER_TEXT: Record<string, string> = {
  A: 'Tier A · on-device text+image',
  B: 'Tier B · on-device text only',
  C: 'Tier C · hosted only',
};

export function StatusBar() {
  const status = useStudio((s) => s.webmcpStatus);
  const liveTools = useStudio((s) => s.liveToolNames);
  const runtime = useStudio((s) => s.runtimeStatus);
  const agent = useStudio((s) => s.agent);

  const surface = status?.surface ?? 'off';
  const badgeClass = surface === 'real' ? 'badge badge-real' : surface === 'polyfill' ? 'badge badge-polyfill' : 'badge badge-off';
  const badgeText =
    surface === 'real' ? 'WebMCP: on (real API)' : surface === 'polyfill' ? 'WebMCP: polyfill (dev shim)' : 'WebMCP: off';

  const failures = status?.failures ?? [];

  const slotText =
    agent.slot === 'text'
      ? `agent slot: ${agent.modelId ?? 'text'} loaded`
      : agent.slot === 'image'
        ? 'agent slot: image runtime loaded'
        : agent.tier
          ? `agent: ${TIER_TEXT[agent.tier]} · slot empty`
          : 'agent: detecting…';

  return (
    <div className="statusbar">
      <div className="statusbar-row">
        <span className={badgeClass}>{badgeText}</span>
        <span className="statusbar-tools">{liveTools.length} tool{liveTools.length === 1 ? '' : 's'} live</span>
        <span className="statusbar-runtime">{runtime ?? slotText}</span>
      </div>
      {agent.phase === 'error' && agent.lastError && (
        <div className="statusbar-failures" role="alert">
          <div className="failure-row">
            <span className="failure-name">on-device agent</span>
            <span className="failure-error">{agent.lastError}</span>
          </div>
        </div>
      )}

      {failures.length > 0 && (
        <div className="statusbar-failures" role="alert">
          {failures.map((f) => (
            <div key={f.name} className="failure-row">
              <span className="failure-name">{f.name}</span>
              <span className="failure-error">{f.error}</span>
            </div>
          ))}
        </div>
      )}

      {liveTools.length > 0 && (
        <div className="statusbar-toolnames">
          {liveTools.map((name) => (
            <code key={name} className="toolchip">
              {name}
            </code>
          ))}
        </div>
      )}
    </div>
  );
}
