/**
 * BonsaiChat — the in-page on-device agent panel (D3).
 *
 * Replaces the "Agent chat — lands in the next milestone" placeholder. The
 * panel is the ONLY surface that may move the loader out of idle: the consent
 * chip is the explicit first-use gate (no auto-load on page open, gating
 * contract), the model picker chooses a Bonsai size (1.7B/4B/8B), download
 * progress renders in the panel, and Tier C renders the honest "on-device
 * agent unavailable — use ChatGPT/Chrome" state instead of a broken panel.
 *
 * The loop executes tools through the REAL WebMCP API when it exists — our
 * agent speaks the same protocol the browser agent does.
 */
import { useEffect, useRef, useState } from 'react';
import { useStudio } from '../state/store';
import {
  agentLoader,
  BONSAI_MODELS,
  getBonsaiModel,
  suggestBonsaiModelId,
  webmcpSurface,
  type ChatMessage,
} from './loader';
import {
  createToolExecutor,
  renderToolsSystemBlock,
  runToolLoop,
  toolSpecsFromDefinitions,
  type ParsedToolCall,
} from './loop';

interface Bubble {
  role: 'user' | 'agent' | 'tool' | 'system';
  text: string;
  toolCalls?: ParsedToolCall[];
}

const STUDIO_SYSTEM = `You are the in-page design agent of the WebMCP Design Studio — a live canvas where a person and an AI agent co-create flyers, posters and social posts.

The person sees every edit you make and must APPROVE it: your edits land in a PENDING BATCH and are only committed when the person clicks Approve (or you call approve-batch). Work in small steps and keep the person informed.

Rules:
- Always check the current state first (get-design-state / list-designs) before editing.
- add-text / edit-element / remove-element / generate-image / restyle-design only modify the pending batch — the committed design changes only after approve-batch.
- When you have finished a coherent set of edits, call approve-batch so they become real (the tool disappears once it commits — that is the toolchange demo).
- generate-image: use device:"auto" unless the user asked for a specific backend.
- Never invent element ids — read them from get-design-state.
- Keep replies short and friendly.`;

const TIER_LABELS: Record<string, { text: string; cls: string }> = {
  A: { text: 'Tier A — full on-device (text + image)', cls: 'tier tier-a' },
  B: { text: 'Tier B — text-only on-device (image → hosted)', cls: 'tier tier-b' },
  C: { text: 'Tier C — hosted-only (no on-device models)', cls: 'tier tier-c' },
};

export function BonsaiChat() {
  const agent = useStudio((s) => s.agent);
  const setAgent = useStudio((s) => s.setAgent);
  const [input, setInput] = useState('');
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [busy, setBusy] = useState(false);
  const [chosenModel, setChosenModel] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** True while the latest output is streaming into an agent bubble (no final push). */
  const agentStreamingRef = useRef(false);

  const tier = agent.tier;
  const tierLabel = tier ? TIER_LABELS[tier] : null;

  // Mirror the loader into the store (tier, phase, progress, slot, errors).
  useEffect(() => {
    const off = agentLoader.onChange((e) => {
      if (e.type === 'tier' && e.tier) {
        const verdict = agentLoader.getTier();
        setAgent({
          tier: e.tier,
          tierReasons: verdict?.reasons ?? [],
          phase: e.tier === 'C' ? 'unavailable' : 'idle',
        });
      } else if (e.type === 'phase') {
        setAgent({ phase: (e.phase ?? 'idle') as typeof agent.phase });
      } else if (e.type === 'progress') {
        setAgent({ progress: e.progress ?? null, progressDetail: e.detail ?? null });
      } else if (e.type === 'slot') {
        setAgent({ slot: e.kind ?? null });
      } else if (e.type === 'error') {
        setAgent({ lastError: e.message ?? null, phase: 'error' });
      }
    });
    void agentLoader.init().then((v) => {
      setAgent({ tier: v.tier, tierReasons: v.reasons, phase: v.tier === 'C' ? 'unavailable' : 'idle' });
    });
    setAgent({ consent: agentLoader.isConsentGiven() });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [bubbles, agent.progress]);

  const model = getBonsaiModel(chosenModel ?? suggestBonsaiModelId());
  const defaultModel = suggestBonsaiModelId();

  const push = (b: Bubble) => setBubbles((prev) => [...prev, b]);

  const enable = async () => {
    agentLoader.setConsent(true);
    setAgent({ consent: true });
    try {
      await agentLoader.ensureModel('text', { modelId: chosenModel ?? defaultModel });
      setAgent({ modelId: agentLoader.getSlot() === 'text' ? chosenModel ?? defaultModel : null });
    } catch (err) {
      setAgent({ lastError: err instanceof Error ? err.message : String(err), phase: 'error' });
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    agentStreamingRef.current = false;
    setBubbles((prev) => [...prev, { role: 'user', text }]);
    setAgent({ phase: 'generating', lastError: null });

    try {
      const worker = agentLoader.getChatWorker();
      if (!worker) {
        // Lazy first-use load (consent already given or the chip was bypassed
        // by device:'auto' tool calls — the loader enforces consent).
        await agentLoader.ensureModel('text', { modelId: chosenModel ?? defaultModel });
        setAgent({ modelId: chosenModel ?? defaultModel });
      }
      const w = agentLoader.getChatWorker()!;
      const executor = createToolExecutor({
        surface: webmcpSurface(),
        onToolCall: (name, args) => {
          agentStreamingRef.current = false;
          push({ role: 'tool', text: `${name}(${JSON.stringify(args).slice(0, 160)})` });
        },
      });
      const result = await runToolLoop({
        worker: w,
        systemPrompt: STUDIO_SYSTEM + '\n\n' + renderToolsSystemBlock(toolSpecsFromDefinitions()),
        userMessage: text,
        executor,
        onToken: (tok) => {
          agentStreamingRef.current = true;
          setBubbles((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'agent') {
              const next = [...prev];
              next[next.length - 1] = { ...last, text: last.text + tok };
              return next;
            }
            return [...prev, { role: 'agent', text: tok }];
          });
        },
      });
      // The streamed bubble already shows the reply; only push a final bubble
      // when nothing streamed (non-streaming runtime, or a tool-only turn).
      if (!agentStreamingRef.current) {
        push({ role: 'agent', text: result.text });
      }
      if (result.exhausted) {
        push({ role: 'system', text: 'Reached the tool-round cap — ask me to continue.' });
      }
    } catch (err) {
      setAgent({ lastError: err instanceof Error ? err.message : String(err), phase: 'error' });
      push({ role: 'system', text: `The on-device agent hit an error: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
      agentStreamingRef.current = false;
      setAgent({ phase: agentLoader.getChatWorker() ? 'ready' : 'idle' });
    }
  };

  const interrupt = () => {
    agentLoader.interrupt('text');
    setBusy(false);
  };

  const loading = agent.phase === 'loading';

  return (
    <div className="rail-card rail-card-agent">
      <h2>Agent chat</h2>

      {/* Tier status line */}
      <div className="agent-tierline">
        {tierLabel ? (
          <span className={tierLabel.cls}>{tierLabel.text}</span>
        ) : (
          <span className="tier tier-unknown">detecting device…</span>
        )}
        {agent.slot && <span className="agent-slot">slot: {agent.slot}</span>}
      </div>

      {/* Tier C: honest dead-end, no broken panel */}
      {tier === 'C' ? (
        <div className="agent-c" role="status">
          <p>
            <strong>On-device agent unavailable on this device.</strong> The Bonsai WebGPU
            models need a GPU and a solid connection. Use{' '}
            <strong>ChatGPT's browser agent</strong> (WebMCP) or{' '}
            <strong>Chrome with the WebMCP flag</strong> to drive the studio — every tool
            below is still live, and image generation uses the hosted tier.
          </p>
        </div>
      ) : (
        <>
          {/* Consent + model picker — the only thing that may load a model */}
          {!agent.consent && !agent.slot && (
            <div className="agent-consent" role="region" aria-label="on-device agent consent">
              <p className="consent-text">
                Run the agent <strong>entirely on your device</strong> — no prompt leaves
                this tab. The first model download is {model?.sizeMb ?? 545} MB.
              </p>
              <div className="agent-modelrow" role="radiogroup" aria-label="model size">
                {BONSAI_MODELS.map((m) => (
                  <button
                    key={m.id}
                    className={`chip chip-model ${(chosenModel ?? defaultModel) === m.id ? 'chip-model-on' : ''}`}
                    onClick={() => setChosenModel(m.id)}
                    role="radio"
                    aria-checked={(chosenModel ?? defaultModel) === m.id}
                  >
                    {m.params}
                  </button>
                ))}
              </div>
              <button className="chip chip-approve" onClick={() => void enable()}>
                Enable on-device agent
              </button>
              <p className="hint">
                {model?.label} — {model?.blurb} On a weak link the picker suggests the
                smallest size.
              </p>
            </div>
          )}

          {/* Download progress */}
          {loading && (
            <div className="agent-progress" role="progressbar" aria-valuenow={agent.progress ?? 0}>
              <div className="agent-progressbar">
                <div className="agent-progressfill" style={{ width: `${agent.progress ?? 0}%` }} />
              </div>
              <p className="agent-progressdetail">
                {agent.progressDetail ?? 'loading…'} ({agent.progress ?? 0}%)
              </p>
            </div>
          )}

          {/* Loaded state: ready to chat */}
          {agent.consent && !loading && (
            <>
              <div className="agent-transcript" ref={scrollRef}>
                {bubbles.length === 0 && (
                  <p className="hint">
                    Ready. Ask me to make a flyer, add text, move things, or generate an
                    image — I use the same WebMCP tools ChatGPT's agent would.
                  </p>
                )}
                {bubbles.map((b, i) => (
                  <div key={i} className={`bubble bubble-${b.role}`}>
                    {b.role === 'tool' && <span className="bubble-tooltag">tool</span>}
                    <span className="bubble-text">{b.text}</span>
                    {b.toolCalls?.map((c, j) => (
                      <code key={j} className="bubble-call">
                        {c.name}
                      </code>
                    ))}
                  </div>
                ))}
                {busy && (
                  <div className="bubble bubble-agent">
                    <span className="bubble-text typing">…</span>
                  </div>
                )}
              </div>

              <div className="agent-inputrow">
                <input
                  className="agent-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void send();
                  }}
                  placeholder={agent.phase === 'error' ? 'on-device agent failed — see status bar' : 'Ask the on-device agent…'}
                  disabled={busy || agent.phase === 'error'}
                  aria-label="message to the on-device agent"
                />
                {busy ? (
                  <button className="chip chip-discard" onClick={interrupt}>
                    Stop
                  </button>
                ) : (
                  <button
                    className="chip chip-approve"
                    onClick={() => void send()}
                    disabled={!input.trim() || agent.phase === 'error'}
                  >
                    Send
                  </button>
                )}
              </div>

              {agent.phase === 'error' && (
                <p className="agent-error" role="alert">
                  {agent.lastError ?? 'The on-device agent failed.'} The hosted tier and
                  ChatGPT's agent still work.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Types re-exported so the store can reference bubbles without importing React. */
export type { ChatMessage };
