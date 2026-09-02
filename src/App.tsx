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

/** Declarative WebMCP (the `<form toolname>` path). Spread as plain DOM
 * attributes — React passes lowercase unknown attributes through, and they
 * are inert wherever the native API is absent. */
const DECLARATIVE_BATCH_FORM: Record<string, string> = {
  toolname: 'decide-pending-batch',
  tooldescription:
    "Approve or discard the agent's pending batch of edits — the human consent step. decision: approve | discard.",
  toolautosubmit: '',
};
const DECLARATIVE_DECISION_PARAM: Record<string, string> = {
  toolparamdescription: '"approve" commits the pending batch to the design; "discard" throws it away.',
};

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
      {/* The consent step is ALSO a declarative WebMCP tool: a `<form toolname>`
          (the spec's second registration path) a native agent can fill and
          submit. `toolautosubmit` submits when the agent fills the decision;
          humans use the two buttons. The polyfill ignores these attributes. */}
      <form
        className="batch-actions"
        {...DECLARATIVE_BATCH_FORM}
        onSubmit={(e) => {
          e.preventDefault();
          const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
          const decision = submitter?.value || new FormData(e.currentTarget).get('decision');
          if (decision === 'discard') discard();
          else commit();
        }}
      >
        <select
          name="decision"
          defaultValue="approve"
          aria-label="Decision for the pending batch"
          style={{ position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 }}
          {...DECLARATIVE_DECISION_PARAM}
        >
          <option value="approve">approve</option>
          <option value="discard">discard</option>
        </select>
        <button type="submit" name="decision" value="approve" className="chip chip-approve">
          Approve batch
        </button>
        <button type="submit" name="decision" value="discard" className="chip chip-discard">
          Discard
        </button>
      </form>
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
