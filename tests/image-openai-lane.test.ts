/**
 * The bring-your-own-key image lane: an OpenAI-compatible /images/generations
 * request with a Bearer key, sizes chosen per model, and the `data[].b64_json`
 * / `data[].url` response shapes normalized to a data URL.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openAiSizeFor, syncGenerateImage } from '../src/cloud/imageProviders';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

afterEach(() => vi.unstubAllGlobals());

describe('openAiSizeFor', () => {
  it('picks the API sizes by aspect and model family', () => {
    expect(openAiSizeFor(1024, 1024, 'gpt-image-1')).toBe('1024x1024');
    expect(openAiSizeFor(768, 1280, 'gpt-image-1')).toBe('1024x1536');
    expect(openAiSizeFor(1280, 768, 'gpt-image-1')).toBe('1536x1024');
    expect(openAiSizeFor(768, 1280, 'dall-e-3')).toBe('1024x1792');
  });
});

describe('syncGenerateImage (openai flavor)', () => {
  it('posts to /images/generations with a Bearer key and normalizes b64_json', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const out = await syncGenerateImage(
      'https://api.openai.com/v1',
      { prompt: 'a teal circle', width: 768, height: 1280 },
      { apiKey: 'sk-test', flavor: 'openai', model: 'gpt-image-1' },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.openai.com/v1/images/generations');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test');
    expect(headers['x-api-key']).toBeUndefined();
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ model: 'gpt-image-1', prompt: 'a teal circle', n: 1, size: '1024x1536' });
    expect(body.response_format).toBeUndefined(); // gpt-image rejects it
    expect(out.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('asks dall-e for b64_json explicitly', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }), { status: 200 });
    });
    await syncGenerateImage('https://api.openai.com/v1', { prompt: 'x', width: 1024, height: 1024 },
      { apiKey: 'k', flavor: 'openai', model: 'dall-e-3' });
    expect(body.response_format).toBe('b64_json');
    expect(body.size).toBe('1024x1024');
  });

  it('keeps the aither contract untouched by default', async () => {
    let url = '';
    let headers: Record<string, string> = {};
    vi.stubGlobal('fetch', async (u: string, init: RequestInit) => {
      url = u;
      headers = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ images: [PNG_B64] }), { status: 200 });
    });
    await syncGenerateImage('http://host/api/image', { prompt: 'x', width: 512, height: 512 }, { apiKey: 'k' });
    expect(url).toBe('http://host/api/image/generate');
    expect(headers['x-api-key']).toBe('k');
    expect(headers.authorization).toBeUndefined();
  });
});
