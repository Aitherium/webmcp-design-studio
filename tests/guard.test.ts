/**
 * COMPLETE-THE-JOB guard — shouldReissueForEmptyDesign.
 *
 * Measured live 2026-08-29: bonsai-8b ignored the STUDIO_SYSTEM rule and
 * replied with the verbatim-forbidden "would you like me to add text?" on
 * three consecutive turns (including an explicit "actually create it"). The
 * deterministic half of the fix is this decision, re-issuing the hard
 * completion prompt ONCE when a directive turn ends with the design still
 * empty. Every arm below was a real observed state that day.
 */
import { describe, expect, it } from 'vitest';
import { isDirective, shouldReissueForEmptyDesign } from '../src/agent/loop';

describe('shouldReissueForEmptyDesign — the COMPLETE-THE-JOB guard', () => {
  it('fires for a first-turn poster request that changed nothing', () => {
    expect(
      shouldReissueForEmptyDesign('i need a poster for a car wash business', false, 0),
    ).toBe(true);
  });

  it('fires for an explicit "actually create it" that changed nothing', () => {
    expect(shouldReissueForEmptyDesign('actually create it', false, 0)).toBe(true);
  });

  it('fires for a short affirmative ("yes") after the agent asked permission', () => {
    expect(shouldReissueForEmptyDesign('yes', false, 0)).toBe(true);
  });

  it('does NOT fire when the turn already made edits (pending batch or elements)', () => {
    expect(
      shouldReissueForEmptyDesign('i need a poster for a car wash business', true, 0),
    ).toBe(false);
  });

  it('does NOT fire on the re-issue attempt (no infinite loop)', () => {
    expect(
      shouldReissueForEmptyDesign('i need a poster for a car wash business', false, 1),
    ).toBe(false);
  });

  it('does NOT fire for a question — "which palette fits car washes?"', () => {
    expect(
      shouldReissueForEmptyDesign('which palette fits car washes?', false, 0),
    ).toBe(false);
  });

  it('does NOT fire for an info ask with no deliverable keyword', () => {
    expect(shouldReissueForEmptyDesign('hi', false, 0)).toBe(false);
    expect(shouldReissueForEmptyDesign('what can you do', false, 0)).toBe(false);
  });

  it('fires for a directive without a question mark ("make it blue")', () => {
    expect(shouldReissueForEmptyDesign('make it blue', false, 0)).toBe(true);
  });

  it('isDirective agrees — question mark always wins', () => {
    expect(isDirective('what should I make?')).toBe(false);
    expect(isDirective('make a poster')).toBe(true);
    expect(isDirective('generate an image')).toBe(true);
    expect(isDirective('add a headline')).toBe(true);
  });
});
