/**
 * Tool-loop parsing + execution — the in-page agent's brain.
 *
 * Hermes-style <tools> / <tool_call> / <tool_response> rendering and LENIENT
 * parsing (small models malform XML often); the loop executes calls through
 * the executor and regenerates, capped at MAX_TOOL_ROUNDS.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_TOOL_ROUNDS,
  applyFinalAnswer,
  createToolExecutor,
  isTruncatedToolCall,
  parseToolCalls,
  renderToolsSystemBlock,
  runToolLoop,
  toolSpecsFromDefinitions,
  withPriorToolResult,
  type ToolExecutor,
} from '../src/agent/loop';
import type { ChatWorkerLike, WorkerResponse } from '../src/agent/loader';

/* ── parsing ──────────────────────────────────────────────────────────────── */

describe('parseToolCalls — lenient Hermes parsing', () => {
  it('extracts a well-formed call and leaves the surrounding text', () => {
    const { calls, rest } = parseToolCalls(
      'Let me look at the design.\n<tool_call>\n{"name": "get-design-state", "arguments": {}}\n</tool_call>\nDone.',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('get-design-state');
    // The trailing newline of the call block is consumed with the match — the
    // surrounding text survives with its own newline (reference behavior).
    expect(rest).toBe('Let me look at the design.\n\nDone.');
  });

  it('recovers a truncated call (valid JSON, missing closing tag)', () => {
    const { calls, rest } = parseToolCalls(
      '<tool_call>\n{"name": "create-design", "arguments": {"size": "flyer"}}',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('create-design');
    expect(calls[0].arguments).toEqual({ size: 'flyer' });
    expect(rest).toBe('');
  });

  it('a call truncated MID-JSON stays visible (never fabricated)', () => {
    // The model stopped with the inner object closed but the outer open —
    // unrepairable, so the raw text must remain in the transcript.
    const { calls, rest } = parseToolCalls(
      '<tool_call>\n{"name": "create-design", "arguments": {"size": "flyer"}',
    );
    expect(calls).toHaveLength(0);
    expect(rest).toContain('tool_call');
    expect(rest).toContain('create-design');
  });

  it('repairs trailing commas and single-quoted keys (small-model malformations)', () => {
    const { calls } = parseToolCalls(
      `<tool_call>{"name": "add-text", "arguments": {"text": "hello", "x": 10,}}</tool_call>`,
    );
    expect(calls[0].name).toBe('add-text');
    expect(calls[0].arguments.text).toBe('hello');

    const { calls: calls2 } = parseToolCalls(
      `<tool_call>{'name': 'edit-element', 'arguments': {'elementId': 'el_1'}}</tool_call>`,
    );
    expect(calls2[0].name).toBe('edit-element');
    expect(calls2[0].arguments.elementId).toBe('el_1');
  });

  it('accepts parameters as an alias for arguments', () => {
    const { calls } = parseToolCalls(
      `<tool_call>{"name": "undo", "parameters": {"steps": 2}}</tool_call>`,
    );
    expect(calls[0].name).toBe('undo');
    expect(calls[0].arguments).toEqual({ steps: 2 });
  });

  it('UNPARSEABLE calls stay visible in the transcript (never silent)', () => {
    const { calls, rest } = parseToolCalls('<tool_call>{"name": }</tool_call>');
    expect(calls).toHaveLength(0);
    expect(rest).toContain('tool_call'); // the raw text remains
  });

  it('recovers a NESTED wrapper (small model re-wraps its own call)', () => {
    // Measured live 2026-08-29 on bonsai-8b: after a failed tool round the
    // model emitted <tool_call><tool_call>{json}</tool_call></tool_call> —
    // the outer regex stops at the FIRST close, so the body carries a stray
    // opening tag that the strip repair removes.
    const { calls } = parseToolCalls(
      `<tool_call><tool_call>{"name": "list-designs", "arguments": {}}</tool_call></tool_call>`,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('list-designs');
  });
});

describe('renderToolsSystemBlock', () => {
  it('declares the tools as JSON inside <tools> tags', () => {
    const block = renderToolsSystemBlock([
      { name: 'list-designs', description: 'List designs', parameters: { type: 'object', properties: {} } },
    ]);
    expect(block).toContain('<tools>');
    expect(block).toContain('</tools>');
    expect(block).toContain('"name":"list-designs"');
    expect(block).toContain('<tool_call>');
  });
});

/* ── the loop ─────────────────────────────────────────────────────────────── */

function fakeWorker(replies: Array<{ text: string; tokens?: string[] }>): ChatWorkerLike {
  let round = 0;
  let listener: ((msg: WorkerResponse) => void) | null = null;
  return {
    post(msg) {
      if (msg.type !== 'generate') return;
      const reply = replies[Math.min(round, replies.length - 1)];
      round += 1;
      queueMicrotask(() => {
        for (const t of reply.tokens ?? []) listener?.({ type: 'token', text: t, channel: 'answer' });
        listener?.({ type: 'done', text: reply.text });
      });
    },
    on(l) {
      listener = l;
      return () => {
        if (listener === l) listener = null;
      };
    },
    interrupt() {},
    dispose() {},
  };
}

function recordingExecutor(calls: Array<{ name: string; args: Record<string, unknown> }>): ToolExecutor {
  return async (name, args) => {
    calls.push({ name, args });
    return `executed ${name}`;
  };
}

describe('runToolLoop', () => {
  it('a plain answer returns immediately with no tool calls', async () => {
    const worker = fakeWorker([{ text: 'Here is your flyer summary.' }]);
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const result = await runToolLoop({
      worker,
      systemPrompt: 'sys',
      userMessage: 'hi',
      executor: recordingExecutor(calls),
    });
    expect(result.text).toContain('flyer');
    expect(result.rounds).toBe(1);
    expect(result.exhausted).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('executes a tool call and hands the response back to the model', async () => {
    const worker = fakeWorker([
      {
        text: '<tool_call>\n{"name": "create-design", "arguments": {"size": "flyer"}}\n</tool_call>',
        tokens: ['<tool_call>…'],
      },
      { text: 'Created the flyer.' },
    ]);
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const result = await runToolLoop({
      worker,
      systemPrompt: 'sys',
      userMessage: 'make a flyer',
      executor: recordingExecutor(calls),
    });
    expect(calls).toEqual([{ name: 'create-design', args: { size: 'flyer' } }]);
    expect(result.rounds).toBe(2);
    expect(result.text).toBe('Created the flyer.');
    expect(result.toolCalls).toHaveLength(1);
  });

  it('caps at MAX_TOOL_ROUNDS and reports exhausted', async () => {
    const loopForever = fakeWorker([
      { text: '<tool_call>{"name": "create-design", "arguments": {}}</tool_call>' },
    ]);
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    let warned = false;
    const result = await runToolLoop({
      worker: loopForever,
      systemPrompt: 'sys',
      userMessage: 'keep going',
      executor: recordingExecutor(calls),
      onMaxRounds: () => {
        warned = true;
      },
    });
    expect(calls.length).toBe(MAX_TOOL_ROUNDS);
    expect(result.exhausted).toBe(true);
    expect(warned).toBe(true);
  });

  it('streams tokens through onToken', async () => {
    const worker = fakeWorker([{ text: 'hello world', tokens: ['hel', 'lo ', 'world'] }]);
    let streamed = '';
    await runToolLoop({
      worker,
      systemPrompt: 'sys',
      userMessage: 'hi',
      executor: async () => '',
      onToken: (t) => {
        streamed += t;
      },
    });
    expect(streamed).toBe('hello world');
  });
});

/* ── executor: real WebMCP API first, registry fallback ───────────────────── */

describe('createToolExecutor', () => {
  it('routes through the REAL WebMCP API when a surface exists', async () => {
    const executed: Array<[string, unknown]> = [];
    const surface = {
      isPolyfill: false,
      async getTools() {
        return [{ name: 'add-text', description: 'x', inputSchema: {}, window: null, origin: null }];
      },
      async executeTool(tool: { name: string }, input: unknown) {
        executed.push([tool.name, input]);
        return '"ok"';
      },
      addEventListener() {},
      removeEventListener() {},
    };
    const exec = createToolExecutor({ surface: surface as never });
    const out = await exec('add-text', { text: 'hi' });
    // Chrome 152 (measured D4, 2026-08-25) takes the input as a JSON STRING;
    // the executor must match the real API, not the pre-D4 object spelling.
    expect(executed).toEqual([['add-text', '{"text":"hi"}']]);
    expect(out).toBe('"ok"');
  });

  it('a tool missing from the surface is reported honestly (not executed locally)', async () => {
    const surface = {
      isPolyfill: false,
      async getTools() {
        return [];
      },
      executeTool: async () => 'nope',
      addEventListener() {},
      removeEventListener() {},
    };
    const exec = createToolExecutor({ surface: surface as never });
    const out = await exec('add-text', { text: 'hi' });
    expect(out).toContain('not registered');
    expect(out).toContain('add-text');
  });

  it('resolves a CASE-MANGLED name to the real tool (measured 2026-08-29 live)', async () => {
    // The on-device brain emitted create-Design / list-Designs /
    // get-Design-State — every one a case error away from a real tool, and
    // the strict match turned each into a "not registered" reply the model
    // amplified into nesting + stutter until the round cap. The surface must
    // receive the REAL registered name, not the mangled one.
    const executed: Array<[string, unknown]> = [];
    const surface = {
      isPolyfill: false,
      async getTools() {
        return [
          { name: 'create-design', description: 'x', inputSchema: {}, window: null, origin: null },
          { name: 'list-designs', description: 'x', inputSchema: {}, window: null, origin: null },
          { name: 'get-design-state', description: 'x', inputSchema: {}, window: null, origin: null },
        ];
      },
      async executeTool(tool: { name: string }, input: unknown) {
        executed.push([tool.name, input]);
        return '"ok"';
      },
      addEventListener() {},
      removeEventListener() {},
    };
    const exec = createToolExecutor({ surface: surface as never });
    await exec('create-Design', { name: 'Cool Dogs Poster' });
    await exec('list-Designs', {});
    await exec('get-Design-State', {});
    expect(executed.map(([n]) => n)).toEqual(['create-design', 'list-designs', 'get-design-state']);
  });
});

/* ── final-answer merge: the stream is a preview, done.text is truth ──────── */

describe('applyFinalAnswer — streamed deltas are a preview, the assembled text is truth', () => {
  it('replaces the last agent bubble with the trimmed final answer', () => {
    // Measured live 2026-08-29: the on-device 8B's STREAM doubled every word
    // ("TheThe design design for for your your landing landing page page…")
    // while the worker's assembled done.text was clean. The UI must paint the
    // assembled text, not the streamed artifact.
    const bubbles = [
      { role: 'user', text: 'a landing page' },
      { role: 'tool', text: 'create-Design({...})' },
      { role: 'agent', text: 'TheThe design design for for your your landing landing page page has has been been created created.' },
    ];
    const merged = applyFinalAnswer(bubbles, 'The design for your landing page has been created.');
    expect(merged).toHaveLength(3);
    expect(merged[2].text).toBe('The design for your landing page has been created.');
    expect(merged[1].role).toBe('tool'); // tool rows survive untouched
  });

  it('appends when nothing streamed', () => {
    const merged = applyFinalAnswer([{ role: 'user', text: 'hi' }], 'The design is ready.');
    expect(merged[1]).toEqual({ role: 'agent', text: 'The design is ready.' });
  });

  it('never replaces with an empty final text', () => {
    const bubbles = [{ role: 'agent', text: 'streamed preview' }];
    expect(applyFinalAnswer(bubbles, '   ')).toBe(bubbles);
  });
});

/* ── prior-context injection (the "ask me to continue" continuation) ───────── */

describe('withPriorToolResult — the next turn must see what the cap cut off', () => {
  it('returns the prompt unchanged when there is no prior result', () => {
    const p = 'SYSTEM';
    expect(withPriorToolResult(p, null)).toBe(p);
    expect(withPriorToolResult(p, '')).toBe(p);
  });

  it('injects the cut-off tool result as context for the next turn', () => {
    const out = withPriorToolResult('SYSTEM', '{"ok":true,"elementId":"el_abc"}');
    expect(out).toContain('SYSTEM');
    expect(out).toContain('el_abc');
    expect(out).toContain('tool-round cap cut you off');
  });

  it('caps the injected result at 800 chars (a data-URL image payload must not flood the context)', () => {
    const huge = 'x'.repeat(5000);
    const out = withPriorToolResult('SYSTEM', huge);
    const injected = out.slice('SYSTEM'.length);
    expect(injected.length).toBeLessThanOrEqual(800 + 200); // header text + capped payload
    expect(out).not.toContain('x'.repeat(900));
  });
});

/* ── the prefill budget (the owner's "make prefill faster" ask) ────────────── */

describe('the declared tools block stays COMPACT — the prefill budget', () => {
  it('the <tools> block stays under 8,000 chars: full descriptions were 7,708 chars ≈ 2,200 tokens, ~85% of a 2,576-token prefill re-paid on EVERY tool round (measured live 2026-08-30). The pin moved 4,000 → 4,300 when iris-generate + mediaforge-remove-bg joined (2026-08-31), and 4,300 → 4,500 when draft-variants joined (2026-09-02, measured 4,450), and 4,500 -> 4,700 when search-preferences joined (2026-09-03, measured 4,646, +196: the title slot + two terse params is what a tool costs when the compact form is followed), and 4,700 -> 5,200 when render-video + video-status joined (2026-09-03, measured 5,122, +476 for two tools: four terse params on one, one on the other): and 5,200 -> 7,700 when the nine mediaforge-* studio tools joined (2026-09-03, measured 7,535, +2,413 for nine tools ≈ 268 each), and 7,700 -> 8,000 when demo-credits + gpu-burst joined (2026-09-03, measured 7,840, +305 for two tools), and 8,000 -> 8,300 when iris-produce joined (2026-09-03, measured 8,218, +378 for ONE tool: seven params — brief/width/height/style/refine/maxRefinements/minScore — is what a compound tool costs even in the compact form): each new tool costs ~300 chars ≈ 80 tokens of prefill, which is the price of the tool existing — the compact-form rule (short title in the description slot, terse param prose) is what keeps it to that', () => {
    const block = renderToolsSystemBlock(toolSpecsFromDefinitions());
    expect(block.length).toBeLessThan(8300);
  });

  it('enums survive the compaction — the model still picks valid values', () => {
    const gen = toolSpecsFromDefinitions().find((s) => s.name === 'generate-image');
    const props = gen?.parameters.properties as Record<string, unknown>;
    expect((props.style as { enum?: unknown[] }).enum).toEqual([
      'photographic', 'illustration', 'poster-art', 'neon',
    ]);
    expect((props.device as { enum?: unknown[] }).enum).toEqual(['auto', 'local', 'cloud']);
  });

  it('the description slot carries the short title, not the prose', () => {
    const gen = toolSpecsFromDefinitions().find((s) => s.name === 'generate-image');
    expect(gen?.description).toBe('Generate image');
  });
});

/* ── onToolResult — the transcript result rows (the owner's visibility ask) ── */

describe('runToolLoop onToolResult — every executed call reports its outcome', () => {
  it('fires with the executed tool response so the transcript can show it', async () => {
    const worker = fakeWorker([
      { text: '<tool_call>{"name": "create-design", "arguments": {}}</tool_call>' },
      { text: 'Created.' },
    ]);
    const seen: Array<{ name: string; response: string }> = [];
    await runToolLoop({
      worker,
      systemPrompt: 'sys',
      userMessage: 'make it',
      executor: recordingExecutor([]),
      onToolResult: (call, response) => void seen.push({ name: call.name, response }),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].name).toBe('create-design');
    expect(seen[0].response).toBe('executed create-design');
  });
});

/* ── the lone-CLOSING-tag malformation (the 4B's consistent shape, 2026-08-30) ── */

describe('parseToolCalls — a JSON body followed by a LONE closing tag', () => {
  it('recovers the 4B\'s exact shape: `{json} </tool_call>` with NO opening tag', () => {
    const { calls, rest } = parseToolCalls(
      '{"name": "create-design", "arguments": {"name": "Car Wash Poster", "size": "poster"}} </tool_call>',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('create-design');
    expect(calls[0].arguments).toEqual({ name: 'Car Wash Poster', size: 'poster' });
    expect(rest).toBe('');
  });

  it('leaves a malformed JSON with a lone closing tag visible (never fabricated)', () => {
    const { calls, rest } = parseToolCalls('{"name": } </tool_call>');
    expect(calls).toHaveLength(0);
    expect(rest).toContain('tool_call');
  });

  it('recovers a STUTTERED extra trailing brace before the lone closing tag (the live 2026-08-30 stop: "it stopped" on the third call)', () => {
    // The 4B emitted `...120}}}` — THREE closing braces — then ` </tool_call>`.
    // Pattern 3 matched, but the captured body failed every repair (no
    // trailing-brace strip existed), so the call stayed unparsed text and the
    // turn ended with the raw JSON as the final bubble.
    const { calls, rest } = parseToolCalls(
      '{"name": "add-text", "arguments": {"text": "Fast & Affordable Car Washes", "fontSize": 60, "bold": false, "align": "center", "x": 540, "y": 120}}} </tool_call>',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('add-text');
    expect(calls[0].arguments).toMatchObject({ text: 'Fast & Affordable Car Washes', x: 540, y: 120 });
    expect(rest).toBe('');
  });
});

/* ── the tagless bare-JSON shape (the 4B's mid-turn drift, 2026-08-30) ─────── */

describe('parseToolCalls — a bare {json} with NO tags (or followed by prose)', () => {
  it('recovers the exact shape that killed the turn: bare JSON, no tags, prose after', () => {
    const { calls, rest } = parseToolCalls(
      '{"name": "add-text", "arguments": {"text": "Fresh car washes every day!", "fontSize": 54}} Here is the summary of what I did.',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('add-text');
    expect(calls[0].arguments.text).toBe('Fresh car washes every day!');
    // The prose survives in the transcript.
    expect(rest).toContain('Here is the summary');
  });

  it('recovers bare JSON at end-of-text with no tags at all', () => {
    const { calls } = parseToolCalls('{"name":"generate-image","arguments":{"prompt":"hero shot"}}');
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('generate-image');
  });
});

/* ── the truncated-call continuation (the live 2026-08-30 "it stopped" shape) ── */

describe('isTruncatedToolCall — unbalanced JSON with a tool signature', () => {
  it('flags the live shape: generate-image cut mid-argument at "de', () => {
    expect(
      isTruncatedToolCall(
        '{"name": "generate-image", "arguments": {"prompt": "hero shot of a fresh car being washed", "style": "photographic", "size": "tall", "de',
      ),
    ).toBe(true);
  });

  it('flags an opening <tool_call> tag with no close', () => {
    expect(isTruncatedToolCall('<tool_call>{"name": "add-text", "arguments": {"text": "hel')).toBe(true);
  });

  it('ignores prose ending in an unbalanced brace (not a tool call)', () => {
    expect(isTruncatedToolCall('Sounds good, the design is set {so')).toBe(false);
    expect(isTruncatedToolCall('Here is your poster.')).toBe(false);
  });

  it('ignores a BALANCED call (closed — no continuation needed)', () => {
    expect(isTruncatedToolCall('<tool_call>{"name": "add-text", "arguments": {}}</tool_call>')).toBe(false);
  });
});

describe('runToolLoop — the truncated-call continuation round', () => {
  it('recovers a call cut mid-JSON with ONE continuation round, then executes it (the live 2026-08-30 stop)', async () => {
    const worker = fakeWorker([
      {
        text: '{"name": "generate-image", "arguments": {"prompt": "hero shot of a fresh car being washed", "style": "photographic", "size": "tall", "de',
      },
      {
        text: '<tool_call>{"name": "generate-image", "arguments": {"prompt": "hero shot of a fresh car being washed", "style": "photographic", "size": "tall"}}</tool_call>',
      },
      { text: 'Done — the image is in the design.' },
    ]);
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const result = await runToolLoop({
      worker,
      systemPrompt: 'sys',
      userMessage: 'poster for a car wash',
      executor: recordingExecutor(calls),
    });
    expect(calls).toEqual([
      { name: 'generate-image', args: expect.objectContaining({ style: 'photographic', size: 'tall' }) },
    ]);
    expect(result.rounds).toBe(3);
    expect(result.text).toContain('Done');
  });

  it('does NOT fire the continuation for prose ending in an unbalanced brace', async () => {
    const worker = fakeWorker([{ text: 'Sounds good, the design is set {so' }]);
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const result = await runToolLoop({
      worker,
      systemPrompt: 'sys',
      userMessage: 'hi',
      executor: recordingExecutor(calls),
    });
    expect(calls).toHaveLength(0);
    expect(result.rounds).toBe(1);
  });
});
