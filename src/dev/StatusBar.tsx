/**
 * StatusBar — WebMCP presence, live tool list and LOUD registration errors.
 *
 * The surface badge answers the demo's most important question honestly:
 * real browser API (green), our polyfill shim (amber — always visible so
 * nobody mistakes the shim for the real thing), or off (red). Registration
 * failures (NotAllowedError from Permissions-Policy, absent API) render as
 * red rows — never silently swallowed.
 */
import { useStudio } from '../state/store';

export function StatusBar() {
  const status = useStudio((s) => s.webmcpStatus);
  const liveTools = useStudio((s) => s.liveToolNames);
  const runtime = useStudio((s) => s.runtimeStatus);

  const surface = status?.surface ?? 'off';
  const badgeClass = surface === 'real' ? 'badge badge-real' : surface === 'polyfill' ? 'badge badge-polyfill' : 'badge badge-off';
  const badgeText =
    surface === 'real' ? 'WebMCP: on (real API)' : surface === 'polyfill' ? 'WebMCP: polyfill (dev shim)' : 'WebMCP: off';

  const failures = status?.failures ?? [];

  return (
    <div className="statusbar">
      <div className="statusbar-row">
        <span className={badgeClass}>{badgeText}</span>
        <span className="statusbar-tools">{liveTools.length} tool{liveTools.length === 1 ? '' : 's'} live</span>
        <span className="statusbar-runtime">{runtime ?? 'runtime: none (on-device agent lands in D3)'}</span>
      </div>

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
