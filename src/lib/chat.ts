export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  /** Set on assistant messages that failed; these aren't sent back to the model. */
  error?: boolean;
}

const STORAGE_KEY = 'rack-canvas:chat:v1';

export function loadChat(): ChatMessage[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveChat(messages: ChatMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // Storage full or unavailable.
  }
}

/** Sends the conversation plus a layout summary to /api/chat and calls onDelta as text streams in. */
export async function streamChat(opts: {
  messages: ChatMessage[];
  layout: string;
  onDelta: (text: string) => void;
  signal: AbortSignal;
}): Promise<{ truncated: boolean }> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      layout: opts.layout,
      messages: opts.messages.filter((m) => !m.error && m.content).map(({ role, content }) => ({ role, content })),
    }),
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let truncated = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === 'delta') opts.onDelta(event.text);
      else if (event.type === 'truncated') truncated = true;
      else if (event.type === 'error') throw new Error(event.message);
    }
  }
  return { truncated };
}
