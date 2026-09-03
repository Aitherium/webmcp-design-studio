/**
 * Demo credits + GPU burst — the studio half of the demo governor (lane 3,
 * 2026-09-03). The server half is `AitherOS/services/studio/demo_governor.py`,
 * mounted at `/api/demo/` on studio-preview; every shape below is read off
 * that router, not invented here.
 *
 * What a visitor gets: a fixed allowance (turns + usd) minted by
 * POST /session and remembered in localStorage under `studio.demo.visitor`.
 * The HOSTED text lane debits one `turn` per turn BEFORE it sends (see
 * `meterHostedTurn`); on-device and BYOK lanes are never metered — the
 * visitor's own GPU or own key is their own spend.
 *
 * The burst: POST /burst rents a cloud GPU through MediaForge under the
 * owner's DAILY cap; the governor refuses with a reason a UI can show
 * (402 credits_exhausted / 429 daily_burst_cap_reached|burst_disabled /
 * 502 burst_up_failed) and tears an idle instance down on its own.
 *
 * Origin rule mirrors serviceBases.ts (not imported — that file is another
 * lane's): the PUBLIC origins reach the governor cross-origin on the preview
 * host; everything else uses the same-origin `/api/demo` proxy.
 */

export const DEMO_BASE =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'studio.aitherium.com' ||
    window.location.hostname === 'studio-preview.aitherium.com')
    ? 'https://studio-preview.aitherium.com/api/demo'
    : '/api/demo';

export const VISITOR_KEY = 'studio.demo.visitor';

export type SpendKind = 'turn' | 'image' | 'media' | 'burst_minute';

export interface DemoPolicy {
  turns_per_visitor: number;
  usd_per_visitor: number;
  burst_usd_per_day: number;
  burst_max_price_per_hour: number;
  burst_idle_teardown_min: number;
  burst_enabled: boolean;
}

/** POST /session and GET /credits answer this; POST /spend answers it without `policy`. */
export interface DemoCredits {
  visitor: string;
  turns_left: number;
  usd_left: number;
  created_at: string;
  policy: DemoPolicy | null;
}

export interface BurstStatus {
  up: boolean;
  gpu: string | null;
  price_per_hour: number | null;
  hours_up: number | null;
  live_est_usd: number;
  ledger_today_usd: number;
  usd_left_today: number;
  policy: DemoPolicy | null;
}

export interface BurstGrant {
  reused: boolean;
  gpu: string | null;
  price_per_hour: number | null;
  comfyui_url: string | null;
  instance_id: string | number | null;
  usd_left_today: number | null;
}

/** The governor's refusal envelope: `{detail: {ok:false, reason, ...}}`. */
export interface DemoRefusalDetail {
  ok: false;
  reason: string;
  fix?: string;
  [key: string]: unknown;
}

/** A typed refusal (402 / 404 / 429 / 502) carrying the server's reason. */
export class DemoRefused extends Error {
  readonly status: number;
  readonly reason: string;
  readonly detail: DemoRefusalDetail;
  constructor(status: number, detail: DemoRefusalDetail) {
    super(`demo governor ${status}: ${detail.reason}`);
    this.name = 'DemoRefused';
    this.status = status;
    this.reason = detail.reason;
    this.detail = detail;
  }
}

/** 402 credits_exhausted — carries the server's `fix` text verbatim. */
export class CreditsExhausted extends DemoRefused {
  readonly fix: string;
  constructor(detail: DemoRefusalDetail) {
    super(402, detail);
    this.name = 'CreditsExhausted';
    this.fix =
      typeof detail.fix === 'string' && detail.fix !== ''
        ? detail.fix
        : 'switch to the on-device brain or bring your own key';
  }
}

/* ── storage (fail-soft: private mode / quota / disabled storage) ─────────── */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let storageOverride: StorageLike | null | undefined;

/** Tests inject a fake; `null` simulates storage being unavailable;
 * `undefined` restores the real localStorage. */
export function configureDemoStorage(storage: StorageLike | null | undefined): void {
  storageOverride = storage;
}

function storage(): StorageLike | null {
  if (storageOverride !== undefined) return storageOverride;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function readVisitor(): string | null {
  try {
    const v = storage()?.getItem(VISITOR_KEY) ?? null;
    return v && v.length >= 8 ? v : null;
  } catch {
    return null;
  }
}

function writeVisitor(visitor: string | null): void {
  try {
    const s = storage();
    if (!s) return;
    if (visitor) s.setItem(VISITOR_KEY, visitor);
    else s.removeItem(VISITOR_KEY);
  } catch {
    /* quota / private mode — the session continues, the id lives in memory */
  }
}

/* ── the subscribable store ────────────────────────────────────────────────── */

export interface DemoSnapshot {
  credits: DemoCredits | null;
  burst: BurstStatus | null;
  /** Last transport/governor failure, for the meter's tooltip. */
  error: string | null;
}

let snapshot: DemoSnapshot = { credits: null, burst: null, error: null };
const listeners = new Set<(s: DemoSnapshot) => void>();

function publish(patch: Partial<DemoSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const l of [...listeners]) l(snapshot);
}

export function getDemoSnapshot(): DemoSnapshot {
  return snapshot;
}

export function subscribeCredits(listener: (s: DemoSnapshot) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests: forget the visitor, the balances and any in-flight mint. */
export function resetDemoStateForTests(): void {
  snapshot = { credits: null, burst: null, error: null };
  listeners.clear();
  mintInFlight = null;
  memoryVisitor = null;
}

/* ── transport ──────────────────────────────────────────────────────────────── */

function base(): string {
  return DEMO_BASE.replace(/\/+$/, '');
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const data = (await res.json()) as unknown;
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function refusalOf(status: number, body: Record<string, unknown>): DemoRefused {
  const raw = body.detail;
  const detail: DemoRefusalDetail =
    raw && typeof raw === 'object' && typeof (raw as { reason?: unknown }).reason === 'string'
      ? { ...(raw as Record<string, unknown>), ok: false, reason: (raw as { reason: string }).reason }
      : { ok: false, reason: `http_${status}` };
  return detail.reason === 'credits_exhausted'
    ? new CreditsExhausted(detail)
    : new DemoRefused(status, detail);
}

async function call(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  if (typeof fetch === 'undefined') throw new Error('demo governor unavailable (no fetch)');
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await readJson(res);
  if (!res.ok) throw refusalOf(res.status, body);
  return body;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function parsePolicy(v: unknown): DemoPolicy | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  return {
    turns_per_visitor: num(p.turns_per_visitor, 0),
    usd_per_visitor: num(p.usd_per_visitor, 0),
    burst_usd_per_day: num(p.burst_usd_per_day, 0),
    burst_max_price_per_hour: num(p.burst_max_price_per_hour, 0),
    burst_idle_teardown_min: num(p.burst_idle_teardown_min, 0),
    burst_enabled: p.burst_enabled === true,
  };
}

function parseCredits(body: Record<string, unknown>, fallbackVisitor: string | null): DemoCredits {
  const visitor = strOrNull(body.visitor) ?? fallbackVisitor;
  if (!visitor) throw new Error('demo governor returned no visitor id');
  return {
    visitor,
    turns_left: num(body.turns_left, 0),
    usd_left: num(body.usd_left, 0),
    created_at: strOrNull(body.created_at) ?? '',
    // /spend omits policy — keep the one we already hold.
    policy: parsePolicy(body.policy) ?? snapshot.credits?.policy ?? null,
  };
}

function parseBurst(body: Record<string, unknown>): BurstStatus {
  return {
    up: body.up === true,
    gpu: strOrNull(body.gpu),
    price_per_hour: numOrNull(body.price_per_hour),
    hours_up: numOrNull(body.hours_up),
    live_est_usd: num(body.live_est_usd, 0),
    ledger_today_usd: num(body.ledger_today_usd, 0),
    usd_left_today: num(body.usd_left_today, 0),
    policy: parsePolicy(body.policy),
  };
}

/* ── the API ──────────────────────────────────────────────────────────────── */

let mintInFlight: Promise<DemoCredits> | null = null;
/** The id when storage is unavailable — lives for the tab only. */
let memoryVisitor: string | null = null;

function forgetVisitor(): void {
  writeVisitor(null);
  memoryVisitor = null;
}

function isUnknownVisitor(err: unknown): boolean {
  return err instanceof DemoRefused && err.status === 404 && err.reason === 'unknown_visitor';
}

async function mint(): Promise<DemoCredits> {
  if (!mintInFlight) {
    mintInFlight = (async () => {
      try {
        const credits = parseCredits(await call('/session', { method: 'POST', body: '{}' }), null);
        memoryVisitor = credits.visitor;
        writeVisitor(credits.visitor);
        publish({ credits, error: null });
        return credits;
      } finally {
        mintInFlight = null;
      }
    })();
  }
  return mintInFlight;
}

/**
 * The visitor's credits, minting a session when there is no id yet or when
 * the governor no longer knows the stored one (404 unknown_visitor — the
 * store was reset, or the id is garbage).
 */
export async function ensureVisitor(): Promise<DemoCredits> {
  const stored = readVisitor() ?? memoryVisitor;
  if (!stored) return mint();
  try {
    const credits = parseCredits(
      await call(`/credits?visitor=${encodeURIComponent(stored)}`),
      stored,
    );
    memoryVisitor = credits.visitor;
    publish({ credits, error: null });
    return credits;
  } catch (err) {
    if (isUnknownVisitor(err)) {
      forgetVisitor();
      return mint();
    }
    throw err;
  }
}

export async function getCredits(): Promise<DemoCredits> {
  return ensureVisitor();
}

async function spend(visitor: string, kind: SpendKind, usd: number | undefined): Promise<DemoCredits> {
  const body = JSON.stringify(usd === undefined ? { visitor, kind } : { visitor, kind, usd });
  const credits = parseCredits(await call('/spend', { method: 'POST', body }), visitor);
  publish({ credits, error: null });
  return credits;
}

/**
 * Debit one metered call. Resolves to the new balances; throws
 * `CreditsExhausted` (with the server's `fix`) on 402. A stale visitor id is
 * re-minted once and the debit retried against the new session.
 */
export async function debit(kind: SpendKind, usd?: number): Promise<DemoCredits> {
  const { visitor } = await ensureVisitor();
  try {
    return await spend(visitor, kind, usd);
  } catch (err) {
    if (isUnknownVisitor(err)) {
      forgetVisitor();
      const fresh = await mint();
      return spend(fresh.visitor, kind, usd);
    }
    if (err instanceof CreditsExhausted && snapshot.credits) {
      // The allowance is gone whatever we last read — the meter must agree with the refusal.
      publish({ credits: { ...snapshot.credits, turns_left: 0 } });
    }
    throw err;
  }
}

export async function getBurstStatus(): Promise<BurstStatus> {
  const burst = parseBurst(await call('/burst/status'));
  publish({ burst, error: null });
  return burst;
}

/**
 * Rent (or reuse) the burst GPU for this visitor. Refusals throw `DemoRefused`
 * — `CreditsExhausted` for 402, reason `daily_burst_cap_reached` /
 * `burst_disabled` for 429, `burst_up_failed` for 502.
 */
export async function requestBurst(): Promise<BurstGrant> {
  const { visitor } = await ensureVisitor();
  try {
    const body = await call('/burst', { method: 'POST', body: JSON.stringify({ visitor }) });
    const grant: BurstGrant = {
      reused: body.reused === true,
      gpu: strOrNull(body.gpu),
      price_per_hour: numOrNull(body.price_per_hour),
      comfyui_url: strOrNull(body.comfyui_url),
      instance_id:
        typeof body.instance_id === 'number' || typeof body.instance_id === 'string'
          ? body.instance_id
          : null,
      usd_left_today: numOrNull(body.usd_left_today),
    };
    publish({
      burst: {
        ...(snapshot.burst ?? parseBurst({})),
        up: true,
        gpu: grant.gpu,
        price_per_hour: grant.price_per_hour,
        usd_left_today: grant.usd_left_today ?? snapshot.burst?.usd_left_today ?? 0,
      },
      error: null,
    });
    return grant;
  } catch (err) {
    // A 429 carries the whole status in its detail — keep the meter current.
    if (err instanceof DemoRefused && err.status === 429 && typeof err.detail.up === 'boolean') {
      publish({ burst: parseBurst(err.detail) });
    }
    throw err;
  }
}

export async function releaseBurst(): Promise<{ ok: boolean; was_up: boolean }> {
  const body = await call('/burst/release', { method: 'POST', body: '{}' });
  const result = { ok: body.ok !== false, was_up: body.was_up === true };
  publish({
    burst: snapshot.burst ? { ...snapshot.burst, up: false, gpu: null, price_per_hour: null } : null,
  });
  return result;
}

/* ── the hosted-lane gate ───────────────────────────────────────────────────── */

export type HostedTurnGate =
  | { allowed: true; metered: boolean; credits: DemoCredits | null }
  | { allowed: false; reason: 'credits_exhausted' | 'governor_unreachable'; fix: string };

/**
 * Called by the agent panel BEFORE a hosted (fleet) turn is sent. Only the
 * fleet lane is metered: on-device and BYOK turns pass straight through.
 * A 402 refuses the send and hands back the server's `fix` text. Any other
 * failure (governor unreachable, dev origin without the router) lets the
 * turn through UNMETERED and records why — the client-side meter is the
 * visible half of the governor, and a dead chat panel on a dev box is a
 * worse demo than an unmetered turn.
 */
export async function meterHostedTurn(
  mode: 'on-device' | 'fleet' | 'custom',
): Promise<HostedTurnGate> {
  if (mode !== 'fleet') return { allowed: true, metered: false, credits: snapshot.credits };
  try {
    const credits = await debit('turn');
    return { allowed: true, metered: true, credits };
  } catch (err) {
    if (err instanceof CreditsExhausted) {
      return { allowed: false, reason: 'credits_exhausted', fix: err.fix };
    }
    publish({ error: err instanceof Error ? err.message : String(err) });
    if (isPublicDemoOrigin()) {
      // The PUBLIC demo is metered by contract: a governor that is not answering
      // means nobody is counting, and an unmetered hosted turn there is spend nobody
      // approved. The two free lanes still work; name them (owner, 2026-09-03).
      return {
        allowed: false,
        reason: 'governor_unreachable',
        fix: 'the hosted demo lane is metered and its governor is not answering — switch to the on-device brain or bring your own key',
      };
    }
    return { allowed: true, metered: false, credits: snapshot.credits };
  }
}

/** True on the public demo origins, where the hosted lane must FAIL CLOSED. */
export function isPublicDemoOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'studio.aitherium.com' || h === 'studio-preview.aitherium.com';
}
