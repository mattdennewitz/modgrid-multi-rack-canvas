import type { CollectionEntry } from './types.ts';

/** Accepts a ModularGrid user URL (e.g. https://modulargrid.net/s/users/view/254121) or a bare id. */
export function extractUserId(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/users\/view\/(\d+)/);
  return match ? match[1] : null;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

/**
 * A public profile page lists the collection as comma-separated links inside the
 * "Collection" card: <h3>Collection <small>66</small></h3><div class="mad-list">…</div>.
 */
export function parseCollectionHtml(html: string): CollectionEntry[] {
  const heading = html.search(/<h3>\s*Collection\s*<small>/);
  if (heading === -1) throw new Error('No collection found on the page. Is the profile private or the URL wrong?');
  const start = html.indexOf('<div class="mad-list">', heading);
  const end = start === -1 ? -1 : html.indexOf('</div>', start);
  if (end === -1) throw new Error('Collection list had an unexpected shape.');

  const entries: CollectionEntry[] = [];
  for (const m of html.slice(start, end).matchAll(/<a href="\/e\/([^"/?#]+)">(.*?)<\/a>/g)) {
    entries.push({ slug: m[1], name: decode(m[2]) });
  }
  return entries;
}
