export const DEFAULT_MODEL = 'openai/gpt-6-luna';
/**
 * Reasoning tokens count against max_tokens. Without an effort level, Sonnet can spend a whole
 * 4k budget thinking and return no visible text, so the cap leaves room for both.
 */
export const DEFAULT_MAX_TOKENS = 16000;
export const DEFAULT_REASONING_EFFORT = 'medium';

export type StreamEvent = { text: string; finish: string | null };

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Incrementally splits a server-sent-events stream into `data:` payloads. */
export function createSseParser() {
  let buffer = '';
  return (chunk: string): string[] => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    return lines.filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
  };
}

/** Pulls the visible text and finish reason out of one parsed stream payload. */
export function readStreamEvent(event: {
  error?: { message?: string };
  choices?: { delta?: { content?: string | null; reasoning?: string | null }; finish_reason?: string | null }[];
}): StreamEvent {
  if (event.error) throw new Error(event.error.message ?? 'OpenRouter stream error');
  const choice = event.choices?.[0];
  return { text: choice?.delta?.content ?? '', finish: choice?.finish_reason ?? null };
}

/** Streams the assistant's text (and finally its finish reason) from OpenRouter's chat endpoint. */
export async function* streamCompletion(opts: {
  apiKey: string;
  model: string;
  maxTokens: number;
  reasoningEffort: string;
  messages: ChatTurn[];
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: opts.signal,
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'Rack Canvas',
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      max_tokens: opts.maxTokens,
      reasoning: { effort: opts.reasoningEffort },
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    let message = text;
    try {
      message = JSON.parse(text).error?.message ?? text;
    } catch {
      // not JSON
    }
    throw new Error(`OpenRouter ${res.status}: ${message || res.statusText}`);
  }

  const parse = createSseParser();
  const decoder = new TextDecoder();
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    for (const payload of parse(decoder.decode(chunk, { stream: true }))) {
      if (payload === '[DONE]') return;
      const event = readStreamEvent(JSON.parse(payload));
      if (event.text || event.finish) yield event;
    }
  }
}
