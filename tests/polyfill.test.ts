/**
 * Polyfill spec-conformance tests — the rejection cases from index.bs:
 * duplicate name, empty/bad-charset/too-long name, empty description,
 * non-serializable schema → InvalidStateError; getTools deep copy;
 * executeTool stringifies; abort unregisters and fires toolchange.
 */
import { describe, expect, it } from 'vitest';
import { ModelContextPolyfill } from '../src/webmcp/polyfill';
import type { ModelContextTool } from '../src/webmcp/types';

function makeTool(name = 'probe.tool', extra: Partial<ModelContextTool> = {}): ModelContextTool {
  return {
    name,
    description: 'A probe tool',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: [] },
    execute: async () => ({ content: [{ type: 'text', text: 'probe-ok' }] }),
    ...extra,
  };
}

async function expectInvalidState(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: 'InvalidStateError' });
}

describe('ModelContextPolyfill.registerTool', () => {
  it('registers a valid tool and lists it as a RegisteredTool', async () => {
    const mc = new ModelContextPolyfill();
    await mc.registerTool(makeTool());
    const tools = await mc.getTools();
    expect(tools).toHaveLength(1);
    const t = tools[0];
    expect(t.name).toBe('probe.tool');
    expect(t.description).toBe('A probe tool');
    expect(t.origin).toBe('http://localhost:3000');
    expect(typeof t.window).not.toBe('undefined');
    expect(t.inputSchema).toEqual({ type: 'object', properties: { q: { type: 'string' } }, required: [] });
    expect(t).not.toHaveProperty('execute'); // callbacks never leak out
  });

  it('getTools returns a deep copy — mutating the result does not affect the registry', async () => {
    const mc = new ModelContextPolyfill();
    await mc.registerTool(makeTool());
    const first = await mc.getTools();
    (first[0].inputSchema.properties as Record<string, unknown>).injected = true;
    first[0].description = 'mutated';
    const second = await mc.getTools();
    expect(second[0].description).toBe('A probe tool');
    expect(second[0].inputSchema.properties).not.toHaveProperty('injected');
  });

  it('rejects a duplicate name with InvalidStateError', async () => {
    const mc = new ModelContextPolyfill();
    await mc.registerTool(makeTool());
    await expectInvalidState(mc.registerTool(makeTool()));
  });

  it('rejects empty and missing names with InvalidStateError', async () => {
    const mc = new ModelContextPolyfill();
    await expectInvalidState(mc.registerTool(makeTool('')));
    await expectInvalidState(mc.registerTool({ name: '', description: 'x', inputSchema: {}, execute: async () => null }));
  });

  it('rejects names with disallowed characters (spaces, unicode) with InvalidStateError', async () => {
    const mc = new ModelContextPolyfill();
    await expectInvalidState(mc.registerTool(makeTool('bad name')));
    await expectInvalidState(mc.registerTool(makeTool('bad.name!?')));
    await expectInvalidState(mc.registerTool(makeTool('名前')));
  });

  it('rejects names longer than 128 chars with InvalidStateError', async () => {
    const mc = new ModelContextPolyfill();
    await expectInvalidState(mc.registerTool(makeTool('a'.repeat(129))));
  });

  it('rejects an empty description with InvalidStateError', async () => {
    const mc = new ModelContextPolyfill();
    await expectInvalidState(mc.registerTool(makeTool('probe.tool', { description: '   ' })));
  });

  it('rejects a non-serializable inputSchema with InvalidStateError', async () => {
    const mc = new ModelContextPolyfill();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expectInvalidState(mc.registerTool(makeTool('probe.tool', { inputSchema: circular })));
  });

  it('rejects a missing execute callback with InvalidStateError', async () => {
    const mc = new ModelContextPolyfill();
    const { execute: _execute, ...rest } = makeTool();
    await expectInvalidState(mc.registerTool(rest));
  });
});

describe('ModelContextPolyfill.executeTool', () => {
  it('executes the tool and JSON-stringifies the result', async () => {
    const mc = new ModelContextPolyfill();
    await mc.registerTool(makeTool());
    const out = await mc.executeTool('probe.tool', {});
    expect(typeof out).toBe('string');
    expect(JSON.parse(out)).toEqual({ content: [{ type: 'text', text: 'probe-ok' }] });
  });

  it('passes the input object through to execute', async () => {
    const mc = new ModelContextPolyfill();
    let seen: Record<string, unknown> | null = null;
    await mc.registerTool(
      makeTool('echo.tool', {
        execute: async (input) => {
          seen = input;
          return input;
        },
      }),
    );
    await mc.executeTool('echo.tool', { q: 'hello' });
    expect(seen).toEqual({ q: 'hello' });
  });

  it('rejects with NotFoundError for an unregistered tool', async () => {
    const mc = new ModelContextPolyfill();
    await expect(mc.executeTool('nope.tool', {})).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('accepts a RegisteredTool object in place of a name', async () => {
    const mc = new ModelContextPolyfill();
    await mc.registerTool(makeTool());
    const [registered] = await mc.getTools();
    const out = await mc.executeTool(registered, {});
    expect(JSON.parse(out).content[0].text).toBe('probe-ok');
  });
});

describe('ModelContextPolyfill unregistration', () => {
  it('aborting the registration signal unregisters the tool and fires toolchange', async () => {
    const mc = new ModelContextPolyfill();
    let changes = 0;
    mc.addEventListener('toolchange', () => {
      changes += 1;
    });

    const controller = new AbortController();
    await mc.registerTool(makeTool('life.tool'), { signal: controller.signal });
    expect(changes).toBe(1); // register fires toolchange
    expect((await mc.getTools()).map((t) => t.name)).toContain('life.tool');

    controller.abort();
    expect(changes).toBe(2); // unregister fires toolchange
    expect((await mc.getTools()).map((t) => t.name)).not.toContain('life.tool');
  });

  it('an already-aborted signal never registers the tool', async () => {
    const mc = new ModelContextPolyfill();
    const controller = new AbortController();
    controller.abort();
    await mc.registerTool(makeTool('dead.tool'), { signal: controller.signal });
    expect((await mc.getTools()).map((t) => t.name)).not.toContain('dead.tool');
  });

  it('toolchange fires once per register and once per unregister', async () => {
    const mc = new ModelContextPolyfill();
    let changes = 0;
    mc.addEventListener('toolchange', () => {
      changes += 1;
    });
    // One signal per tool — aborting one must not touch the other.
    const a = new AbortController();
    const b = new AbortController();
    await mc.registerTool(makeTool('a.tool'), { signal: a.signal });
    await mc.registerTool(makeTool('b.tool'), { signal: b.signal });
    a.abort();
    expect(changes).toBe(3); // 2 registers + 1 unregister
    expect((await mc.getTools()).map((t) => t.name)).toEqual(['b.tool']);
  });

  it('re-registering after abort succeeds', async () => {
    const mc = new ModelContextPolyfill();
    const controller = new AbortController();
    await mc.registerTool(makeTool('again.tool'), { signal: controller.signal });
    controller.abort();
    await mc.registerTool(makeTool('again.tool'));
    expect((await mc.getTools()).map((t) => t.name)).toContain('again.tool');
  });
});
