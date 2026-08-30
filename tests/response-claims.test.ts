/**
 * The generate-image response claim — the SECOND 08-30 false negative.
 *
 * Measured live 2026-08-30 (owner transcript, Tier A page): the scripted
 * flow ran generate-image, the response carried
 *   {"elementId":"el_mtg7zt4wgu0kjml5","device":"cloud","elapsedMs":117494,
 *    "batchSummary":{"batchId":"batch_…","opCount":1,
 *      "ops":[{"kind":"add","elementId":"el_mtg7zt4wgu0kjml5"}]}}
 * wrapped in the executor's envelope {content:[{type:"text",text:"<json>"}]}
 * — and the bubble still reported "image element not placed". The store
 * reconstruction (effectiveDoc over pendingBatch) missed the element while
 * the tool's OWN batchSummary proved the add. The check now trusts the
 * union: store view OR the response's own claim.
 */
import { describe, expect, it } from 'vitest';
import { responseClaimsImageAdd, unwrapToolResponse } from '../src/agent/scripted';

const LIVE_INNER = JSON.stringify({
  elementId: 'el_mtg7zt4wgu0kjml5',
  device: 'cloud',
  elapsedMs: 117494,
  seed: 1369082463,
  thumbnail: null,
  batchSummary: {
    batchId: 'batch_mtg7zt4wg9sveglg',
    opCount: 1,
    ops: [{ kind: 'add', elementId: 'el_mtg7zt4wgu0kjml5' }],
  },
});

const LIVE_WRAPPED = JSON.stringify({ content: [{ type: 'text', text: LIVE_INNER }] });

describe('responseClaimsImageAdd — the tool response is ground truth too', () => {
  it('claims the add through the executor envelope (the exact live 08-30 shape)', () => {
    expect(responseClaimsImageAdd(LIVE_WRAPPED)).toBe(true);
  });

  it('claims the add on a bare (unwrapped) response', () => {
    expect(responseClaimsImageAdd(LIVE_INNER)).toBe(true);
  });

  it('does not claim an image when the batch has no add op', () => {
    const noAdd = JSON.stringify({ batchSummary: { ops: [{ kind: 'update', elementId: 'x' }] } });
    expect(responseClaimsImageAdd(noAdd)).toBe(false);
  });

  it('does not claim an image when the response is a plain error string', () => {
    expect(responseClaimsImageAdd('image generation failed: backend down')).toBe(false);
  });
});

describe('unwrapToolResponse — the envelope is not the answer', () => {
  it('unwraps {content:[{type:text,text}]} to the inner JSON text', () => {
    const { innerText, inner } = unwrapToolResponse(LIVE_WRAPPED);
    expect(innerText).toBe(LIVE_INNER);
    expect(inner).toEqual(JSON.parse(LIVE_INNER));
  });

  it('passes a non-envelope response through untouched', () => {
    const { innerText, inner } = unwrapToolResponse('plain text');
    expect(innerText).toBe('plain text');
    expect(inner).toBeNull();
  });
});
