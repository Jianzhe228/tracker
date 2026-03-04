/**
 * OpenAI-compatible chat completion client.
 * Extracted from taskAssistant.ts for reuse across AI skills.
 */

const DEFAULT_TIMEOUT = 15_000;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function ensureChatCompletionEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) return trimmed;
  if (/\/chat\/completions\/?$/.test(trimmed)) return trimmed;
  return `${trimmed.replace(/\/+$/, '')}/chat/completions`;
}

function extractJsonObject(text: string): string | null {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  return text.slice(firstBrace, lastBrace + 1);
}

export async function callChatCompletion(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  timeout: number = DEFAULT_TIMEOUT,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeout);

  try {
    const url = ensureChatCompletionEndpoint(endpoint);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const body = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = body.choices?.[0]?.message?.content ?? '';
    const trimmed = content.trim();
    if (!trimmed) throw new Error('Empty response from AI');

    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      const jsonText = extractJsonObject(trimmed);
      if (!jsonText) throw new Error('Failed to parse JSON from AI response');
      return JSON.parse(jsonText) as Record<string, unknown>;
    }
  } finally {
    window.clearTimeout(timeoutId);
  }
}
