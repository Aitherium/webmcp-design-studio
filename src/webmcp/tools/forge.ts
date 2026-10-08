/**
 * The FORGE shelf (2026-10-07): media-forge's CURATED ops as live WebMCP
 * tools — `forge-<op>` — so a design can generate / cut out / upscale /
 * restyle / grade / compose images in place.
 *
 * The tool list is NOT in this file. It is read at runtime from
 * `GET {DEMO_BASE}/forge/ops` — the demo governor's forge shelf
 * (AitherOS services/studio/forge_shelf.py), which reads media-forge's
 * curated `GET /ops` live and narrows it to the ops a stranger may run (the
 * hosted-customer allowlist). So an op media-forge ships appears here on the
 * next catalogue read with NO studio release, and a withdrawn op is
 * unregistered from the WebMCP surface.
 *
 * Every call goes `POST {DEMO_BASE}/forge/op/{name}` — the governor prices it,
 * debits the visitor's demo allowance, runs media-forge's AitherSafety-tiered
 * `POST /op/{name}` (never the owner `/api/*` surface) and REFUNDS a call
 * media-forge refused. A refusal comes back `ok:false` with media-forge's own
 * words and is surfaced as such — never retried, never papered over.
 *
 * An unreachable governor or media-forge leaves the shelf EMPTY with a
 * reason (`getForgeStatus()`), and every other studio tool keeps working.
 */
import type { ToolDefinition } from '../types';
import { isValidToolName } from '../types';
import { ok, fail } from '../execute-io';
import { ToolError, currentBatchSummary } from './helpers';
import { withGenerationHeartbeat, withTimeout } from './image';
import { blobToDataUrl, fetchMediaAsDataUrl, srcToBlob } from './mediaforgeClient';
import { currentDocOrThrow, placeImageAt, placeImageBeside, resolveSourceElement } from './mediaforgePlace';
import { DEMO_BASE, ensureVisitor } from '../../demo/credits';
import type { DesignElement } from '../../state/doc';

/* ── the shelf's wire shapes (forge_shelf.py) ───────────────────────────── */

export interface ForgePort {
  name: string;
  type: string;
  required?: boolean;
  many?: boolean;
  help?: string;
}

export interface ForgeParam {
  name: string;
  type: string;
  default?: unknown;
  min?: number | null;
  max?: number | null;
  choices?: string[] | null;
  help?: string;
}

export interface ForgeOp {
  name: string;
  group: string;
  label: string;
  summary: string;
  inputs: ForgePort[];
  params: ForgeParam[];
  cost: string;
  credits: number;
  usd: number;
}

export type ForgeState = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface ForgeStatus {
  state: ForgeState;
  /** forge-* tools currently on the shelf. */
  count: number;
  /** Why the shelf is empty (state 'unavailable'). */
  reason: string | null;
  /** media-forge's AitherSafety tier the catalogue was filtered at. */
  safetyLevel: string | null;
}

/** One synchronous op must finish inside Cloudflare's 100 s edge cut. */
const OP_TIMEOUT_MS = 95_000;
const CATALOGUE_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 60_000;
/** Param types a JSON-schema tool argument cannot honestly carry (canvas
 * selections, LoRA stacks, slider maps, structured data). Left to the op's
 * own defaults. */
const UNSUPPORTED_PARAM_TYPES = new Set(['box', 'mask', 'loras', 'sliders', 'data']);
const CANVAS_PORT_TYPES = new Set(['image', 'ref']);
const FORGE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false } as const;

/* ── module state + subscription ─────────────────────────────────────────── */

let tools: ToolDefinition[] = [];
let status: ForgeStatus = { state: 'idle', count: 0, reason: null, safetyLevel: null };
const listeners = new Set<() => void>();

function publish(next: ForgeStatus, nextTools: ToolDefinition[]): void {
  tools = nextTools;
  status = next;
  for (const l of [...listeners]) l();
}

/** The live forge-* tool definitions (empty until the catalogue loads, or when it cannot). */
export function getForgeTools(): ToolDefinition[] {
  return tools;
}

export function getForgeStatus(): ForgeStatus {
  return status;
}

/** Fires after every catalogue load (success or failure) — main.tsx re-reconciles the registry. */
export function subscribeForge(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetForgeForTests(): void {
  tools = [];
  status = { state: 'idle', count: 0, reason: null, safetyLevel: null };
  listeners.clear();
  inFlight = null;
}

/** The forge-* shelf's state, worded for a human: how many media-forge tools are
 * live, or that they are unavailable and why (the studio keeps working either way). */
export function forgeStatusText(f: ForgeStatus): string {
  if (f.state === 'ready') return `Media Forge: ${f.count} tool${f.count === 1 ? '' : 's'}${f.safetyLevel ? ` · ${f.safetyLevel}` : ''}`;
  if (f.state === 'unavailable') return `Media Forge tools unavailable${f.reason ? ` — ${f.reason}` : ''}`;
  return 'Media Forge: loading…';
}

function forgeBase(): string {
  return `${DEMO_BASE.replace(/\/+$/, '')}/forge`;
}

/** The tool name for an op: `txt2img` → `forge-txt2img`, `remove_bg` → `forge-remove-bg`. */
export function forgeToolName(opName: string): string {
  return `forge-${opName.replace(/_/g, '-')}`;
}

/* ── catalogue load ──────────────────────────────────────────────────────── */

function isPort(v: unknown): v is ForgePort {
  return !!v && typeof v === 'object' && typeof (v as ForgePort).name === 'string' && typeof (v as ForgePort).type === 'string';
}

function parseOp(raw: unknown): ForgeOp | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(o.name)) return null;
  return {
    name: o.name,
    group: typeof o.group === 'string' ? o.group : '',
    label: typeof o.label === 'string' && o.label ? o.label : o.name,
    summary: typeof o.summary === 'string' ? o.summary : '',
    inputs: Array.isArray(o.inputs) ? o.inputs.filter(isPort) : [],
    params: Array.isArray(o.params) ? (o.params.filter(isPort) as unknown as ForgeParam[]) : [],
    cost: typeof o.cost === 'string' ? o.cost : '',
    credits: typeof o.credits === 'number' ? o.credits : 0,
    usd: typeof o.usd === 'number' ? o.usd : 0,
  };
}

let inFlight: Promise<ForgeStatus> | null = null;

/**
 * Read the shelf and rebuild the forge-* tools. NEVER throws: any failure
 * (network, 503 mediaforge_unreachable, a malformed body) empties the shelf
 * and records why — the honest "tools unavailable" state, never a stale list
 * advertising tools a dead backend cannot run.
 */
export function loadForgeCatalog(): Promise<ForgeStatus> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    if (status.state === 'idle') publish({ ...status, state: 'loading' }, tools);
    try {
      if (typeof fetch === 'undefined') throw new Error('no fetch in this context');
      const res = await withTimeout(CATALOGUE_TIMEOUT_MS, 'media-forge catalogue', () => fetch(`${forgeBase()}/ops`));
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || body.available === false || !Array.isArray(body.ops)) {
        throw new Error(reasonOf(res.status, body));
      }
      const ops = body.ops.map(parseOp).filter((o): o is ForgeOp => o !== null);
      const next = ops.map(forgeToolFromOp).filter((t) => isValidToolName(t.name));
      const safety = typeof body.safety_level === 'string' ? body.safety_level : null;
      publish({ state: 'ready', count: next.length, reason: null, safetyLevel: safety }, next);
    } catch (err) {
      publish(
        { state: 'unavailable', count: 0, reason: err instanceof Error ? err.message : String(err), safetyLevel: null },
        [],
      );
    } finally {
      inFlight = null;
    }
    return status;
  })();
  return inFlight;
}

function reasonOf(httpStatus: number, body: Record<string, unknown>): string {
  const d = (body.detail && typeof body.detail === 'object' ? body.detail : body) as Record<string, unknown>;
  const why = typeof d.error === 'string' ? d.error : typeof d.reason === 'string' ? d.reason : '';
  return `media-forge tools unavailable (HTTP ${httpStatus}${why ? `: ${why}` : ''})`;
}

/* ── op → tool ───────────────────────────────────────────────────────────── */

function paramSchema(p: ForgeParam): Record<string, unknown> | null {
  if (UNSUPPORTED_PARAM_TYPES.has(p.type)) return null;
  const help = [p.help, p.default !== null && p.default !== undefined ? `default ${JSON.stringify(p.default)}` : '']
    .filter(Boolean)
    .join(' — ');
  const s: Record<string, unknown> = {};
  switch (p.type) {
    case 'int':
    case 'seed':
      s.type = 'integer';
      break;
    case 'float':
      s.type = 'number';
      break;
    case 'bool':
      s.type = 'boolean';
      break;
    case 'enum':
      s.type = 'string';
      if (Array.isArray(p.choices) && p.choices.length) s.enum = p.choices;
      break;
    default:
      s.type = 'string';
  }
  if (typeof p.min === 'number' && s.type !== 'string') s.minimum = p.min;
  if (typeof p.max === 'number' && s.type !== 'string') s.maximum = p.max;
  if (help) s.description = help;
  return s;
}

function canvasPorts(op: ForgeOp): ForgePort[] {
  return op.inputs.filter((p) => CANVAS_PORT_TYPES.has(p.type));
}

export function forgeToolFromOp(op: ForgeOp): ToolDefinition {
  const ports = canvasPorts(op);
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const port of ports) {
    properties[port.name] = port.many
      ? { type: 'array', items: { type: 'string' }, description: 'Canvas image element ids (or "last-image")' }
      : { type: 'string', description: 'Canvas image element id, or "last-image" for the most recent image' };
    if (port.required) required.push(port.name);
  }
  for (const p of op.params) {
    if (p.name in properties) continue;
    const s = paramSchema(p);
    if (s) properties[p.name] = s;
  }
  const placement = ports.length
    ? 'Places the result as a NEW element beside the source; the source is untouched.'
    : 'Places the result as a NEW image on the canvas.';
  return {
    name: forgeToolName(op.name),
    title: `${op.label} (media-forge)`,
    description:
      `${op.summary || op.label} Media Forge curated op \`${op.name}\` (${op.group || 'op'}), run on the fleet ` +
      `under AitherSafety, not on-device. Costs $${op.usd.toFixed(3)} of the demo allowance per unit; a refused ` +
      `call is not charged. ${placement} UNCOMMITTED until approve-batch.`,
    inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}) },
    annotations: { ...FORGE_ANNOTATIONS },
    available: () => true,
    execute: (args) => runForgeOp(op, args ?? {}),
  };
}

/* ── execution ───────────────────────────────────────────────────────────── */

async function postShelf(path: string, body: Record<string, unknown>, timeoutMs: number, label: string) {
  let res: Response;
  try {
    res = await withTimeout(timeoutMs, label, () =>
      fetch(`${forgeBase()}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  } catch (err) {
    throw new ToolError(`Media Forge tools unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, ok: res.ok, json };
}

/** The governor's refusal envelope, as one line the agent can act on. */
function refusalText(op: ForgeOp, status: number, json: Record<string, unknown>): string {
  const d = (json.detail && typeof json.detail === 'object' ? json.detail : json) as Record<string, unknown>;
  const reason = typeof d.reason === 'string' ? d.reason : `http_${status}`;
  const error = typeof d.error === 'string' ? d.error : '';
  const fix = typeof d.fix === 'string' ? ` — ${d.fix}` : '';
  switch (reason) {
    case 'credits_exhausted':
      return `${forgeToolName(op.name)}: the demo allowance is spent${fix}`;
    case 'op_not_offered':
      return `${forgeToolName(op.name)} REFUSED: ${error || 'not offered on the studio shelf'}`;
    case 'bad_params':
      return `${forgeToolName(op.name)} REFUSED its arguments: ${error}`;
    case 'mediaforge_unreachable':
      markUnavailable(error || 'media-forge is not answering');
      return `Media Forge tools unavailable: ${error || 'media-forge is not answering'}${fix}`;
    default:
      return `${forgeToolName(op.name)} failed (${reason})${error ? `: ${error}` : ''}`;
  }
}

/** A call found the backend dead: say so on the status line without dropping the
 * tools mid-turn (the next catalogue read decides whether they stay). */
function markUnavailable(reason: string): void {
  publish({ ...status, state: 'unavailable', reason }, tools);
}

async function srcAsDataUrl(src: string): Promise<string> {
  if (src.startsWith('data:')) return src;
  return blobToDataUrl(await srcToBlob(src));
}

async function uploadElement(visitor: string, op: ForgeOp, el: DesignElement): Promise<number> {
  const image = await srcAsDataUrl(el.src as string);
  const r = await postShelf('/upload', { visitor, image }, UPLOAD_TIMEOUT_MS, 'canvas upload');
  if (!r.ok) throw new ToolError(refusalText(op, r.status, r.json));
  const id = r.json.media_id;
  if (typeof id !== 'number') throw new ToolError('media-forge upload returned no media id');
  return id;
}

function sourceTargets(args: Record<string, unknown>, port: ForgePort): string[] {
  const v = args[port.name];
  if (v === undefined || v === null || v === '') {
    if (port.required) throw new ToolError(`"${port.name}" is required — a canvas image element id or "last-image"`);
    return [];
  }
  const list = Array.isArray(v) ? v : [v];
  return list.map((t) => {
    if (typeof t !== 'string' || !t.trim()) throw new ToolError(`"${port.name}" must name canvas image element ids`);
    return t.trim();
  });
}

async function runForgeOp(op: ForgeOp, args: Record<string, unknown>) {
  try {
    const doc = currentDocOrThrow();
    // Resolve every source BEFORE any network call: a bad id costs nothing.
    const ports = canvasPorts(op);
    const sources = ports.map((port) => ({ port, els: sourceTargets(args, port).map(resolveSourceElement) }));
    const params: Record<string, unknown> = {};
    for (const p of op.params) {
      if (UNSUPPORTED_PARAM_TYPES.has(p.type)) continue;
      if (args[p.name] !== undefined) params[p.name] = args[p.name];
    }

    const label = `${op.label} on the fleet`;
    const answer = (await withTimeout(OP_TIMEOUT_MS + UPLOAD_TIMEOUT_MS, op.label, () =>
      withGenerationHeartbeat(label, async () => {
        const { visitor } = await ensureVisitor().catch((err: unknown) => {
          throw new ToolError(`Media Forge tools unavailable: the demo governor did not answer (${err instanceof Error ? err.message : String(err)})`);
        });
        for (const { port, els } of sources) {
          if (!els.length) continue;
          const ids = [];
          for (const el of els) ids.push(await uploadElement(visitor, op, el));
          params[port.name] = port.many ? ids : ids[0];
        }
        const r = await postShelf(`/op/${encodeURIComponent(op.name)}`, { visitor, params }, OP_TIMEOUT_MS, op.label);
        if (!r.ok) throw new ToolError(refusalText(op, r.status, r.json));
        return r.json;
      }),
    )) as Record<string, unknown>;

    if (answer.ok !== true) {
      const why = typeof answer.error === 'string' && answer.error ? answer.error : 'media-forge gave no reason';
      if (answer.refused === true) {
        const tier = typeof answer.safety_level === 'string' ? ` at safety tier '${answer.safety_level}'` : '';
        return fail(`${forgeToolName(op.name)} REFUSED by AitherSafety${tier}: ${why}. Nothing was charged.`);
      }
      return fail(`${forgeToolName(op.name)} failed in media-forge: ${why}. Nothing was charged.`);
    }

    const images = Array.isArray(answer.images) ? answer.images.filter((p): p is string => typeof p === 'string') : [];
    if (!images.length) return fail(`${forgeToolName(op.name)} produced no image`);
    const dataUrl = await fetchMediaAsDataUrl(images[0], op.name);
    const first = sources.find((s) => s.els.length)?.els[0];
    const side = Math.round(Math.min(doc.size.width, doc.size.height) / 2);
    const elementId = first
      ? await placeImageBeside(first, dataUrl)
      : await placeImageAt(dataUrl, { x: Math.round((doc.size.width - side) / 2), y: Math.round((doc.size.height - side) / 2), width: side, height: side });
    return ok(
      JSON.stringify({
        op: op.name,
        elementId,
        ...(first ? { sourceElementId: first.id } : {}),
        device: 'mediaforge',
        outputs: images.length,
        chargedUsd: answer.charged_usd,
        usdLeft: answer.usd_left,
        batchSummary: currentBatchSummary(),
      }),
    );
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
