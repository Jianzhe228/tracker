/**
 * Tests for client.ts — OpenAI-compatible chat completion client.
 *
 * Tests the exported `callChatCompletion` function and indirectly covers
 * the internal helpers `ensureChatCompletionEndpoint` and `extractJsonObject`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { callChatCompletion, type ChatMessage } from '../client';

/* ---------- helpers ---------- */

function jsonResponse(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    {
      status,
      statusText: status === 200 ? 'OK' : 'Bad Request',
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

function errorResponse(status: number, statusText: string): Response {
  return new Response('error', { status, statusText });
}

const MESSAGES: ChatMessage[] = [{ role: 'user', content: 'hello' }];

/* ---------- setup / teardown ---------- */

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* ---------- tests ---------- */

describe('callChatCompletion', () => {
  describe('endpoint normalization (ensureChatCompletionEndpoint)', () => {
    it('appends /chat/completions to a bare endpoint', async () => {
      fetchSpy.mockResolvedValue(jsonResponse('{"ok":true}'));

      await callChatCompletion('https://api.example.com/v1', 'key', 'model', MESSAGES);

      const calledUrl = fetchSpy.mock.calls[0][0];
      expect(calledUrl).toBe('https://api.example.com/v1/chat/completions');
    });

    it('does not double-append when endpoint already ends with /chat/completions', async () => {
      fetchSpy.mockResolvedValue(jsonResponse('{"ok":true}'));

      await callChatCompletion(
        'https://api.example.com/v1/chat/completions',
        'key',
        'model',
        MESSAGES,
      );

      const calledUrl = fetchSpy.mock.calls[0][0];
      expect(calledUrl).toBe('https://api.example.com/v1/chat/completions');
    });

    it('does not double-append when endpoint ends with /chat/completions/', async () => {
      fetchSpy.mockResolvedValue(jsonResponse('{"ok":true}'));

      await callChatCompletion(
        'https://api.example.com/v1/chat/completions/',
        'key',
        'model',
        MESSAGES,
      );

      const calledUrl = fetchSpy.mock.calls[0][0];
      expect(calledUrl).toBe('https://api.example.com/v1/chat/completions/');
    });

    it('strips trailing slashes before appending', async () => {
      fetchSpy.mockResolvedValue(jsonResponse('{"ok":true}'));

      await callChatCompletion('https://api.example.com/v1///', 'key', 'model', MESSAGES);

      const calledUrl = fetchSpy.mock.calls[0][0];
      expect(calledUrl).toBe('https://api.example.com/v1/chat/completions');
    });
  });

  describe('request construction', () => {
    it('sends correct headers with Bearer token', async () => {
      fetchSpy.mockResolvedValue(jsonResponse('{"ok":true}'));

      await callChatCompletion('https://api.example.com', 'my-secret-key', 'gpt-4', MESSAGES);

      const fetchOpts = fetchSpy.mock.calls[0][1] as RequestInit;
      expect(fetchOpts.method).toBe('POST');
      expect((fetchOpts.headers as Record<string, string>)['Content-Type']).toBe(
        'application/json',
      );
      expect((fetchOpts.headers as Record<string, string>)['Authorization']).toBe(
        'Bearer my-secret-key',
      );
    });

    it('includes model, temperature, and messages in body', async () => {
      fetchSpy.mockResolvedValue(jsonResponse('{"ok":true}'));

      const messages: ChatMessage[] = [
        { role: 'system', content: 'you are helpful' },
        { role: 'user', content: 'hi' },
      ];
      await callChatCompletion('https://api.example.com', 'key', 'gpt-4', messages);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
      expect(body.model).toBe('gpt-4');
      expect(body.temperature).toBe(0.2);
      expect(body.messages).toEqual(messages);
    });
  });

  describe('response parsing', () => {
    it('parses clean JSON response', async () => {
      fetchSpy.mockResolvedValue(jsonResponse('{"subtasks":["a","b"]}'));

      const result = await callChatCompletion('https://api.example.com', 'key', 'model', MESSAGES);

      expect(result).toEqual({ subtasks: ['a', 'b'] });
    });

    it('parses JSON with leading/trailing whitespace', async () => {
      fetchSpy.mockResolvedValue(jsonResponse('  \n  {"result": 42}  \n  '));

      const result = await callChatCompletion('https://api.example.com', 'key', 'model', MESSAGES);

      expect(result).toEqual({ result: 42 });
    });

    it('extracts JSON from markdown-wrapped response', async () => {
      const wrappedContent = 'Here is the JSON:\n```json\n{"items":["x"]}\n```\nDone.';
      fetchSpy.mockResolvedValue(jsonResponse(wrappedContent));

      const result = await callChatCompletion('https://api.example.com', 'key', 'model', MESSAGES);

      expect(result).toEqual({ items: ['x'] });
    });

    it('extracts JSON when surrounded by arbitrary text', async () => {
      const content = 'Sure! {"action":"create","name":"test"} Hope that helps!';
      fetchSpy.mockResolvedValue(jsonResponse(content));

      const result = await callChatCompletion('https://api.example.com', 'key', 'model', MESSAGES);

      expect(result).toEqual({ action: 'create', name: 'test' });
    });

    it('extracts outermost JSON object when multiple braces present', async () => {
      const content = 'Result: {"outer": {"inner": 1}} end';
      fetchSpy.mockResolvedValue(jsonResponse(content));

      const result = await callChatCompletion('https://api.example.com', 'key', 'model', MESSAGES);

      expect(result).toEqual({ outer: { inner: 1 } });
    });
  });

  describe('error handling', () => {
    it('throws on HTTP error status', async () => {
      fetchSpy.mockResolvedValue(errorResponse(500, 'Internal Server Error'));

      await expect(
        callChatCompletion('https://api.example.com', 'key', 'model', MESSAGES),
      ).rejects.toThrow('API request failed: 500 Internal Server Error');
    });

    it('throws on 401 Unauthorized', async () => {
      fetchSpy.mockResolvedValue(errorResponse(401, 'Unauthorized'));

      await expect(
        callChatCompletion('https://api.example.com', 'key', 'model', MESSAGES),
      ).rejects.toThrow('API request failed: 401 Unauthorized');
    });

    it('throws on empty response content', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(''));

      await expect(
        callChatCompletion('https://api.example.com', 'key', 'model', MESSAGES),
      ).rejects.toThrow('Empty response from AI');
    });

    it('throws on whitespace-only response content', async () => {
      fetchSpy.mockResolvedValue(jsonResponse('   \n\t  '));

      await expect(
        callChatCompletion('https://api.example.com', 'key', 'model', MESSAGES),
      ).rejects.toThrow('Empty response from AI');
    });

    it('throws when response has no choices', async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await expect(
        callChatCompletion('https://api.example.com', 'key', 'model', MESSAGES),
      ).rejects.toThrow('Empty response from AI');
    });

    it('throws when response is not JSON and contains no JSON object', async () => {
      fetchSpy.mockResolvedValue(jsonResponse('This is plain text with no braces'));

      await expect(
        callChatCompletion('https://api.example.com', 'key', 'model', MESSAGES),
      ).rejects.toThrow('Failed to parse JSON from AI response');
    });

    it('throws when response has only opening brace', async () => {
      fetchSpy.mockResolvedValue(jsonResponse('{ incomplete'));

      await expect(
        callChatCompletion('https://api.example.com', 'key', 'model', MESSAGES),
      ).rejects.toThrow('Failed to parse JSON from AI response');
    });

    it('throws on network error', async () => {
      fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(
        callChatCompletion('https://api.example.com', 'key', 'model', MESSAGES),
      ).rejects.toThrow('Failed to fetch');
    });
  });
});
