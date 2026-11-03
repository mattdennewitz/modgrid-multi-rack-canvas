import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRackHtml } from '../src/lib/parseRack';
import { emptyState, historyReducer, reducer, type History } from '../src/lib/store';
import type { CollectionModule } from '../src/lib/types';

const rack = parseRackHtml(readFileSync(new URL('./fixtures/rack-3246217.html', import.meta.url), 'utf8'));

describe('reducer', () => {
  it('imports a rack into a new case with its layout', () => {
    const s = reducer(emptyState, { type: 'importRack', rack, createCase: true });
    expect(s.cases).toHaveLength(1);
    expect(s.cases[0]).toMatchObject({ rows: 5, hp: 104 });
    expect(s.modules).toHaveLength(28);
    expect(s.modules.every((m) => m.placement?.caseId === s.cases[0].id)).toBe(true);
    expect(s.modules.find((m) => m.name === 'Contour 1')!.placement).toMatchObject({ row: 1, col: 47 });
  });

  it('imports into the tray when not creating a case', () => {
    const s = reducer(emptyState, { type: 'importRack', rack, createCase: false });
    expect(s.cases).toHaveLength(0);
    expect(s.modules.every((m) => m.placement === null)).toBe(true);
  });

  it('stacks new cases below existing ones', () => {
    let s = reducer(emptyState, { type: 'addCase', name: 'A', rows: 2, hp: 84 });
    s = reducer(s, { type: 'addCase', name: 'B', rows: 1, hp: 104 });
    expect(s.cases[1].y).toBeGreaterThan(s.cases[0].y);
  });

  it('evicts modules that no longer fit after shrinking a case', () => {
    const s = reducer(emptyState, { type: 'importRack', rack, createCase: true });
    const shrunk = reducer(s, { type: 'updateCase', id: s.cases[0].id, patch: { rows: 2, hp: 84 } });
    for (const m of shrunk.modules) {
      if (m.placement) {
        expect(m.placement.row).toBeLessThanOrEqual(2);
        expect(m.placement.col + m.hp - 1).toBeLessThanOrEqual(84);
      }
    }
    expect(shrunk.modules.some((m) => m.placement === null)).toBe(true);
  });

  it('returns modules to the tray when their case is deleted', () => {
    const s = reducer(emptyState, { type: 'importRack', rack, createCase: true });
    const d = reducer(s, { type: 'deleteCase', id: s.cases[0].id });
    expect(d.cases).toHaveLength(0);
    expect(d.modules.every((m) => m.placement === null)).toBe(true);
  });
});

describe('locks', () => {
  const imported = reducer(emptyState, { type: 'importRack', rack, createCase: true });
  const caseId = imported.cases[0].id;
  const maths = imported.modules.find((m) => m.name === 'Maths')!; // row 2, col 19, 20HP
  const locked = reducer(imported, { type: 'setLocked', id: maths.id, locked: true });
  const get = (s: typeof locked) => s.modules.find((m) => m.id === maths.id)!;

  it('blocks moving, tray and removal of a locked module', () => {
    expect(get(locked).locked).toBe(true);
    expect(reducer(locked, { type: 'placeModule', id: maths.id, placement: null })).toBe(locked);
    expect(reducer(locked, { type: 'placeModule', id: maths.id, placement: { caseId, row: 5, col: 1 } })).toBe(locked);
    expect(reducer(locked, { type: 'removeModule', id: maths.id })).toBe(locked);
  });

  it('blocks a resize that would evict a locked module, allows one that keeps it', () => {
    expect(reducer(locked, { type: 'updateCase', id: caseId, patch: { rows: 1 } })).toBe(locked);
    expect(reducer(locked, { type: 'updateCase', id: caseId, patch: { hp: 30 } })).toBe(locked);
    const ok = reducer(locked, { type: 'updateCase', id: caseId, patch: { rows: 2, hp: 84 } });
    expect(get(ok).placement).toMatchObject({ row: 2, col: 19 });
  });

  it('keeps locked modules in place when the case moves', () => {
    const moved = reducer(locked, { type: 'updateCase', id: caseId, patch: { x: 500, y: 500 } });
    expect(get(moved).placement).toEqual(get(locked).placement);
  });

  it('cannot lock a tray module, and unlocks on case delete', () => {
    const tray = reducer(imported, { type: 'importRack', rack, createCase: false });
    const trayModule = tray.modules.find((m) => !m.placement)!;
    const s = reducer(tray, { type: 'setLocked', id: trayModule.id, locked: true });
    expect(s.modules.find((m) => m.id === trayModule.id)!.locked).toBeFalsy();
    const deleted = reducer(locked, { type: 'deleteCase', id: caseId });
    expect(get(deleted)).toMatchObject({ placement: null, locked: false });
  });

  it('unlocks and then allows moving', () => {
    const unlocked = reducer(locked, { type: 'setLocked', id: maths.id, locked: false });
    expect(get(reducer(unlocked, { type: 'placeModule', id: maths.id, placement: null })).placement).toBeNull();
  });
});

describe('historyReducer', () => {
  it('undoes and redoes', () => {
    let h: History = { past: [], present: emptyState, future: [] };
    h = historyReducer(h, { type: 'addCase', name: 'A', rows: 1, hp: 84 });
    expect(h.present.cases).toHaveLength(1);
    h = historyReducer(h, { type: 'undo' });
    expect(h.present.cases).toHaveLength(0);
    h = historyReducer(h, { type: 'redo' });
    expect(h.present.cases).toHaveLength(1);
  });
});

describe('importCollection', () => {
  const mod = (slug: string) => ({
    moduleId: slug,
    versionId: null,
    name: slug,
    vendor: 'V',
    description: '',
    slug,
    hp: 4,
    depth: 20,
    is1u: false,
    power: { plus12: 1, minus12: 1, plus5: 0 },
  });

  it('adds modules to the tray and skips ones already in the app', () => {
    const first = reducer(emptyState, { type: 'importCollection', modules: [mod('a'), mod('b'), mod('a')], source: 'Collection' });
    expect(first.modules.map((m) => m.slug)).toEqual(['a', 'b']);
    expect(first.modules.every((m) => m.placement === null && m.source === 'Collection')).toBe(true);

    const second = reducer(first, { type: 'importCollection', modules: [mod('b'), mod('c')], source: 'Collection' });
    expect(second.modules.map((m) => m.slug)).toEqual(['a', 'b', 'c']);
  });
});

describe('1U rows and rotation', () => {
  const mod = (over: Partial<CollectionModule> & { slug: string }): CollectionModule => ({
    moduleId: over.slug,
    versionId: null,
    name: over.slug,
    vendor: 'V',
    description: '',
    hp: 4,
    depth: 0,
    is1u: false,
    power: { plus12: 0, minus12: 0, plus5: 0 },
    ...over,
  });

  function setup() {
    let s = reducer(emptyState, { type: 'addCase', name: 'A', rows: 2, hp: 84 });
    const caseId = s.cases[0].id;
    s = reducer(s, { type: 'updateCase', id: caseId, patch: { rowTypes: ['3U', '1U'] } });
    s = reducer(s, {
      type: 'importCollection',
      source: 'test',
      modules: [mod({ slug: 'narrow', hp: 2 }), mod({ slug: 'wide', hp: 10 }), mod({ slug: 'one-u', hp: 8, is1u: true })],
    });
    const id = (slug: string) => s.modules.find((m) => m.slug === slug)!.id;
    return { s, caseId, id };
  }
  const get = (s: ReturnType<typeof setup>['s'], id: string) => s.modules.find((m) => m.id === id)!;

  it('keeps rowTypes in step with the row count and drops them when all rows are 3U', () => {
    const { s, caseId } = setup();
    expect(s.cases[0].rowTypes).toEqual(['3U', '1U']);
    const grown = reducer(s, { type: 'updateCase', id: caseId, patch: { rows: 3 } });
    expect(grown.cases[0].rowTypes).toEqual(['3U', '1U', '3U']);
    const flat = reducer(s, { type: 'updateCase', id: caseId, patch: { rowTypes: ['3U', '3U'] } });
    expect(flat.cases[0].rowTypes).toBeUndefined();
  });

  it('flips a module 180° in a 3U row and turns it 90° in a 1U row', () => {
    const { s, caseId, id } = setup();
    let t = reducer(s, { type: 'placeModule', id: id('wide'), placement: { caseId, row: 1, col: 1 } });
    t = reducer(t, { type: 'rotateModule', id: id('wide') });
    expect(get(t, id('wide')).placement!.rotation).toBe(180);
    t = reducer(t, { type: 'rotateModule', id: id('wide') });
    expect(get(t, id('wide')).placement!.rotation ?? 0).toBe(0);

    t = reducer(t, { type: 'placeModule', id: id('narrow'), placement: { caseId, row: 2, col: 1, rotation: 90 } });
    t = reducer(t, { type: 'rotateModule', id: id('narrow') });
    expect(get(t, id('narrow')).placement!.rotation).toBe(270);
    t = reducer(t, { type: 'rotateModule', id: id('narrow') });
    expect(get(t, id('narrow')).placement!.rotation).toBe(90);
  });

  it('ignores rotation for locked and unplaced modules', () => {
    const { s, caseId, id } = setup();
    expect(reducer(s, { type: 'rotateModule', id: id('wide') })).toBe(s);
    let t = reducer(s, { type: 'placeModule', id: id('wide'), placement: { caseId, row: 1, col: 1 } });
    t = reducer(t, { type: 'setLocked', id: id('wide'), locked: true });
    expect(reducer(t, { type: 'rotateModule', id: id('wide') })).toBe(t);
  });

  it('sends modules to the tray when their row type stops suiting them', () => {
    const { s, caseId, id } = setup();
    let t = reducer(s, { type: 'placeModule', id: id('wide'), placement: { caseId, row: 1, col: 1 } });
    t = reducer(t, { type: 'placeModule', id: id('narrow'), placement: { caseId, row: 2, col: 1, rotation: 90 } });
    t = reducer(t, { type: 'placeModule', id: id('one-u'), placement: { caseId, row: 2, col: 30 } });

    // Row 1 becomes 1U: the upright 3U module no longer fits; the others stay.
    const a = reducer(t, { type: 'updateCase', id: caseId, patch: { rowTypes: ['1U', '1U'] } });
    expect(get(a, id('wide')).placement).toBeNull();
    expect(get(a, id('narrow')).placement).not.toBeNull();
    expect(get(a, id('one-u')).placement).not.toBeNull();

    // Row 2 becomes 3U: the sideways module and the 1U module go.
    const b = reducer(t, { type: 'updateCase', id: caseId, patch: { rowTypes: ['3U', '3U'] } });
    expect(get(b, id('wide')).placement).not.toBeNull();
    expect(get(b, id('narrow')).placement).toBeNull();
    expect(get(b, id('one-u')).placement).toBeNull();
  });

  it('refuses a row-type change that would evict a locked module', () => {
    const { s, caseId, id } = setup();
    let t = reducer(s, { type: 'placeModule', id: id('wide'), placement: { caseId, row: 1, col: 1 } });
    t = reducer(t, { type: 'setLocked', id: id('wide'), locked: true });
    expect(reducer(t, { type: 'updateCase', id: caseId, patch: { rowTypes: ['1U', '1U'] } })).toBe(t);
  });
});

describe('row moves', () => {
  const mod = (slug: string, hp: number) => ({
    slug,
    moduleId: slug,
    versionId: null,
    name: slug,
    vendor: 'V',
    description: '',
    hp,
    depth: 0,
    is1u: false,
    power: { plus12: 0, minus12: 0, plus5: 0 },
  });

  // A: 3 rows ['3U','1U','3U'], one module per row (a1, a2 sideways, a3). B: 2 rows (b1, b2). C: 100HP.
  // E: rows ['1U','3U'], empty. D: 1 row.
  function setup() {
    let s = emptyState;
    for (const [name, rows, hp] of [['A', 3, 84], ['B', 2, 84], ['C', 2, 100], ['D', 1, 84], ['E', 2, 84]] as const) {
      s = reducer(s, { type: 'addCase', name, rows, hp });
    }
    const [A, B, C, D, E] = s.cases.map((c) => c.id);
    s = reducer(s, { type: 'updateCase', id: A, patch: { rowTypes: ['3U', '1U', '3U'] } });
    s = reducer(s, { type: 'updateCase', id: E, patch: { rowTypes: ['1U', '3U'] } });
    s = reducer(s, {
      type: 'importCollection',
      source: 't',
      modules: ['a1', 'a2', 'a3', 'b1', 'b2', 'c1', 'd1'].map((n) => mod(n, n === 'a2' ? 2 : 4)),
    });
    const id = (slug: string) => s.modules.find((m) => m.slug === slug)!.id;
    const put = (slug: string, caseId: string, row: number, rotation?: 90) => {
      s = reducer(s, { type: 'placeModule', id: id(slug), placement: { caseId, row, col: 1, ...(rotation ? { rotation } : {}) } });
    };
    put('a1', A, 1);
    put('a2', A, 2, 90);
    put('a3', A, 3);
    put('b1', B, 1);
    put('b2', B, 2);
    put('c1', C, 1);
    put('d1', D, 1);
    return { s, A, B, C, D, E, id };
  }
  type S = ReturnType<typeof setup>;
  const where = (x: S, state: S['s'], slug: string) => {
    const p = state.modules.find((m) => m.id === x.id(slug))!.placement!;
    return `${state.cases.find((c) => c.id === p.caseId)!.name}${p.row}`;
  };
  const caseOf = (state: S['s'], id: string) => state.cases.find((c) => c.id === id)!;

  describe('reorderRow', () => {
    const reorder = (x: S, fromRow: number, toIndex: number, state = x.s) =>
      reducer(state, { type: 'reorderRow', caseId: x.A, fromRow, toIndex });

    it('moves a row down, renumbering the rows it passes', () => {
      const x = setup();
      const t = reorder(x, 1, 4);
      expect(['a1', 'a2', 'a3'].map((n) => where(x, t, n))).toEqual(['A3', 'A1', 'A2']);
      expect(caseOf(t, x.A).rowTypes).toEqual(['1U', '3U', '3U']);
      expect(t.modules.find((m) => m.id === x.id('a2'))!.placement!.rotation).toBe(90);
    });

    it('moves a row up', () => {
      const x = setup();
      const t = reorder(x, 3, 1);
      expect(['a1', 'a2', 'a3'].map((n) => where(x, t, n))).toEqual(['A2', 'A3', 'A1']);
      expect(caseOf(t, x.A).rowTypes).toEqual(['3U', '3U', '1U']);
    });

    it('is a no-op when the row would stay put, and refuses out-of-range rows', () => {
      const x = setup();
      expect(reorder(x, 2, 2)).toBe(x.s);
      expect(reorder(x, 2, 3)).toBe(x.s);
      expect(reorder(x, 4, 1)).toBe(x.s);
      expect(reorder(x, 1, 5)).toBe(x.s);
    });

    it('never changes the number of rows', () => {
      const x = setup();
      expect(caseOf(reorder(x, 1, 4), x.A).rows).toBe(3);
    });

    it('refuses to renumber a locked row, but allows moves that leave it alone', () => {
      const x = setup();
      const locked = reducer(x.s, { type: 'setLocked', id: x.id('a3'), locked: true });
      expect(reorder(x, 1, 4, locked)).toBe(locked); // a3 shifts up
      expect(reorder(x, 3, 1, locked)).toBe(locked); // the locked row itself
      const ok = reorder(x, 1, 3, locked); // rows 1 and 2 trade; row 3 stays
      expect(where(x, ok, 'a3')).toBe('A3');
      expect(where(x, ok, 'a1')).toBe('A2');
    });
  });

  describe('swapRows', () => {
    const swap = (x: S, aCaseId: string, aRow: number, bCaseId: string, bRow: number, state = x.s) =>
      reducer(state, { type: 'swapRows', aCaseId, aRow, bCaseId, bRow });

    it('trades two populated rows between cases without resizing either', () => {
      const x = setup();
      const t = swap(x, x.A, 1, x.B, 1);
      expect(['a1', 'b1', 'a3', 'b2'].map((n) => where(x, t, n))).toEqual(['B1', 'A1', 'A3', 'B2']);
      expect(t.cases).toEqual(x.s.cases);
    });

    it('moves into an empty row, leaving a blank row behind', () => {
      const x = setup();
      const t = swap(x, x.A, 3, x.E, 2);
      expect(where(x, t, 'a3')).toBe('E2');
      expect(t.modules.some((m) => m.placement?.caseId === x.A && m.placement.row === 3)).toBe(false);
      expect(caseOf(t, x.A).rows).toBe(3);
      expect(caseOf(t, x.E).rows).toBe(2);
      expect(t.cases).toEqual(x.s.cases);
    });

    it('keeps rotation, and works between two 1U rows', () => {
      const x = setup();
      const t = swap(x, x.A, 2, x.E, 1);
      expect(where(x, t, 'a2')).toBe('E1');
      expect(t.modules.find((m) => m.id === x.id('a2'))!.placement!.rotation).toBe(90);
    });

    it('refuses a different row type, a different width, and bad rows', () => {
      const x = setup();
      expect(swap(x, x.A, 2, x.B, 1)).toBe(x.s); // 1U with 3U
      expect(swap(x, x.A, 1, x.C, 1)).toBe(x.s); // 84HP with 100HP
      expect(swap(x, x.A, 4, x.B, 1)).toBe(x.s);
      expect(swap(x, x.A, 1, x.B, 3)).toBe(x.s);
      expect(swap(x, x.A, 1, x.A, 1)).toBe(x.s);
    });

    it('is a no-op when both rows are empty', () => {
      const x = setup();
      const t = swap(x, x.E, 1, x.E, 1);
      expect(t).toBe(x.s);
      const empty = reducer(x.s, { type: 'placeModule', id: x.id('b2'), placement: null });
      expect(swap(x, x.B, 2, x.E, 2, empty)).toBe(empty);
    });

    it('refuses when either row holds a locked module', () => {
      const x = setup();
      const locked = reducer(x.s, { type: 'setLocked', id: x.id('a3'), locked: true });
      expect(swap(x, x.A, 3, x.E, 2, locked)).toBe(locked);
      expect(swap(x, x.E, 2, x.A, 3, locked)).toBe(locked);
      expect(swap(x, x.A, 1, x.B, 1, locked)).not.toBe(locked);
    });
  });
});
