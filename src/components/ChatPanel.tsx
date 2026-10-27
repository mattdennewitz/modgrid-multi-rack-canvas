import { useEffect, useRef, useState } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { loadChat, saveChat, streamChat, type ChatMessage } from '../lib/chat';
import { summarizeLayout } from '../lib/layoutSummary';
import type { AppState } from '../lib/types';

const STARTERS = [
  'What would you change about this layout for patching ergonomics?',
  'Which modules are badly placed relative to what they usually patch into?',
  'Where should the selected module go, and why?',
];

const markdown: Components = {
  p: (props) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,
  ul: (props) => <ul className="my-2 list-disc space-y-1 pl-5" {...props} />,
  ol: (props) => <ol className="my-2 list-decimal space-y-1 pl-5" {...props} />,
  h1: (props) => <h3 className="mt-3 mb-1 font-semibold text-neutral-100" {...props} />,
  h2: (props) => <h3 className="mt-3 mb-1 font-semibold text-neutral-100" {...props} />,
  h3: (props) => <h3 className="mt-3 mb-1 font-semibold text-neutral-100" {...props} />,
  strong: (props) => <strong className="font-semibold text-neutral-100" {...props} />,
  code: (props) => <code className="rounded bg-neutral-800 px-1 text-[0.85em]" {...props} />,
  a: (props) => <a className="text-sky-400 underline" target="_blank" rel="noreferrer" {...props} />,
  table: (props) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs" {...props} />
    </div>
  ),
  th: (props) => <th className="border border-neutral-700 px-2 py-1 text-left font-semibold" {...props} />,
  td: (props) => <td className="border border-neutral-700 px-2 py-1 align-top" {...props} />,
};

interface Props {
  state: AppState;
  selectedId: string | null;
  onClose: () => void;
}

export function ChatPanel({ state, selectedId, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(loadChat);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Save once a reply has finished rather than on every streamed token.
  useEffect(() => {
    if (!streaming) saveChat(messages);
  }, [messages, streaming]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || streaming) return;
    const user: ChatMessage = { id: crypto.randomUUID(), role: 'user', content, createdAt: Date.now() };
    const reply: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '', createdAt: Date.now() };
    const history = [...messages, user];
    setMessages([...history, reply]);
    setInput('');
    setStreaming(true);

    const update = (patch: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>)) =>
      setMessages((ms) =>
        ms.map((m) => (m.id === reply.id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m)),
      );

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { truncated } = await streamChat({
        messages: history,
        // Summarized at send time so the model sees the layout as it is now.
        layout: summarizeLayout(state, selectedId),
        signal: controller.signal,
        onDelta: (delta) => update((m) => ({ content: m.content + delta })),
      });
      if (truncated) {
        update((m) => ({
          content: `${m.content}\n\n*(Reply cut off at the length limit. Raise OPENROUTER_MAX_TOKENS or ask for a shorter answer.)*`,
        }));
      }
    } catch (err) {
      if (controller.signal.aborted) {
        update((m) => ({ content: m.content ? `${m.content}\n\n*(stopped)*` : '*(stopped)*' }));
      } else {
        update((m) => ({ error: true, content: `${m.content}\n\n${err instanceof Error ? err.message : err}`.trim() }));
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  };

  return (
    <aside className="flex h-full w-96 shrink-0 flex-col border-l border-neutral-800 bg-neutral-900/60">
      <header className="flex items-center gap-2 border-b border-neutral-800 px-4 py-3">
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-neutral-100">Layout advisor</h2>
          <p className="text-xs text-neutral-500">Sees your current layout and locks. Advice only.</p>
        </div>
        <button
          className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 disabled:opacity-40"
          disabled={streaming || messages.length === 0}
          onClick={() => confirm('Clear the chat history?') && setMessages([])}
        >
          Clear
        </button>
        <button className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800" onClick={onClose}>
          Close
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-neutral-500">
              Describe how you play and where the cases sit, e.g. "right-handed, the 252HP case is on the desk and the
              7U sits behind it".
            </p>
            {STARTERS.map((s) => (
              <button
                key={s}
                className="block w-full rounded border border-neutral-800 px-3 py-2 text-left text-xs text-neutral-300 hover:border-neutral-600 hover:bg-neutral-800"
                onClick={() => send(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="ml-8 rounded-lg bg-sky-900/50 px-3 py-2 whitespace-pre-wrap text-neutral-100">
              {m.content}
            </div>
          ) : (
            <div
              key={m.id}
              className={`mr-2 leading-relaxed ${m.error ? 'rounded-lg bg-red-950/60 px-3 py-2 text-red-300' : 'text-neutral-300'}`}
            >
              {m.content ? (
                <Markdown remarkPlugins={[remarkGfm]} components={markdown}>
                  {m.content}
                </Markdown>
              ) : (
                <span className="animate-pulse text-neutral-500">Thinking…</span>
              )}
            </div>
          ),
        )}
      </div>

      <form
        className="border-t border-neutral-800 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          className="h-20 w-full resize-none rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-sky-500 focus:outline-none"
          placeholder="Ask about your layout… (Enter to send, Shift+Enter for a new line)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        <div className="mt-2 flex justify-end">
          {streaming ? (
            <button
              type="button"
              className="rounded bg-neutral-700 px-3 py-1 text-sm text-neutral-100 hover:bg-neutral-600"
              onClick={() => abortRef.current?.abort()}
            >
              Stop
            </button>
          ) : (
            <button
              className="rounded bg-sky-600 px-3 py-1 text-sm text-white hover:bg-sky-500 disabled:opacity-50"
              disabled={!input.trim()}
            >
              Send
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}
