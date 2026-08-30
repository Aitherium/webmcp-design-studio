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
  isStuckCompletionTurn,
  renderToolsSystemBlock,
  runToolLoop,
  shouldReissueForEmptyDesign,
  toolSpecsFromDefinitions,
  type ParsedToolCall,
} from './loop';
import {
  FLEET_DEFAULT_BASE,
  loadProviderConfig,
  saveProviderConfig,
  type ImageProviderConfig,
} from '../cloud/imageProviders';

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
- Keep replies short and friendly.

COMPLETE THE JOB — do not stop after the first step. When the user asks for a poster, flyer or social post (e.g. "a poster for a car washing company"), make the WHOLE design in one turn: create the design, add the headline + subtext + any info (hours, phone, location), generate an image, then approve-batch. Only ask the user a question when the request is genuinely ambiguous (no subject at all, or a choice only they can make). Do not reply "would you like me to add text?" — just do it, then summarize what you made and that it awaits their approval.`;

/**
 * The COMPLETE-THE-JOB re-issue — the deterministic guard's message and the
 * "Finish the job" button's payload. Prompt-level instruction is NOT enough:
 * measured live 2026-08-29, bonsai-8b ignored the STUDIO_SYSTEM rule and
 * replied with the verbatim-forbidden "would you like me to add text?" on
 * three consecutive turns (including "actually create it"). The guard below
 * re-issues this hard instruction when a directive turn ends with the design
 * still empty.
 */
const FINISH_JOB_PROMPT = `The user asked you to make a design, and you responded without adding anything to the canvas. Finish the job NOW, in this turn:
- If a design already exists, work on IT (call get-design-state first). Do NOT create a new design.
- Add the headline, subtext and any other elements the request implies (hours, phone, location).
- Generate an image for the design (device: "auto").
- Call approve-batch when the design is complete.
Do not ask the user for permission. Do not end with a question. Make the edits, then summarize what you made and that it awaits approval.`;

/**
 * Did the agent's turn change the design at all? Ground truth for the guard —
 * pending batch ops OR committed elements on the current design. (create-design
 * commits immediately, so the "empty design" state is elements.length === 0.)
 */
const designChanged = (): boolean => {
  const s = useStudio.getState();
  if (s.pendingBatch?.ops?.length) return true;
  const doc = s.docs.find((d) => d.id === s.currentDocId);
  return (doc?.elements.length ?? 0) > 0;
};

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
  /** Hosted lane engaged (no consent needed — no model loads on this device). */
  const [hostedActive, setHostedActive] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** True while the latest output is streaming into an agent bubble (no final push). */
  const agentStreamingRef = useRef(false);
  /**
   * The hosted lane (2026-08-28): the tunnel host proxies the fleet's
   * llama.cpp brain at same-origin /api/chat/ — that only exists on
   * studio-preview, so a GitHub-Pages origin (the judges' URL) cannot host it
   * and keeps the honest Tier C dead-end. `?hosted=1` forces the lane
   * anywhere (dev server, preview, a machine whose WebGPU load keeps failing).
   */
  const forceHosted = new URLSearchParams(window.location.search).has('hosted');
  const hostedLaneAvailable =
    forceHosted ||
    (!window.location.hostname.endsWith('github.io') &&
      window.location.hostname !== 'studio.aitherium.com');
  /** Image backend chosen in the provider panel (persisted to localStorage). */
  const [provider, setProvider] = useState<ImageProviderConfig>(() => loadProviderConfig());

  const updateProvider = (patch: Partial<ImageProviderConfig>) => {
    setProvider((prev) => {
      const next = { ...prev, ...patch };
      saveProviderConfig(next);
      return next;
    });
  };

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
      // Tier C on a host that CAN proxy the fleet brain: switch to the hosted
      // lane automatically — the loader reports tier B (text available) so the
      // chat UI renders, and getChatWorker() returns the hosted worker.
      const effective = v.tier === 'C' && hostedLaneAvailable ? 'B' : v.tier;
      if (effective === 'B' && v.tier === 'C') {
        agentLoader.setHostedMode(true);
        setHostedActive(true);
      }
      setAgent({
        tier: effective,
        tierReasons: v.reasons,
        phase: effective === 'C' ? 'unavailable' : 'idle',
      });
    });
    if (forceHosted) {
      agentLoader.setHostedMode(true);
      setHostedActive(true);
    }
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

  /**
   * Run one user turn through the tool loop, then the COMPLETE-THE-JOB guard:
   * a directive turn that ends with the design still empty is re-issued ONCE
   * with the hard FINISH_JOB_PROMPT (the deterministic half of the fix —
   * measured live 2026-08-29, the on-device 8B ignored the prompt rule three
   * times in a row, so the guarantee must live outside the prompt).
   */
  const runTurn = async (userMessage: string, opts?: { enforce?: boolean }) => {
    setBusy(true);
    agentStreamingRef.current = false;
    setAgent({ phase: 'generating', lastError: null });

    try {
      let message = userMessage;
      for (let attempt = 0; ; attempt++) {
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
          userMessage: message,
          executor,
          // The completion re-issue needs headroom to emit the WHOLE
          // multi-tool flow (state + text + image + approve) — measured live
          // 2026-08-29, the 512-token default was eaten by thinking after
          // get-design-state and the round came back EMPTY, a silent dead
          // end. Same trap that hit the hosted 27B until its lane went 2048.
          maxTokens: attempt === 1 ? 2048 : undefined,
          onToken: (tok) => {
            // The streamed deltas are a PREVIEW and can carry partial-token
            // artifacts — measured live 2026-08-29, the on-device 8B doubled
            // every word ("TheThe design design for for your your…") while the
            // worker's assembled final text was clean. They are NEVER painted
            // into the transcript; the assembled result.text below is the only
            // agent prose that shows. This ref only tracks that something
            // streamed (distinguishes a tool-only turn from a prose turn).
            agentStreamingRef.current = true;
            void tok;
          },
        });
        // The only agent prose the transcript ever shows is the loop's
        // assembled result.text — the worker's trimmed final answer. An EMPTY
        // result (a reasoning-only turn that burned its budget) must not push
        // an empty bubble — the transcript keeps the tool rows.
        if (result.text.trim()) {
          push({ role: 'agent', text: result.text });
        }
        if (result.exhausted) {
          push({ role: 'system', text: 'Reached the tool-round cap — ask me to continue.' });
        }
        // The completion re-issue that ends EMPTY (no text, design still
        // unchanged, rounds not exhausted) is the silent-dead-end shape
        // measured live 2026-08-29 — surface it LOUD instead of leaving a
        // blank canvas with no error. The Finish button is the guaranteed
        // human path; naming it turns a dead end into a next step.
        if (attempt === 1 && isStuckCompletionTurn(result.text, designChanged(), result.exhausted)) {
          push({
            role: 'system',
            text: "The on-device model got stuck mid-flow. Tap 'Finish the job' to retry, or rephrase your request.",
          });
        }
        // The guard: one re-issue, only for the FIRST attempt of a directive
        // message that produced no design change (no pending edits, no
        // elements on the current design). A question or an info ask never
        // triggers it; a turn that already made edits never triggers it.
        // Decision lives in loop.ts (pure) so the guard is unit-tested.
        if (!(opts?.enforce && shouldReissueForEmptyDesign(userMessage, designChanged(), attempt))) {
          break;
        }
        push({ role: 'system', text: 'The agent stopped without editing — completing the job for you.' });
        message = FINISH_JOB_PROMPT;
      }
    } catch (err) {
      setAgent({ lastError: err instanceof Error ? err.message : String(err), phase: 'error' });
      push({ role: 'system', text: `The agent hit an error: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
      agentStreamingRef.current = false;
      setAgent({ phase: agentLoader.getChatWorker() ? 'ready' : 'idle' });
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBubbles((prev) => [...prev, { role: 'user', text }]);
    await runTurn(text, { enforce: true });
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

      {/* Image backend — provider panel (works on every tier, persisted) */}
      <div className="agent-backend" role="group" aria-label="image backend">
        <span className="agent-backendlabel">Image backend</span>
        <select
          className="agent-backendselect"
          value={provider.id}
          onChange={(e) => updateProvider({ id: e.target.value as ImageProviderConfig['id'] })}
          aria-label="image backend provider"
        >
          <option value="on-device">On-device (WebGPU)</option>
          <option value="fleet">Fleet — AitherBonsaiImage</option>
          <option value="custom">Custom — Sana / ComfyUI / SD</option>
        </select>
        {provider.id !== 'on-device' && (
          <input
            className="agent-backendurl"
            value={provider.baseUrl ?? (provider.id === 'fleet' ? FLEET_DEFAULT_BASE : '')}
            placeholder={provider.id === 'fleet' ? FLEET_DEFAULT_BASE : 'http://host:port'}
            onChange={(e) => updateProvider({ baseUrl: e.target.value })}
            aria-label="image backend base URL"
          />
        )}
        {provider.id === 'custom' && (
          <input
            className="agent-backendkey"
            type="password"
            value={provider.apiKey ?? ''}
            placeholder="API key (optional)"
            onChange={(e) => updateProvider({ apiKey: e.target.value })}
            aria-label="image backend API key"
          />
        )}
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
          {/* Consent + model picker — the only thing that may load a model.
              Hidden on the hosted lane: no model loads on this device. */}
          {!agent.consent && !agent.slot && !hostedActive && (
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

          {/* Loaded state: ready to chat (hosted lane is always "ready") */}
          {(agent.consent || hostedActive) && !loading && (
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
                  placeholder={agent.phase === 'error' ? 'agent failed — see status bar' : 'Ask the agent…'}
                  disabled={busy || agent.phase === 'error'}
                  aria-label="message to the agent"
                />
                {busy ? (
                  <button className="chip chip-discard" onClick={interrupt}>
                    Stop
                  </button>
                ) : (
                  <>
                    <button
                      className="chip chip-discard"
                      onClick={() => void runTurn(FINISH_JOB_PROMPT, { enforce: false })}
                      disabled={agent.phase === 'error'}
                      title="Force the agent to complete the current design now — no more questions"
                    >
                      Finish the job
                    </button>
                    <button
                      className="chip chip-approve"
                      onClick={() => void send()}
                      disabled={!input.trim() || agent.phase === 'error'}
                    >
                      Send
                    </button>
                  </>
                )}
              </div>

              {agent.phase === 'error' && (
                <p className="agent-error" role="alert">
                  {agent.lastError ?? 'The on-device agent failed.'} The design tools below
                  still work, and image generation can use your own backend.
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
