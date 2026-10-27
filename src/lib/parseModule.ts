import type { CollectionModule } from './types.ts';

/** Slugs come from user input, so keep them to what ModularGrid actually uses. */
export const isValidSlug = (slug: string) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug);

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

const int = (value: string | undefined): number => {
  const n = parseInt(value ?? '', 10);
  return Number.isNaN(n) ? 0 : n;
};

/** Reads the specs ModularGrid shows on a module page (HP, depth, current draw). */
export function parseModuleHtml(html: string, slug: string): CollectionModule {
  const moduleId = html.match(/data-module-id="(\d+)"/)?.[1] ?? html.match(/MG ID:(?:&nbsp;|\s)*(\d+)/)?.[1];
  const name = html.match(/<h1>([\s\S]*?)<\/h1>/)?.[1];
  const hp = int(html.match(/<dd>\s*(\d+)\s*HP\s*<\/dd>/)?.[1]);
  if (!moduleId || !name || !hp) throw new Error(`Couldn't read module specs for "${slug}".`);

  const draw = (unit: string) => int(html.match(new RegExp(`<dd>\\s*(\\d+)\\s*mA\\s*${unit}\\s*</dd>`))?.[1]);
  return {
    moduleId,
    versionId: null,
    name: decode(name),
    vendor: decode(html.match(/<span class="vendor-name">([^<]*)/)?.[1] ?? ''),
    description: decode(html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? ''),
    slug,
    hp,
    depth: int(html.match(/<dd>\s*(\d+)(?:&nbsp;|\s)*mm(?:&nbsp;|\s)*deep\s*<\/dd>/)?.[1]),
    is1u: /Module is a 1U tile/i.test(html),
    power: { plus12: draw('\\+12V'), minus12: draw('-12V'), plus5: draw('5V') },
  };
}
