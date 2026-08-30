/**
 * planCallsForState — the create-design data-loss guard.
 *
 * Measured live 2026-08-30 (owner ran the same poster request twice): run 2
 * ran the FULL scripted plan while run 1's batch was still pending —
 * createDesign() drops the in-flight batch (store.ts: "a fresh design starts
 * clean; any in-flight batch is dropped"), silently destroying the
 * unapproved image+text work. The batch panel showed "Nothing pending", the
 * success bubble claimed the draft was built, and the canvas had no image.
 * The rule: create-design is dropped when the current design is blank (reuse
 * it) OR when a batch is pending (never destroy pending work — the plan
 * appends to the existing design/batch instead).
 */
import { describe, expect, it } from 'vitest';
import { buildScriptedPlan, planCallsForState } from '../src/agent/scripted';

function names(calls: Array<{ name: string }>): string[] {
  return calls.map((c) => c.name);
}

const plan = buildScriptedPlan('a poster for a car wash company')!;

describe('planCallsForState — pending work is never destroyed', () => {
  it('a PENDING BATCH drops create-design (the exact 08-30 data-loss shape)', () => {
    const calls = planCallsForState(plan, { hasDoc: true, docBlank: true, batchPending: true });
    expect(names(calls)).not.toContain('create-design');
    expect(names(calls)).toContain('add-text');
    expect(names(calls)).toContain('generate-image');
  });

  it('a pending batch drops create-design even on a non-blank doc (append, never destroy)', () => {
    const calls = planCallsForState(plan, { hasDoc: true, docBlank: false, batchPending: true });
    expect(names(calls)).not.toContain('create-design');
  });

  it('a blank doc with NO batch drops create-design (the reuse rule)', () => {
    const calls = planCallsForState(plan, { hasDoc: true, docBlank: true, batchPending: false });
    expect(names(calls)).not.toContain('create-design');
  });

  it('a non-blank doc with NO batch runs the full plan (fresh design, nothing to lose)', () => {
    const calls = planCallsForState(plan, { hasDoc: true, docBlank: false, batchPending: false });
    expect(names(calls)).toContain('create-design');
  });

  it('no doc at all runs the full plan', () => {
    const calls = planCallsForState(plan, { hasDoc: false, docBlank: false, batchPending: false });
    expect(names(calls)).toContain('create-design');
  });
});
