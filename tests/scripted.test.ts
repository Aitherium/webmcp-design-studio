/**
 * The scripted first turn. Five consecutive live failures on 2026-08-29
 * proved the on-device bonsai-8b cannot chain create→text→image→approve:
 * it stops after create-design and asks permission every time. The scripted
 * plan is the deterministic replacement — these arms pin the exact observed
 * request shapes so a regression reopens the owner's exact complaint.
 */
import { describe, expect, it } from 'vitest';
import {
  buildScriptedPlan,
  deliverableFor,
  runScriptedPlan,
  subjectFromRequest,
} from '../src/agent/scripted';

describe('deliverableFor — only real deliverable requests get scripted', () => {
  it('recognizes the poster request from the live failures', () => {
    expect(deliverableFor('i need a poster for a car wash business')).toBe('poster');
    expect(deliverableFor('i need a poster for a car wash company')).toBe('poster');
  });

  it('recognizes flyer / story / square requests', () => {
    expect(deliverableFor('make a flyer for the bakery')).toBe('flyer');
    expect(deliverableFor('a story about my cafe')).toBe('story');
    expect(deliverableFor('an instagram post for the gym')).toBe('story');
  });

  it('returns null for refinements — those stay on the model path', () => {
    expect(deliverableFor('make the headline bigger')).toBeNull();
    expect(deliverableFor('actually create it')).toBeNull();
    expect(deliverableFor('yes')).toBeNull();
  });
});

describe('subjectFromRequest', () => {
  it('extracts the subject from the live failure request', () => {
    expect(subjectFromRequest('i need a poster for a car wash company')).toBe('Car Wash Company');
  });

  it('strips articles and capitalization works', () => {
    expect(subjectFromRequest('make a flyer for the bakery')).toBe('Bakery');
  });
});

describe('buildScriptedPlan — the deterministic completion', () => {
  it('builds the full sequence for a poster request', () => {
    const plan = buildScriptedPlan('i need a poster for a car wash company');
    expect(plan).not.toBeNull();
    const names = plan!.calls.map((c) => c.name);
    expect(names).toEqual([
      'create-design',
      'add-text',
      'add-text',
      'add-text',
      'generate-image',
    ]);
  });

  it('headline carries the subject; image uses device auto and the neon style', () => {
    const plan = buildScriptedPlan('i need a poster for a car wash company')!;
    const headline = plan.calls[1].args as { text: string };
    const image = plan.calls[4].args as { device: string; style: string; size: string };
    expect(headline.text).toBe('Car Wash Company');
    expect(image.device).toBe('auto');
    expect(image.style).toBe('neon');
    expect(image.size).toBe('tall');
  });

  it('does NOT call approve-batch — the pending batch is the human gate', () => {
    const plan = buildScriptedPlan('i need a poster for a car wash company')!;
    expect(plan.calls.some((c) => c.name === 'approve-batch')).toBe(false);
  });

  it('returns null for a non-deliverable', () => {
    expect(buildScriptedPlan('make the headline bigger')).toBeNull();
  });
});

describe('runScriptedPlan — executes through the shared executor', () => {
  it('runs every call in order and reports responses', async () => {
    const seen: string[] = [];
    const executor = async (name: string) => {
      seen.push(name);
      return `${name} ok`;
    };
    const plan = buildScriptedPlan('a poster for a car wash company')!;
    const responses = await runScriptedPlan(plan, executor, () => undefined);
    expect(seen).toEqual(['create-design', 'add-text', 'add-text', 'add-text', 'generate-image']);
    expect(responses).toHaveLength(5);
    expect(responses[0]).toBe('create-design ok');
  });
});
