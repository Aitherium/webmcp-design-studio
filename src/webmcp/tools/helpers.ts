/**
 * Shared helpers for tool implementations: argument validation (throwing
 * `ToolError` → surfaced as a fail() result) and batch summaries.
 */
import { getStudioStore } from '../../state/store';
import { summarizeBatch, describeDesign, type DesignDoc, type PendingBatch } from '../../state/doc';

/** A tool-level error — its message becomes the fail() text. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export function argString(
  args: Record<string, unknown>,
  key: string,
  opts: { required?: boolean; maxLength?: number } = {},
): string | undefined {
  const value = args[key];
  if (value === undefined) {
    if (opts.required) throw new ToolError(`"${key}" is required`);
    return undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolError(`"${key}" must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (opts.maxLength !== undefined && trimmed.length > opts.maxLength) {
    throw new ToolError(`"${key}" must be at most ${opts.maxLength} characters`);
  }
  return trimmed;
}

export function argNumber(
  args: Record<string, unknown>,
  key: string,
  opts: { min?: number; max?: number; integer?: boolean } = {},
): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolError(`"${key}" must be a number`);
  }
  if (opts.integer && !Number.isInteger(value)) {
    throw new ToolError(`"${key}" must be an integer`);
  }
  if (opts.min !== undefined && value < opts.min) {
    throw new ToolError(`"${key}" must be >= ${opts.min}`);
  }
  if (opts.max !== undefined && value > opts.max) {
    throw new ToolError(`"${key}" must be <= ${opts.max}`);
  }
  return value;
}

export function argEnum(
  args: Record<string, unknown>,
  key: string,
  values: readonly string[],
): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new ToolError(`"${key}" must be one of: ${values.join(', ')}`);
  }
  return value;
}

export function argBool(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new ToolError(`"${key}" must be a boolean`);
  return value;
}

export interface StudioSnapshot {
  doc: DesignDoc | null;
  pending: PendingBatch | null;
}

/** Current store state in a tool-friendly shape. */
export function snapshot(): StudioSnapshot {
  const s = getStudioStore().getState();
  const doc = s.docs.find((d) => d.id === s.currentDocId) ?? null;
  return { doc, pending: s.pendingBatch };
}

/** The pending batch after the last action — fresh from the store. */
export function currentBatchSummary(): ReturnType<typeof summarizeBatch> {
  return summarizeBatch(getStudioStore().getState().pendingBatch);
}

export function designSummary(doc: DesignDoc, pending: PendingBatch | null): ReturnType<typeof describeDesign> {
  return describeDesign(doc, pending);
}
