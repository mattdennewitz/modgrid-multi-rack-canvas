import type { ImportedModule, ImportedRack } from './types.ts';

/** Accepts a ModularGrid rack URL (e.g. https://modulargrid.net/e/racks/view/3246217) or a bare id. */
export function extractRackId(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/racks\/view\/(\d+)/);
  return match ? match[1] : null;
}

const int = (value: unknown): number => {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isNaN(n) ? 0 : n;
};

interface RawModule {
  id: string;
  name: string;
  slug: string;
  description?: string;
  te: string;
  depth?: string;
  current5v?: string;
  current_plus?: string;
  current_min?: string;
  is_1u?: boolean | string;
  ModulesRack: {
    row: string;
    col: string;
    is_inbounds?: boolean;
    version_id: string | null;
  };
  Vendor?: { name?: string };
}

/**
 * Rack pages embed their full state as JSON in
 * <script type="application/json" data-mg-json="rtd">.
 */
export function parseRackHtml(html: string): ImportedRack {
  const match = html.match(/<script[^>]*data-mg-json="rtd"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('No rack data found on the page. Is the rack private or the URL wrong?');
  }
  const data = JSON.parse(match[1]);
  const rack = data?.rack?.Rack;
  if (!rack) throw new Error('Rack data was present but had an unexpected shape.');

  const modules: ImportedModule[] = ((data.rack.Module ?? []) as RawModule[]).map((m) => ({
    moduleId: String(m.id),
    versionId: m.ModulesRack.version_id ? String(m.ModulesRack.version_id) : null,
    name: m.name,
    vendor: m.Vendor?.name ?? '',
    description: m.description ?? '',
    slug: m.slug,
    hp: int(m.te),
    depth: int(m.depth),
    is1u: m.is_1u === true || m.is_1u === '1',
    power: {
      plus12: int(m.current_plus),
      minus12: int(m.current_min),
      plus5: int(m.current5v),
    },
    row: int(m.ModulesRack.row),
    col: int(m.ModulesRack.col),
    inBounds: m.ModulesRack.is_inbounds !== false,
  }));

  return {
    id: String(rack.id),
    name: rack.name,
    format: rack.format ?? 'e',
    rows: Math.max(1, int(rack.rows)),
    hp: Math.max(1, int(rack.te)),
    modules,
  };
}
