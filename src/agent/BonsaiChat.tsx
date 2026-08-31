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
  type ChatWorkerLike,
} from './loader';
import {
  createToolExecutor,
  isStuckCompletionTurn,
  renderToolsSystemBlock,
  runToolLoop,
  shouldReissueForEmptyDesign,
  toolSpecsFromDefinitions,
  withPriorToolResult,
  type ParsedToolCall,
} from './loop';
import {
  FLEET_DEFAULT_BASE,
  loadProviderConfig,
  saveProviderConfig,
  type ImageProviderConfig,
} from '../cloud/imageProviders';
import { createOpenAICompatibleWorker } from './hostedChat';
import {
  loadTextAgentConfig,
  saveTextAgentConfig,
  type TextAgentConfig,
  type TextAgentMode,
} from './textAgentConfig';
import { unwrapToolResponse } from './scripted';

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

COMPLETE THE JOB — do not stop after the first step. When the user asks for a poster, flyer or social post (e.g. "a poster for a car washing company"), make the WHOLE design in one turn: create the design, add the headline + subtext + any info (hours, phone, location), generate an image, then approve-batch. Only ask the user a question when the request is genuinely ambiguous (no subject at all, or a choice only they can make). Do not reply "would you like me to add text?" — just do it, then summarize what you made and that it awaits their approval.

WORKED EXAMPLE — imitate this exact sequence; never pause between steps to ask permission (a 0.6-8B model that stops to ask has not finished). For "make a poster for a bakery":
1. create-design({name: "Bakery Poster", size: "poster", palette: "neon"})
2. add-text({text: "Bakery", fontSize: 96, bold: true, align: "center"})
3. add-text({text: "Fresh bread daily", fontSize: 40, align: "center"})
4. generate-image({prompt: "hero shot of fresh bread, warm light", style: "photographic", size: "tall", device: "auto"})
5. approve-batch()
Then reply with ONE short summary sentence: what you made and that it awaits the person's approval.`;

/**
 * The COMPLETE-THE-JOB re-issue — the deterministic guard's message and the
 * "Finish the job" button's payload. Prompt-level instruction is NOT enough:
 * measured live 2026-08-29, bonsai-8b ignored the STUDIO_SYSTEM rule and
 * replied with the verbatim-forbidden "would you like me to add text?" on
 * three consecutive turns (including "actually create it"). The guard below
 * re-issues this hard instruction when a directive turn ends with the design
 * still empty.
 */
/** One-click demo prompts for the WebMCP Challenge — each exercises the full
 * co-creation loop: tool calls, the uncommitted batch, the human approve. */
const STARTERS: Array<{ label: string; prompt: string }> = [
  {
    label: 'Yard sale flyer',
    prompt:
      'Make a yard sale flyer, spring theme, white background — headline, details and a photo. Then stop and wait for approval.',
  },
  {
    label: 'Car wash poster',
    prompt:
      'Make a poster for a car wash business — neon theme, big headline, and a hero image of a clean shiny car. Then stop and wait for approval.',
  },
  {
    label: 'Café menu board',
    prompt:
      'Make a chalkboard-style café menu with today specials — bold title, three items, a shape or image. Then stop and wait for approval.',
  },
  {
    label: 'Iris hero cutout',
    prompt:
      'Make a poster for a specialty coffee brand. Use iris-generate for a hero image of a coffee cup, then mediaforge-remove-bg on it so the cup becomes a transparent cutout, then add a headline and tagline. Then stop and wait for approval.',
  },
];

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
  /** The last turn's cut-off tool result, injected ONCE into the next turn's
   * system prompt (withPriorToolResult) so a human's "continue" is not blind
   * to what the cap hid from the model (measured live 2026-08-30: every
   * retry re-ran state discovery into the same wall). */
  const lastExhaustedRef = useRef<string | null>(null);
  /** Throttled live token counter — the "generating… (N tokens)" status line. */
  const [liveTokens, setLiveTokens] = useState(0);
  const tokRef = useRef(0);
  /**
   * The hosted lane (2026-08-28, extended 2026-08-30): the tunnel host proxies
   * the fleet's llama.cpp brain at /api/chat/ — same-origin on
   * studio-preview, and now CORS-reachable from the PUBLIC origin too
   * (hostedChat.ts HOSTED_BASE points at the preview's proxy there; nginx
   * answers Access-Control-Allow-Origin for it, verified live 2026-08-30).
   * Only the raw github.io origin stays a dead end (no tunnel). `?hosted=1`
   * forces the lane anywhere.
   */
  const forceHosted = new URLSearchParams(window.location.search).has('hosted');
  const hostedLaneAvailable =
    forceHosted || !window.location.hostname.endsWith('github.io');
  /** Image backend chosen in the provider panel (persisted to localStorage). */
  const [provider, setProvider] = useState<ImageProviderConfig>(() => loadProviderConfig());
  /** BYOK text-agent config (2026-08-30, WebMCP Challenge) — on-device, the
   * fleet brain, or the visitor's OWN OpenAI-compatible endpoint + key. */
  const [textAgent, setTextAgent] = useState<TextAgentConfig>(() => loadTextAgentConfig());
  const updateTextAgent = (patch: Partial<TextAgentConfig>) =>
    setTextAgent((prev) => {
      const next = { ...prev, ...patch };
      saveTextAgentConfig(next);
      return next;
    });
  // Custom and fleet modes never touch the loader: the visitor's own key (or
  // the fleet brain) is their own consent, so the loader gate must not block
  // the input. Fleet is the PUBLIC-ORIGIN default (instant first visit) —
  // measured 2026-08-31: the on-device default made a judge's first demo wait
  // for the 4B download.
  useEffect(() => {
    if (textAgent.mode === 'custom' || textAgent.mode === 'fleet') {
      setAgent({ consent: true, phase: 'idle', lastError: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textAgent.mode]);

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
      // PRELOAD for a returning visitor: consent was remembered, so start
      // the model load immediately instead of waiting for the first turn —
      // by the time they type, it is usually resident (owner 2026-08-30:
      // "we preload the model quickly anyway"). The first-ever visitor still
      // sees the consent chip; nothing loads before it.
      if (agentLoader.isConsentGiven() && !hostedActive) {
        void agentLoader.ensureModel('text', { modelId: suggestBonsaiModelId() });
      }
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
    tokRef.current = 0;
    setLiveTokens(0);
    setAgent({ phase: 'generating', lastError: null });

    try {
      let message = userMessage;
      for (let attempt = 0; ; attempt++) {
        const executor = createToolExecutor({
          surface: webmcpSurface(),
          onToolCall: (name, args) => {
            agentStreamingRef.current = false;
            push({ role: 'tool', text: `${name}(${JSON.stringify(args).slice(0, 160)})` });
          },
        });
        // NO scripted first turn — the owner killed it (2026-08-30: "I don't
        // want it scripted"). Every message, including the first, runs the
        // free-form agent loop: the loop now has the headroom the scripted
        // plan was compensating for (6 rounds + 2048 tokens, measured to be
        // what the on-device flow needs), the round-cap bubble names the last
        // tool result, and the COMPLETE-THE-JOB guard below re-issues with a
        // hard instruction when a directive turn ends with the design empty.
        // The scripted plan code stays in ./scripted (tested) as a library —
        // it is no longer invoked.
        // BYOK (2026-08-30): the visitor's own OpenAI-compatible endpoint
        // drives the SAME loop + the same 14 WebMCP tools — no loader, no
        // consent, no model download; the key is theirs, the surface is ours.
        let w: ChatWorkerLike;
        if (textAgent.mode === 'custom' && textAgent.baseUrl.trim()) {
          w = createOpenAICompatibleWorker({
            baseUrl: textAgent.baseUrl,
            model: textAgent.model.trim() || 'gpt-4o-mini',
            apiKey: textAgent.apiKey.trim() || undefined,
          });
        } else if (textAgent.mode === 'fleet') {
          // The fleet lane works on EVERY tier — getChatWorker() only returns
          // the hosted worker when the loader's hostedMode is on (Tier C /
          // ?hosted=1), so routing through the loader would hand a Tier A/B
          // machine the on-device worker while the panel says "Fleet".
          // Measured 2026-08-31 while wiring the public-origin default.
          w = createHostedChatWorker();
        } else {
          const worker = agentLoader.getChatWorker();
          if (!worker) {
            // Lazy first-use load (consent already given or the chip was bypassed
            // by device:'auto' tool calls — the loader enforces consent).
            await agentLoader.ensureModel('text', { modelId: chosenModel ?? defaultModel });
            setAgent({ modelId: chosenModel ?? defaultModel });
          }
          w = agentLoader.getChatWorker()!;
        }
        // The previous exhausted turn's cut-off tool result enters this turn's
        // context ONCE (then cleared) — "continue" must not re-run blind.
        const priorResult = lastExhaustedRef.current;
        lastExhaustedRef.current = null;
        const result = await runToolLoop({
          worker: w,
          systemPrompt:
            withPriorToolResult(STUDIO_SYSTEM, priorResult) +
            '\n\n' +
            renderToolsSystemBlock(toolSpecsFromDefinitions()),
          userMessage: message,
          executor,
          // Headroom on EVERY attempt, not just the re-issue — measured live
          // 2026-08-30 ("still hasn't produced an image"): a fresh non-scripted
          // turn chains list-designs → get-design-state → generate-image in
          // its first three rounds, and the old 3-round cap cut the loop off
          // right AFTER generate-image executed — its result reached no
          // further generation, so a failed image looked like a silent no-op
          // and a successful one was never announced. The 512-token default
          // was eaten by thinking after get-design-state and the round came
          // back EMPTY (measured 2026-08-29) — same trap that hit the hosted
          // 27B until its lane went 2048. 6 rounds is still a hard cap; loop
          // protection stays.
          maxTokens: 2048,
          maxRounds: 6,
          onToken: (_tok) => {
            // The streamed deltas are a PREVIEW and can carry partial-token
            // artifacts — measured live 2026-08-29, the on-device 8B doubled
            // every word ("TheThe design design for for your your…") while the
            // worker's assembled final text was clean. They are NEVER painted
            // into the transcript; the assembled result.text below is the only
            // agent prose that shows. This ref only tracks that something
            // streamed (distinguishes a tool-only turn from a prose turn) and
            // throttles a LIVE token counter into the status line so the
            // person can see the model working (their 2026-08-30 ask).
            agentStreamingRef.current = true;
            tokRef.current += 1;
            if (tokRef.current === 1 || tokRef.current % 16 === 0) setLiveTokens(tokRef.current);
          },
          onToolResult: (call, response) => {
            // The human asked to see tool RESULTS, not just the call row —
            // the outcome (ok/fail + cause) goes to the transcript so a
            // failed generate-image names its lane instead of vanishing.
            const { innerText } = unwrapToolResponse(response);
            push({ role: 'tool', text: `${call.name} → ${(innerText || response).slice(0, 240)}` });
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
          // The cap must never read as a silent no-op — name the last tool
          // outcome so a failed generate-image shows its cause instead of
          // vanishing (measured live 2026-08-30: the cap fired right after
          // generate-image and the transcript showed the call but never the
          // result). The same response is injected into the NEXT turn's
          // context (withPriorToolResult) so "continue" is not blind to it.
          lastExhaustedRef.current = result.lastToolResponse;
          const lastOutcome = result.lastToolResponse
            ? ` Last tool result: ${unwrapToolResponse(result.lastToolResponse).innerText.slice(0, 400)}`
            : '';
          push({ role: 'system', text: `Reached the tool-round cap — ask me to continue.${lastOutcome}` });
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

      {/* Text agent — BYOK lane (2026-08-30, WebMCP Challenge): the visitor's
          own OpenAI-compatible endpoint + key drives the studio's tools. */}
      <div className="agent-backend" role="group" aria-label="text agent">
        <span className="agent-backendlabel">Text agent</span>
        <select
          className="agent-backendselect"
          value={textAgent.mode}
          onChange={(e) => updateTextAgent({ mode: e.target.value as TextAgentMode })}
          aria-label="text agent mode"
        >
          <option value="on-device">On-device (WebGPU)</option>
          <option value="fleet">Fleet — Bonsai 27B</option>
          <option value="custom">Custom — your own API key</option>
        </select>
        {textAgent.mode === 'custom' && (
          <>
            <input
              className="agent-backendurl"
              value={textAgent.baseUrl}
              placeholder="https://api.openai.com/v1"
              onChange={(e) => updateTextAgent({ baseUrl: e.target.value })}
              aria-label="text agent base URL"
            />
            <input
              className="agent-backendkey"
              type="password"
              value={textAgent.apiKey}
              placeholder="API key"
              onChange={(e) => updateTextAgent({ apiKey: e.target.value })}
              aria-label="text agent API key"
            />
            <input
              className="agent-backendkey"
              value={textAgent.model}
              placeholder="model (e.g. gpt-4o-mini)"
              onChange={(e) => updateTextAgent({ model: e.target.value })}
              aria-label="text agent model"
            />
          </>
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

              {busy && (
                <div className="agent-livestatus" role="status" aria-live="polite">
                  {/* The loader's progress (model download) and the image
                      tool's generation heartbeat both land in
                      agent.progressDetail; the token counter covers the LLM
                      turn itself — the person can SEE what is working
                      (their 2026-08-30 ask). */}
                  {agent.progressDetail ?? (liveTokens > 0 ? `generating… ${liveTokens} tokens` : 'thinking…')}
                </div>
              )}

              {/* Starter prompts — the judge-mode turnkey entry (WebMCP
                  Challenge 2026): a fresh session with a one-click demo of
                  the co-creation loop. The agent drafts, the human approves.
                  Shown only while the transcript is empty. */}
              {bubbles.length === 0 && !busy && (
                <div className="agent-starters" role="status" aria-label="starter prompts">
                  <span className="agent-starters-label">Try:</span>
                  {STARTERS.map((s) => (
                    <button
                      key={s.label}
                      className="chip chip-starter"
                      onClick={() => void runTurn(s.prompt, { enforce: true })}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}

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
