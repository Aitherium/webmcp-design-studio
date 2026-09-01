/**
 * App shell — header (brand) + canvas center + right rail (StatusBar,
 * pending-batch card, agent-chat placeholder slot for D3).
 */
import { FabricCanvas } from './canvas/FabricCanvas';
import { StatusBar } from './dev/StatusBar';
import { ProtocolFeed } from './dev/ProtocolFeed';
import { ProductionCard } from './dev/ProductionCard';
import { BonsaiChat } from './agent/BonsaiChat';
import { useStudio } from './state/store';

function BatchCard() {
  const pending = useStudio((s) => s.pendingBatch);
  const commit = useStudio((s) => s.commitBatch);
  const discard = useStudio((s) => s.discardBatch);

  if (!pending) {
    return (
      <div className="rail-card rail-card-empty">
        <h2>Pending batch</h2>
        <p>Nothing pending — every agent edit lands here for your approval.</p>
      </div>
    );
  }
  return (
    <div className="rail-card rail-card-pending">
      <h2>Pending batch</h2>
      <p className="batch-count">
        {pending.ops.length} uncommitted edit{pending.ops.length === 1 ? '' : 's'} from the agent
      </p>
      <ul className="batch-ops">
        {pending.ops.map((op, i) => (
          <li key={i}>
            <code>{op.kind}</code>
            {'elementId' in op && op.elementId ? <span className="batch-op-id">{op.elementId}</span> : null}
            {'element' in op && op.element ? <span className="batch-op-id">{op.element.id}</span> : null}
          </li>
        ))}
      </ul>
      <div className="batch-actions">
        <button className="chip chip-approve" onClick={() => commit()}>
          Approve batch
        </button>
        <button className="chip chip-discard" onClick={() => discard()}>
          Discard
        </button>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <img src="/favicon.svg" alt="" className="brand-mark" />
          <div className="brand-text">
            <h1 className="brand-name">WebMCP Design Studio</h1>
            <p className="brand-tagline">
              A person and an AI agent co-create flyers, posters and posts on a live canvas — the agent works through
              WebMCP tools, and every edit waits for your approve.
            </p>
          </div>
        </div>
      </header>

      <main className="app-main">
        <section className="app-canvas" aria-label="design canvas">
          <FabricCanvas />
        </section>

        <aside className="app-rail">
          <StatusBar />
          <BatchCard />
          <ProtocolFeed />
          <ProductionCard />
          <BonsaiChat />
        </aside>
      </main>

      <footer className="app-footer">
        <p>
          Built with the Aitherium aw* stack — aither · awdk · awnode · awconnect · awnix · Claude Code on
          DeepSeek V4 Flash. No OpenAI APIs were touched in the making of this infrastructure — the ethical
          choice is the technical choice: open weights, local-first, and no proprietary black box between
          the person and their tooling.
        </p>
      </footer>
    </div>
  );
}
