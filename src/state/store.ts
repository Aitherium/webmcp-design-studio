/**
 * The single source of truth — one zustand store shared by the canvas UI
 * and every tool's `execute()` closure.
 *
 * Model rules (the approve/undo contract):
 * - A design changes ONLY through `commitBatch()` (approve). Everything an
 *   agent does lands in `pendingBatch` first; the human approves or discards.
 * - Batch commits are one undo step: each commit pushes the pre-commit doc
 *   onto that design's version stack.
 * - Creating/duplicating a design while a batch is pending fails the tool
 *   (never silently discards human-visible work).
 */
import { create } from 'zustand';
import type { PaletteId, DesignSizeId } from '../brand/tokens';
import {
  applyOps,
  cloneDesignDoc,
  createDesignDoc,
  effectiveDoc,
  findElement,
  uid,
  type DesignDoc,
  type DesignElement,
  type PendingBatch,
  type PatchOp,
} from './doc';

export interface WebMCPStatus {
  surface: 'real' | 'polyfill' | 'off';
  failures: Array<{ name: string; error: string }>;
}

/**
 * On-device agent runtime state (the D3 gating contract).
 *
 * - `tier` is the detected device tier: A = full on-device (text + image),
 *   B = text-only on-device (WebGPU incl. software), C = hosted-only.
 * - `slot` is the SINGLE-MODEL SLOT: at most one family ('text' | 'image')
 *   is resident; loading one unloads the other.
 * - `phase` mirrors the loader: models never auto-load — the consent chip in
 *   the agent panel is the only thing that moves phase out of 'idle'.
 * - A failed load marks the tier disabled for the session and is surfaced
 *   LOUD in the StatusBar (`lastError`).
 */
export interface AgentState {
  tier: 'A' | 'B' | 'C' | null;
  /** Why the tier was chosen (StatusBar hover / panel detail). */
  tierReasons: string[];
  /** Which model family is resident in the single slot. */
  slot: 'text' | 'image' | null;
  /** Resident model id (e.g. 'bonsai-4b'). */
  modelId: string | null;
  phase: 'idle' | 'loading' | 'ready' | 'generating' | 'error' | 'unavailable';
  /** 0..100 download/progress while loading. */
  progress: number | null;
  progressDetail: string | null;
  /** First-use consent — models load only after this is true. */
  consent: boolean;
  lastError: string | null;
}

export interface StudioState {
  docs: DesignDoc[];
  currentDocId: string | null;
  pendingBatch: PendingBatch | null;
  /** P1.3 (2026-08-31): the undo tool's availability. True while a batch is
   * pending OR the current design has committed versions to roll back —
   * exposed as a field because the version stacks are a closure, not state. */
  canUndo: boolean;

  /** Live tool names read from the WebMCP surface (toolchange UI). */
  liveToolNames: string[];
  webmcpStatus: WebMCPStatus | null;
  /** Slot for the D3 on-device runtime status. */
  runtimeStatus: string | null;
  /** On-device agent gating state (tier, single-model slot, consent). */
  agent: AgentState;

  createDesign(input: { name?: string; size?: DesignSizeId; palette?: PaletteId; background?: string }): DesignDoc;
  setAgent(patch: Partial<AgentState>): void;
  duplicateDesign(name?: string): DesignDoc | null;
  switchDesign(docId: string): void;
  commitBatch(): DesignDoc | null;
  discardBatch(): void;
  /** Number of versions actually popped (0 = nothing to undo). */
  undo(steps?: number): number;
  addElement(element: Omit<DesignElement, 'id' | 'zIndex'> & { id?: string }): string;
  updateElement(elementId: string, patch: Partial<DesignElement>): boolean;
  removeElement(elementId: string): boolean;
  setStyle(patch: Partial<Pick<DesignDoc, 'palette' | 'background'>>): void;
  setLiveTools(names: string[]): void;
  setWebMCPStatus(status: WebMCPStatus): void;
  setRuntimeStatus(text: string | null): void;
}

/** Max version-stack depth per design (undo steps). */
const MAX_UNDO_DEPTH = 50;

function currentDoc(s: StudioState): DesignDoc | null {
  return s.docs.find((d) => d.id === s.currentDocId) ?? null;
}

/* ── persistence (the "I SEE NOTHING" fix, 2026-08-30) ────────────────────────
 * The store booted with docs:[] and NO persistence — every reload wiped the
 * design, and with no doc the canvas rendered 0x0 with no message: a fresh
 * load showed literally NOTHING while the person's poster was gone (measured
 * live: the owner reloaded repeatedly through the session to pick up new
 * bundles, losing each poster; "I SEE NOTHING..... JFC" was the empty canvas
 * with no doc and no hint). Docs + current doc + the pending batch now
 * persist to localStorage (debounced), so a reload keeps the work. The chat
 * transcript stays component-state (out of scope); the DESIGN is the work. */

export const STATE_STORAGE_KEY = 'webmcp.studio.state.v1';

export interface PersistedStudioState {
  docs: DesignDoc[];
  currentDocId: string | null;
  pendingBatch: PendingBatch | null;
}

export function serializeStudioState(s: {
  docs: DesignDoc[];
  currentDocId: string | null;
  pendingBatch: PendingBatch | null;
}): string {
  return JSON.stringify({ docs: s.docs, currentDocId: s.currentDocId, pendingBatch: s.pendingBatch });
}

export function parsePersistedState(raw: string | null): PersistedStudioState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedStudioState>;
    if (!Array.isArray(parsed.docs) || typeof parsed.currentDocId !== 'string' && parsed.currentDocId !== null) {
      return null;
    }
    return {
      docs: parsed.docs,
      currentDocId: parsed.currentDocId ?? null,
      pendingBatch: parsed.pendingBatch ?? null,
    };
  } catch {
    return null;
  }
}

function loadPersisted(): PersistedStudioState | null {
  try {
    return parsePersistedState(localStorage.getItem(STATE_STORAGE_KEY));
  } catch {
    return null; // private mode / blocked storage — start fresh
  }
}

export const createStudioStore = () => {
  const persisted = loadPersisted();
  const store = create<StudioState>()((set, get) => {
    /** Per-design version stacks of pre-commit docs. */
    const versions: Record<string, DesignDoc[]> = {};

    const pushPending = (op: PatchOp): Partial<StudioState> => {
      const batch = get().pendingBatch;
      if (batch) {
        const ops = [...batch.ops, op];
        return { pendingBatch: { ...batch, ops } };
      }
      return { pendingBatch: { id: uid('batch'), ops: [op], createdAt: Date.now() } };
    };

    return {
      docs: persisted?.docs ?? [],
      currentDocId: persisted?.currentDocId ?? null,
      pendingBatch: persisted?.pendingBatch ?? null,
      // Version stacks are never persisted — a reload can't undo.
      canUndo: false,
      liveToolNames: [],
      webmcpStatus: null,
      runtimeStatus: null,
      agent: {
        tier: null,
        tierReasons: [],
        slot: null,
        modelId: null,
        phase: 'idle',
        progress: null,
        progressDetail: null,
        consent: false,
        lastError: null,
      },

      createDesign(input) {
        const doc = createDesignDoc(input);
        set((s) => ({
          docs: [...s.docs, doc],
          currentDocId: doc.id,
          // A fresh design starts clean; any in-flight batch is dropped.
          pendingBatch: null,
          canUndo: false,
        }));
        return doc;
      },

      duplicateDesign(name) {
        const doc = currentDoc(get());
        if (!doc) return null;
        const copy = cloneDesignDoc(doc, name);
        set((s) => ({ docs: [...s.docs, copy], currentDocId: copy.id, pendingBatch: null, canUndo: false }));
        return copy;
      },

      switchDesign(docId) {
        const next = get().docs.some((d) => d.id === docId) ? docId : get().currentDocId;
        set(() => ({
          currentDocId: next,
          canUndo: next ? (versions[next] ?? []).length > 0 : false,
        }));
      },

      commitBatch() {
        const s = get();
        const doc = currentDoc(s);
        const batch = s.pendingBatch;
        if (!doc || !batch) return null;
        const preCommit = doc;
        const committed = applyOps(doc, batch.ops);
        const stack = versions[doc.id] ?? [];
        stack.push(preCommit);
        versions[doc.id] = stack.slice(-MAX_UNDO_DEPTH);
        set((cur) => ({
          docs: cur.docs.map((d) => (d.id === doc.id ? committed : d)),
          pendingBatch: null,
          canUndo: (versions[doc.id] ?? []).length > 0,
        }));
        return committed;
      },

      discardBatch() {
        set({ pendingBatch: null });
      },

      undo(steps = 1) {
        const s = get();
        if (s.pendingBatch) return 0; // resolve the batch first — see tools/undo
        const doc = currentDoc(s);
        if (!doc) return 0;
        const stack = versions[doc.id] ?? [];
        if (stack.length === 0) return 0;
        const n = Math.max(1, Math.min(Math.floor(steps), stack.length));
        const popped = stack.slice(0, -n);
        versions[doc.id] = popped;
        const prev = stack[stack.length - n];
        set((cur) => ({
          docs: cur.docs.map((d) => (d.id === doc.id ? prev : d)),
          pendingBatch: null,
          canUndo: (versions[doc.id] ?? []).length > 0,
        }));
        return n;
      },

      addElement(input) {
        const s = get();
        const doc = currentDoc(s);
        if (!doc) return '';
        const eff = effectiveDoc(doc, s.pendingBatch);
        const el: DesignElement = {
          id: input.id ?? uid('el'),
          type: input.type,
          text: input.text,
          src: input.src,
          thumbnail: input.thumbnail,
          seed: input.seed,
          x: input.x,
          y: input.y,
          width: input.width,
          height: input.height,
          rotation: input.rotation ?? 0,
          zIndex: eff.elements.reduce((max, e) => Math.max(max, e.zIndex), -1) + 1,
          opacity: input.opacity ?? 1,
          fill: input.fill,
          fontSize: input.fontSize,
          fontFamily: input.fontFamily,
          fontWeight: input.fontWeight,
          fontStyle: input.fontStyle,
          align: input.align,
        };
        set(pushPending({ kind: 'add', element: el }));
        return el.id;
      },

      updateElement(elementId, patch) {
        const s = get();
        const doc = currentDoc(s);
        if (!doc || !findElement(doc, s.pendingBatch, elementId)) return false;
        // Coalesce consecutive updates to the same element (typing = one op).
        const batch = s.pendingBatch;
        if (batch && batch.ops.length > 0) {
          const last = batch.ops[batch.ops.length - 1];
          if (last.kind === 'update' && last.elementId === elementId) {
            set({
              pendingBatch: {
                ...batch,
                ops: [...batch.ops.slice(0, -1), { kind: 'update', elementId, patch: { ...last.patch, ...patch } }],
              },
            });
            return true;
          }
        }
        set(pushPending({ kind: 'update', elementId, patch }));
        return true;
      },

      removeElement(elementId) {
        const s = get();
        const doc = currentDoc(s);
        if (!doc || !findElement(doc, s.pendingBatch, elementId)) return false;
        // A pending remove supersedes a pending update to the same element.
        const batch = s.pendingBatch;
        if (batch && batch.ops.length > 0) {
          const last = batch.ops[batch.ops.length - 1];
          if (last.kind === 'update' && last.elementId === elementId) {
            set({ pendingBatch: { ...batch, ops: [...batch.ops.slice(0, -1)] } });
          }
        }
        set(pushPending({ kind: 'remove', elementId }));
        return true;
      },

      setStyle(patch) {
        set(pushPending({ kind: 'style', patch }));
      },

      setLiveTools(names) {
        // Skip when unchanged: set() notifies subscribers unconditionally, and
        // the registry subscriber reconciles on store changes — a no-op write
        // here would feed the registry's own status writes straight back into
        // reconcile, an endless microtask loop that starves the event loop
        // (measured 2026-08-26: the studio hung before first paint in Chrome
        // with a reconcile→emitStatus→setState→subscriber→reconcile stack).
        const s = get();
        if (s.liveToolNames.length === names.length &&
            names.every((n, i) => s.liveToolNames[i] === n)) {
          return;
        }
        set({ liveToolNames: names });
      },
      setWebMCPStatus(status) {
        const s = get();
        const cur = s.webmcpStatus;
        if (cur && cur.surface === status.surface &&
            cur.failures.length === status.failures.length &&
            cur.failures.every((f, i) => f.name === status.failures[i].name &&
                                       f.error === status.failures[i].error)) {
          return;
        }
        set({ webmcpStatus: status });
      },
      setRuntimeStatus(text) {
        set({ runtimeStatus: text });
      },
      setAgent(patch) {
        set((s) => ({ agent: { ...s.agent, ...patch } }));
      },
    };
  });

  // Persistence — debounced save of the DESIGN state only (docs + current doc
  // + the pending batch), so token-stream / agent-progress churn never writes.
  // Image srcs are multi-MB data URLs; a quota overflow is caught and the
  // session simply continues unsaved (reload loses only what did not fit).
  let lastSaved = serializeStudioState({
    docs: persisted?.docs ?? [],
    currentDocId: persisted?.currentDocId ?? null,
    pendingBatch: persisted?.pendingBatch ?? null,
  });
  let saveTimer: number | undefined;
  store.subscribe((state) => {
    const snap = serializeStudioState(state);
    if (snap === lastSaved) return;
    lastSaved = snap;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(STATE_STORAGE_KEY, snap);
      } catch {
        /* quota / private mode — the session continues, unsaved */
      }
    }, 250);
  });

  return store;
};

/** The app-wide singleton — UI subscribes here; tools read it via getStudioStore(). */
export const useStudio = createStudioStore();

/**
 * Tools must read the CURRENT store instance, not a captured one — tests swap
 * the holder per suite so every test starts from a clean store.
 */
let studio = useStudio;
export function getStudioStore(): typeof useStudio {
  return studio;
}
export function setStudioStore(next: typeof useStudio): void {
  studio = next;
}
export function resetStudioStore(): void {
  setStudioStore(useStudio);
}
