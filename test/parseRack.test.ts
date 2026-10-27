import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractRackId, parseRackHtml } from '../src/lib/parseRack';

const html = readFileSync(new URL('./fixtures/rack-3246217.html', import.meta.url), 'utf8');

describe('extractRackId', () => {
  it('accepts urls and bare ids', () => {
    expect(extractRackId('https://modulargrid.net/e/racks/view/3246217')).toBe('3246217');
    expect(extractRackId('modulargrid.net/e/racks/view/3246217?foo=1')).toBe('3246217');
    expect(extractRackId(' 3246217 ')).toBe('3246217');
    expect(extractRackId('https://modulargrid.net/e/modules')).toBeNull();
  });
});

describe('parseRackHtml', () => {
  const rack = parseRackHtml(html);

  it('reads rack dimensions', () => {
    expect(rack.id).toBe('3246217');
    expect(rack.rows).toBe(5);
    expect(rack.hp).toBe(104);
    expect(rack.format).toBe('e');
  });

  it('reads modules with numeric positions', () => {
    expect(rack.modules).toHaveLength(28);
    const contour = rack.modules.find((m) => m.name === 'Contour 1')!;
    expect(contour).toMatchObject({
      moduleId: '21699',
      vendor: 'Joranalogue Audio Design',
      hp: 8,
      depth: 30,
      row: 1,
      col: 47,
      is1u: false,
      versionId: null,
      power: { plus12: 90, minus12: 85, plus5: 0 },
    });
  });

  it('has no overlapping modules in the source rack', () => {
    for (const a of rack.modules) {
      for (const b of rack.modules) {
        if (a === b || a.row !== b.row) continue;
        expect(a.col < b.col + b.hp && b.col < a.col + a.hp, `${a.name} overlaps ${b.name}`).toBe(false);
      }
      expect(a.col + a.hp - 1).toBeLessThanOrEqual(rack.hp);
    }
  });

  it('throws on pages without rack data', () => {
    expect(() => parseRackHtml('<html></html>')).toThrow(/No rack data/);
  });
});
