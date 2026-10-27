import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { Connect, Plugin } from 'vite';
import { parseCollectionHtml } from '../src/lib/parseCollection.ts';
import { isValidSlug, parseModuleHtml } from '../src/lib/parseModule.ts';
import { parseRackHtml } from '../src/lib/parseRack.ts';

const USER_AGENT = 'rack-canvas/0.1 (personal tool; single-user, on-demand imports)';
const MIN_GAP_MS = 1000;
const CACHE_DIR = '.cache/modulargrid/modules';

let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();

/** Upstream requests run one at a time, at least MIN_GAP_MS apart. */
function fetchPage(path: string): Promise<Response> {
  const run = async () => {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fetch(`https://modulargrid.net${path}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      });
    } finally {
      lastRequestAt = Date.now();
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function fetchHtml(path: string): Promise<string> {
  const upstream = await fetchPage(path);
  if (!upstream.ok) {
    throw new HttpError(upstream.status === 404 ? 404 : 502, `ModularGrid responded with ${upstream.status}.`);
  }
  return upstream.text();
}

/** Module specs rarely change, so each module page is fetched once and kept on disk. */
async function loadModule(slug: string) {
  const file = `${CACHE_DIR}/${slug}.json`;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    // not cached yet
  }
  const module = parseModuleHtml(await fetchHtml(`/e/${slug}`), slug);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(module));
  return module;
}

/**
 * ModularGrid doesn't send CORS headers, so the browser can't read its pages
 * directly. This middleware fetches and parses them server-side:
 *   GET /api/rack/:id           -> ImportedRack JSON
 *   GET /api/collection/:userId -> CollectionEntry[] from a public profile
 *   GET /api/module/:slug       -> CollectionModule (specs from the module page)
 */
const handler: Connect.NextHandleFunction = async (req, res, next) => {
  const match = req.url?.match(/^\/api\/(rack|collection|module)\/([^/?#]+)\/?$/);
  if (!match) return next();
  const [, kind, param] = match;

  const send = (status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };

  try {
    if (kind === 'rack' && /^\d+$/.test(param)) {
      return send(200, parseRackHtml(await fetchHtml(`/e/racks/view/${param}`)));
    }
    if (kind === 'collection' && /^\d+$/.test(param)) {
      return send(200, parseCollectionHtml(await fetchHtml(`/s/users/view/${param}`)));
    }
    if (kind === 'module' && isValidSlug(param)) {
      return send(200, await loadModule(param));
    }
    send(400, { error: `Invalid ${kind} identifier.` });
  } catch (err) {
    send(err instanceof HttpError ? err.status : 502, { error: err instanceof Error ? err.message : String(err) });
  }
};

export function modulargridApi(): Plugin {
  return {
    name: 'modulargrid-api',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
