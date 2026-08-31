/**
 * The BYOK custom agent lane (WebMCP Challenge 2026-08-30) — a visitor's own
 * OpenAI-compatible endpoint drives the studio's tool loop. Pins:
 * 1. chatCompletionsUrl normalization (host / host/v1 / full URL).
 * 2. The worker streams SSE deltas → token events, then done with the full
 *    text, with the Bearer key on the wire.
 * 3. tool-role messages are translated to user + <tool_response> (the XML
 *    convention every lane speaks).
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  chatCompletionsUrl,
  createOpenAICompatibleWorker,
} from '../src/agent/hostedChat';
import type { WorkerRequest } from '../src/agent/loader';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chatCompletionsUrl — user-supplied base normalization', () => {
  it('accepts a bare host, /v1, and a full /chat/completions URL', () => {
    expect(chatCompletionsUrl('https://api.openai.com')).toBe('https://api.openai.com/v1/chat/completions');
    expect(chatCompletionsUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/chat/completions');
    expect(chatCompletionsUrl('http://localhost:8000/v1/chat/completions')).toBe(
      'http://localhost:8000/v1/chat/completions',
    );
    expect(chatCompletionsUrl('   https://host.example  ')).toBe('https://host.example/v1/chat/completions');
  });

  it('rejects an empty base — the lane fails loudly, never silently', () => {
    expect(chatCompletionsUrl('')).toBe('');
    expect(chatCompletionsUrl('   ')).toBe('');
  });
});

describe('createOpenAICompatibleWorker — the BYOK lane', () => {
  it('streams SSE deltas to token events and finishes with the full text', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    let captured: { url: string; init: RequestInit } | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        captured = { url, init: init ?? {} };
        // Explicit ReadableStream — a Blob-backed body does not stream under
        // the jsdom test environment (measured: the reader yielded nothing).
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(sse));
              controller.close();
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        );
      }),
    );

    const worker = createOpenAICompatibleWorker({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test',
    });
    const tokens: string[] = [];
    const done = new Promise<string>((resolve) => {
      worker.on((msg) => {
        if (msg.type === 'token') tokens.push(msg.text);
        else if (msg.type === 'done') resolve(msg.text);
      });
    });
    const req: WorkerRequest = {
      type: 'generate',
      messages: [{ role: 'user', content: 'make a flyer' }],
      maxTokens: 512,
      temperature: 0.7,
    };
    worker.post(req);

    const full = await done;
    expect(full).toBe('Hello world');
    expect(tokens).toEqual(['Hello ', 'world']);
    expect(captured?.url).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(String(captured?.init?.body)) as {
      model: string;
      stream: boolean;
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.stream).toBe(true);
    // Headroom — the loop's 512-token default was eaten by reasoning (2026-08-28).
    expect(body.max_tokens).toBeGreaterThanOrEqual(2048);
    const headers = captured?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
  });

  it('translates tool-role messages to user + <tool_response> (the XML convention)', async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n';
    let sentBody: { messages: Array<{ role: string; content: string }> } | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        sentBody = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(sse));
              controller.close();
            },
          }),
          { status: 200 },
        );
      }),
    );

    const worker = createOpenAICompatibleWorker({ baseUrl: 'http://localhost:8000/v1', model: 'm' });
    const done = new Promise<string>((resolve) => {
      worker.on((msg) => {
        if (msg.type === 'done') resolve(msg.text);
      });
    });
    worker.post({
      type: 'generate',
      messages: [
        { role: 'assistant', content: '<tool_call>{"name":"create-design","arguments":{}}</tool_call>' },
        { role: 'tool', content: '{"design":{"id":"doc_1"}}' },
      ],
      maxTokens: 512,
      temperature: 0.7,
    });
    await done;
    const toolMsg = sentBody!.messages.find((m) => m.content.includes('tool_response'));
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.role).toBe('user');
    expect(toolMsg!.content).toContain('<tool_response>');
    expect(toolMsg!.content).toContain('doc_1');
  });

  it('emits a LOUD error on a non-ok response (never a silent empty)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('no such model', { status: 404 })),
    );
    const worker = createOpenAICompatibleWorker({ baseUrl: 'https://api.example.com/v1', model: 'm' });
    const error = new Promise<string>((resolve) => {
      worker.on((msg) => {
        if (msg.type === 'error') resolve(msg.message);
      });
    });
    worker.post({
      type: 'generate',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 512,
      temperature: 0.7,
    });
    expect(await error).toContain('404');
  });
});
