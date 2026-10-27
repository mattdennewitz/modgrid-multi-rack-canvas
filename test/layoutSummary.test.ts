import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { summarizeLayout } from '../src/lib/layoutSummary';
import { parseRackHtml } from '../src/lib/parseRack';
import { emptyState, reducer } from '../src/lib/store';

const rack = parseRackHtml(readFileSync(new URL('./fixtures/rack-3246217.html', import.meta.url), 'utf8'));
const imported = reducer(emptyState, { type: 'importRack', rack, createCase: true });

describe('summarizeLayout', () => {
  it('lists every row with modules, gaps and locks', () => {
    const maths = imported.modules.find((m) => m.name === 'Maths')!;
    const s = reducer(imported, { type: 'setLocked', id: maths.id, locked: true });
    const text = summarizeLayout(s, maths.id);

    expect(text).toContain('5 row(s) × 104HP');
    expect(text).toMatch(/- HP 19–38: Maths — Make Noise .*\[LOCKED\]/);
    expect(text).toMatch(/- HP 47–54: Contour 1 — Joranalogue Audio Design — .*30mm deep/);
    // Row 5 is empty in the source rack.
    expect(text).toContain('Row 5:\n- HP 1–104: empty (104HP)');
    expect(text).toContain('The user currently has "Maths" selected (in case');
  });

  it('accounts for every HP in every row', () => {
    const text = summarizeLayout(imported);
    for (const row of text.split(/^Row \d+:\n/m).slice(1)) {
      const ranges = [...row.matchAll(/^- HP (\d+)–(\d+):/gm)].map((m) => [Number(m[1]), Number(m[2])]);
      expect(ranges[0][0]).toBe(1);
      for (let i = 1; i < ranges.length; i++) expect(ranges[i][0]).toBe(ranges[i - 1][1] + 1);
      expect(ranges.at(-1)![1]).toBe(104);
    }
  });

  it('describes the tray', () => {
    const tray = reducer(emptyState, { type: 'importRack', rack, createCase: false });
    expect(summarizeLayout(tray)).toMatch(/## Tray[^\n]*\n- /);
    expect(summarizeLayout(emptyState)).toContain('There are no cases yet.');
  });
});
