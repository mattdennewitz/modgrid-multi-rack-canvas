import type { IncomingMessage } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { streamCompletion, type ChatTurn } from './openrouter.ts';

const MAX_TURNS = 40;

const SYSTEM_PROMPT = `You help a Eurorack musician plan the physical layout of their modules across several cases.

You can see their current layout (below), but in this version you cannot change it. Give advice, and when you
suggest moves, write each one as "Move <module> → case "<name>", row <n>, HP <start>–<end>" so the user can
carry it out by hand. Check every suggested move against the empty gaps listed in the layout; a module only fits
in a gap at least as wide as its HP, unless you also say what to move out of the way first.

Rules:
- Never suggest moving a module marked [LOCKED]. Plan around locked modules. If the user's goal conflicts with a
  lock, say so and ask whether they want to unlock it.
- Only 3U modules can go in rows. 1U modules can't be placed yet.
- Stick to modules in the layout and tray. If you recommend buying something, label it clearly as a suggestion.

Ergonomic considerations to weigh (the user's own hints always take priority):
- Signal flow: sources → modulation/processing → mixing → output, usually left to right, so cables stay short.
- Keep modules that are patched together often (a voice's oscillator, filter, VCA, envelope) next to each other.
- Put performance controls (sequencers, mixers, things they tweak while playing) where their hands naturally rest.
- Keep utilities (mults, attenuators, logic) close to where they are used.
- Avoid placing knob-heavy modules where cables from neighbours will block access.
- Put output and interface modules (audio out, MIDI, Eurorack-to-line) at an easy-to-reach edge.
- Spread power draw sensibly across cases, and watch module depth in shallow cases.

Keep answers concise and specific. Refer to modules by name and positions by case, row and HP.`;

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

interface ChatRequest {
  messages: { role: 'user' | 'assistant'; content: string }[];
  layout: string;
}

function isChatRequest(v: unknown): v is ChatRequest {
  const r = v as ChatRequest;
  return (
    !!r &&
    typeof r.layout === 'string' &&
    Array.isArray(r.messages) &&
    r.messages.every((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
  );
}

/**
 * POST /api/chat { messages, layout } -> newline-delimited JSON events:
 *   {"type":"delta","text":"..."} ... [{"type":"truncated"}] {"type":"done"} | {"type":"error","message":"..."}
 * The API key stays on the server.
 */
export function chatApi(opts: { apiKey?: string; model: string; maxTokens: number; reasoningEffort: string }): Plugin {
  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    if (req.url !== '/api/chat' || req.method !== 'POST') return next();

    const fail = (status: number, message: string) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: message }));
    };
    if (!opts.apiKey) return fail(500, 'OPENROUTER_API_KEY is not set in .env');

    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      return fail(400, 'Invalid JSON body');
    }
    if (!isChatRequest(body)) return fail(400, 'Expected { messages, layout }');

    const turns: ChatTurn[] = [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\n${body.layout}` },
      ...body.messages.slice(-MAX_TURNS),
    ];

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    const send = (event: object) => res.write(`${JSON.stringify(event)}\n`);

    try {
      for await (const event of streamCompletion({
        apiKey: opts.apiKey,
        model: opts.model,
        maxTokens: opts.maxTokens,
        reasoningEffort: opts.reasoningEffort,
        messages: turns,
        signal: controller.signal,
      })) {
        if (event.text) send({ type: 'delta', text: event.text });
        if (event.finish === 'length') send({ type: 'truncated' });
      }
      send({ type: 'done' });
    } catch (err) {
      if (!controller.signal.aborted) send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    res.end();
  };

  return {
    name: 'chat-api',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
