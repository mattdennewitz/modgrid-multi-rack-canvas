import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRackHtml } from '../src/lib/parseRack';
import { ancestorsOf } from '../src/lib/lineage';
import {
  activeCanvas,
  allPlaced,
  duplicateCase,
  emptyState,
  historyReducer,
  normalizeInventory,
  normalizeState,
  reducer,
  toAppState,
  type History,
} from '../src/lib/store';
import type { AppState, CollectionModule } from '../src/lib/types';

const rack = parseRackHtml(readFileSync(new URL('./fixtures/rack-3246217.html', import.meta.url), 'utf8'));

// The canvas under test is always the active one, so these stand in for the old flat `state.cases`/`state.modules`.
const active = activeCanvas;
const cases = (s: AppState) => active(s).cases;
const placed = (s: AppState) => active(s).placed;
const pool = (s: AppState) => s.modules;
const everyRecord = (s: AppState) => [...s.modules, ...allPlaced(s)];

describe('reducer', () => {
  it('imports a rack into a new case with its layout', () => {
    const s = reducer(emptyState, { type: 'importRack', rack, createCase: true });
    expect(cases(s)).toHaveLength(1);
    expect(cases(s)[0]).toMatchObject({ rows: 5, hp: 104 });
    expect(placed(s)).toHaveLength(28);
    expect(placed(s).every((m) => m.placement.caseId === cases(s)[0].id)).toBe(true);
    expect(placed(s).find((m) => m.name === 'Contour 1')!.placement).toMatchObject({ row: 1, col: 47 });
    // Every module is also in the pool exactly once.
    expect(pool(s).map((m) => m.moduleId).sort()).toEqual([...new Set(rack.modules.map((m) => m.moduleId))].sort());
  });

  it('imports into the tray when not creating a case', () => {
    const s = reducer(emptyState, { type: 'importRack', rack, createCase: false });
    expect(cases(s)).toHaveLength(0);
    expect(placed(s)).toHaveLength(0);
    expect(pool(s).every((m) => m.placement === null)).toBe(true);
  });

  it('stacks new cases below existing ones', () => {
    let s = reducer(emptyState, { type: 'addCase', name: 'A', rows: 2, hp: 84 });
    s = reducer(s, { type: 'addCase', name: 'B', rows: 1, hp: 104 });
    expect(cases(s)[1].y).toBeGreaterThan(cases(s)[0].y);
  });

  it('evicts modules that no longer fit after shrinking a case', () => {
    const s = reducer(emptyState, { type: 'importRack', rack, createCase: true });
    const shrunk = reducer(s, { type: 'updateCase', id: cases(s)[0].id, patch: { rows: 2, hp: 84 } });
    for (const m of placed(shrunk)) {
      expect(m.placement.row).toBeLessThanOrEqual(2);
      expect(m.placement.col + m.hp - 1).toBeLessThanOrEqual(84);
    }
    expect(placed(shrunk).length).toBeLessThan(placed(s).length);
    // The pool array itself is untouched, not merely equal.
    expect(shrunk.modules).toBe(s.modules);
  });

  it('keeps the pool when a case is deleted', () => {
    const s = reducer(emptyState, { type: 'importRack', rack, createCase: true });
    const d = reducer(s, { type: 'deleteCase', id: cases(s)[0].id });
    expect(cases(d)).toHaveLength(0);
    expect(placed(d)).toHaveLength(0);
    expect(d.modules).toBe(s.modules);
  });

  it('refuses to delete a case that is not on the canvas', () => {
    const s = reducer(emptyState, { type: 'importRack', rack, createCase: true });
    expect(reducer(s, { type: 'deleteCase', id: 'nope' })).toBe(s);
  });
});

describe('locks', () => {
  const imported = reducer(emptyState, { type: 'importRack', rack, createCase: true });
  const caseId = cases(imported)[0].id;
  const maths = placed(imported).find((m) => m.name === 'Maths')!; // row 2, col 19, 20HP
  const locked = reducer(imported, { type: 'setLocked', id: maths.id, locked: true });
  const get = (s: AppState) => placed(s).find((m) => m.id === maths.id);

  it('blocks moving, tray and removal of a locked module', () => {
    expect(get(locked)!.locked).toBe(true);
    expect(reducer(locked, { type: 'placeModule', id: maths.id, placement: null })).toBe(locked);
    expect(reducer(locked, { type: 'placeModule', id: maths.id, placement: { caseId, row: 5, col: 1 } })).toBe(locked);
    expect(reducer(locked, { type: 'removeModule', id: maths.id })).toBe(locked);
  });

  it('blocks a resize that would evict a locked module, allows one that keeps it', () => {
    expect(reducer(locked, { type: 'updateCase', id: caseId, patch: { rows: 1 } })).toBe(locked);
    expect(reducer(locked, { type: 'updateCase', id: caseId, patch: { hp: 30 } })).toBe(locked);
    const ok = reducer(locked, { type: 'updateCase', id: caseId, patch: { rows: 2, hp: 84 } });
    expect(get(ok)!.placement).toMatchObject({ row: 2, col: 19 });
  });

  it('keeps locked modules in place when the case moves', () => {
    const moved = reducer(locked, { type: 'updateCase', id: caseId, patch: { x: 500, y: 500 } });
    expect(get(moved)!.placement).toEqual(get(locked)!.placement);
  });

  it('cannot lock a pool record, and unlocks on case delete', () => {
    // A pool record has nothing to lock, so the action is refused outright.
    expect(reducer(imported, { type: 'setLocked', id: pool(imported)[0].id, locked: true })).toBe(imported);
    // A locked copy goes with its case; the pool record stays and is never locked.
    const deleted = reducer(locked, { type: 'deleteCase', id: caseId });
    expect(get(deleted)).toBeUndefined();
    expect(pool(deleted).find((m) => m.moduleId === maths.moduleId)!.locked).toBeFalsy();
  });

  it('is a no-op when the lock state would not change', () => {
    expect(reducer(locked, { type: 'setLocked', id: maths.id, locked: true })).toBe(locked);
    expect(reducer(imported, { type: 'setLocked', id: maths.id, locked: false })).toBe(imported);
  });

  it('unlocks and then allows moving', () => {
    const unlocked = reducer(locked, { type: 'setLocked', id: maths.id, locked: false });
    expect(get(reducer(unlocked, { type: 'placeModule', id: maths.id, placement: null }))).toBeUndefined();
  });
});

describe('historyReducer', () => {
  it('undoes and redoes', () => {
    let h: History = { past: [], present: emptyState, future: [] };
    h = historyReducer(h, { type: 'addCase', name: 'A', rows: 1, hp: 84 });
    expect(cases(h.present)).toHaveLength(1);
    h = historyReducer(h, { type: 'undo' });
    expect(cases(h.present)).toHaveLength(0);
    h = historyReducer(h, { type: 'redo' });
    expect(cases(h.present)).toHaveLength(1);
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
    const caseId = cases(s)[0].id;
    s = reducer(s, { type: 'updateCase', id: caseId, patch: { rowTypes: ['3U', '1U'] } });
    s = reducer(s, {
      type: 'importCollection',
      source: 'test',
      modules: [mod({ slug: 'narrow', hp: 2 }), mod({ slug: 'wide', hp: 10 }), mod({ slug: 'one-u', hp: 8, is1u: true })],
    });
    const id = (slug: string, state = s) =>
      (placed(state).find((m) => m.slug === slug) ?? pool(state).find((m) => m.slug === slug)!).id;
    return { s, caseId, id };
  }
  const placedSlugs = (st: AppState) => placed(st).map((m) => m.slug).sort();
  const get = (s: AppState, id: string) => everyRecord(s).find((m) => m.id === id)!;

  it('keeps rowTypes in step with the row count and drops them when all rows are 3U', () => {
    const { s, caseId } = setup();
    expect(cases(s)[0].rowTypes).toEqual(['3U', '1U']);
    const grown = reducer(s, { type: 'updateCase', id: caseId, patch: { rows: 3 } });
    expect(cases(grown)[0].rowTypes).toEqual(['3U', '1U', '3U']);
    const flat = reducer(s, { type: 'updateCase', id: caseId, patch: { rowTypes: ['3U', '3U'] } });
    expect(cases(flat)[0].rowTypes).toBeUndefined();
  });

  it('flips a module 180° in a 3U row and turns it 90° in a 1U row', () => {
    const { s, caseId, id } = setup();
    let t = reducer(s, { type: 'placeModule', id: id('wide', s), placement: { caseId, row: 1, col: 1 } });
    t = reducer(t, { type: 'rotateModule', id: id('wide', t) });
    expect(get(t, id('wide', t)).placement!.rotation).toBe(180);
    t = reducer(t, { type: 'rotateModule', id: id('wide', t) });
    expect(get(t, id('wide', t)).placement!.rotation ?? 0).toBe(0);

    t = reducer(t, { type: 'placeModule', id: id('narrow', t), placement: { caseId, row: 2, col: 1, rotation: 90 } });
    t = reducer(t, { type: 'rotateModule', id: id('narrow', t) });
    expect(get(t, id('narrow', t)).placement!.rotation).toBe(270);
    t = reducer(t, { type: 'rotateModule', id: id('narrow', t) });
    expect(get(t, id('narrow', t)).placement!.rotation).toBe(90);
  });

  it('ignores rotation for locked and unplaced modules', () => {
    const { s, caseId, id } = setup();
    expect(reducer(s, { type: 'rotateModule', id: id('wide', s) })).toBe(s);
    let t = reducer(s, { type: 'placeModule', id: id('wide', s), placement: { caseId, row: 1, col: 1 } });
    t = reducer(t, { type: 'setLocked', id: id('wide', t), locked: true });
    expect(reducer(t, { type: 'rotateModule', id: id('wide', t) })).toBe(t);
  });

  it('takes modules out of the case when their row type stops suiting them', () => {
    const { s, caseId, id } = setup();
    let t = reducer(s, { type: 'placeModule', id: id('wide', s), placement: { caseId, row: 1, col: 1 } });
    t = reducer(t, { type: 'placeModule', id: id('narrow', t), placement: { caseId, row: 2, col: 1, rotation: 90 } });
    t = reducer(t, { type: 'placeModule', id: id('one-u', t), placement: { caseId, row: 2, col: 30 } });

    // Row 1 becomes 1U: the upright 3U module no longer fits; the others stay.
    const a = reducer(t, { type: 'updateCase', id: caseId, patch: { rowTypes: ['1U', '1U'] } });
    expect(placedSlugs(a)).toEqual(['narrow', 'one-u']);

    // Row 2 becomes 3U: the sideways module and the 1U module go.
    const b = reducer(t, { type: 'updateCase', id: caseId, patch: { rowTypes: ['3U', '3U'] } });
    expect(placedSlugs(b)).toEqual(['wide']);
    // The pool is untouched either way.
    expect(pool(b)).toHaveLength(3);
  });

  it('refuses a row-type change that would evict a locked module', () => {
    const { s, caseId, id } = setup();
    let t = reducer(s, { type: 'placeModule', id: id('wide', s), placement: { caseId, row: 1, col: 1 } });
    t = reducer(t, { type: 'setLocked', id: id('wide', t), locked: true });
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
    const [A, B, C, D, E] = cases(s).map((c) => c.id);
    s = reducer(s, { type: 'updateCase', id: A, patch: { rowTypes: ['3U', '1U', '3U'] } });
    s = reducer(s, { type: 'updateCase', id: E, patch: { rowTypes: ['1U', '3U'] } });
    s = reducer(s, {
      type: 'importCollection',
      source: 't',
      modules: ['a1', 'a2', 'a3', 'b1', 'b2', 'c1', 'd1'].map((n) => mod(n, n === 'a2' ? 2 : 4)),
    });
    const id = (slug: string) =>
      (placed(s).find((m) => m.slug === slug) ?? pool(s).find((m) => m.slug === slug)!).id;
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
  const where = (x: S, state: AppState, slug: string) => {
    const p = placed(state).find((m) => m.id === x.id(slug))!.placement;
    return `${cases(state).find((c) => c.id === p.caseId)!.name}${p.row}`;
  };
  const caseOf = (state: AppState, id: string) => cases(state).find((c) => c.id === id)!;

  describe('reorderRow', () => {
    const reorder = (x: S, fromRow: number, toIndex: number, state = x.s) =>
      reducer(state, { type: 'reorderRow', caseId: x.A, fromRow, toIndex });

    it('moves a row down, renumbering the rows it passes', () => {
      const x = setup();
      const t = reorder(x, 1, 4);
      expect(['a1', 'a2', 'a3'].map((n) => where(x, t, n))).toEqual(['A3', 'A1', 'A2']);
      expect(caseOf(t, x.A).rowTypes).toEqual(['1U', '3U', '3U']);
      expect(placed(t).find((m) => m.id === x.id('a2'))!.placement.rotation).toBe(90);
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
      // No case changed at all, so the array is the very same object.
      expect(cases(t)).toBe(cases(x.s));
    });

    it('moves into an empty row, leaving a blank row behind', () => {
      const x = setup();
      const t = swap(x, x.A, 3, x.E, 2);
      expect(where(x, t, 'a3')).toBe('E2');
      expect(placed(t).some((m) => m.placement.caseId === x.A && m.placement.row === 3)).toBe(false);
      expect(caseOf(t, x.A).rows).toBe(3);
      expect(caseOf(t, x.E).rows).toBe(2);
      expect(cases(t)).toBe(cases(x.s));
    });

    it('keeps rotation, and works between two 1U rows', () => {
      const x = setup();
      const t = swap(x, x.A, 2, x.E, 1);
      expect(where(x, t, 'a2')).toBe('E1');
      expect(placed(t).find((m) => m.id === x.id('a2'))!.placement.rotation).toBe(90);
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

describe('inventory', () => {
  const base = () => reducer(emptyState, { type: 'importRack', rack, createCase: true });
  const invOf = (s: AppState, name: string) => pool(s).find((m) => m.name === name)!;

  /** The app-wide pool and id invariants, checked after every kind of edit. */
  const expectInvariant = (s: AppState, label: string) => {
    const keys = s.modules.map((m) => m.moduleId);
    expect(new Set(keys).size, `${label}: one pool record per module`).toBe(keys.length);
    expect(s.modules.every((m) => m.placement === null && !m.locked), `${label}: the pool is never placed or locked`).toBe(true);
    for (const m of allPlaced(s)) expect(keys, `${label}: ${m.name} has a pool record`).toContain(m.moduleId);
    const ids = everyRecord(s).map((m) => m.id);
    expect(new Set(ids).size, `${label}: record ids are unique app-wide`).toBe(ids.length);
    const caseIds = s.canvases.flatMap((c) => c.cases.map((x) => x.id));
    expect(new Set(caseIds).size, `${label}: case ids are unique app-wide`).toBe(caseIds.length);
    for (const c of s.canvases) {
      const own = new Set(c.cases.map((x) => x.id));
      for (const m of c.placed) {
        expect(own.has(m.placement.caseId), `${label}: ${m.name} sits in a case of its own canvas`).toBe(true);
      }
    }
    expect(s.canvases.some((c) => c.id === s.activeId), `${label}: activeId names a canvas`).toBe(true);
    expect(s.canvases.some((c) => c.id === s.primaryId), `${label}: primaryId names a canvas`).toBe(true);
  };

  it('keeps one record per module through a long sequence of edits', () => {
    let s = base();
    expectInvariant(s, 'import');
    const caseId = cases(s)[0].id;
    const maths = invOf(s, 'Maths');

    // Place the same module several times, in the same case and in a new one.
    s = reducer(s, { type: 'addCase', name: 'B', rows: 2, hp: 84 });
    const b = cases(s)[1].id;
    for (const col of [1, 30, 60]) s = reducer(s, { type: 'placeModule', id: maths.id, placement: { caseId: b, row: 1, col } });
    expectInvariant(s, 'place from the pool');
    expect(placed(s).filter((m) => m.moduleId === maths.moduleId)).toHaveLength(4);

    // Move, then swap two copies.
    const copies = placed(s).filter((m) => m.placement.caseId === b);
    s = reducer(s, { type: 'placeModule', id: copies[0].id, placement: { caseId: b, row: 2, col: 1 } });
    expectInvariant(s, 'move');
    s = reducer(s, {
      type: 'placeModules',
      placements: [
        { id: copies[1].id, placement: copies[2].placement },
        { id: copies[2].id, placement: copies[1].placement },
      ],
    });
    expectInvariant(s, 'swap');

    // Take one out of its case, then shrink and delete cases.
    s = reducer(s, { type: 'placeModule', id: copies[1].id, placement: null });
    expectInvariant(s, 'take out of case');
    expect(placed(s).filter((m) => m.moduleId === maths.moduleId)).toHaveLength(3);
    s = reducer(s, { type: 'updateCase', id: caseId, patch: { rows: 2, hp: 84 } });
    expectInvariant(s, 'resize');
    s = reducer(s, { type: 'updateCase', id: b, patch: { rowTypes: ['1U', '3U'] } });
    expectInvariant(s, 'row type change');
    s = reducer(s, { type: 'duplicateCase', id: caseId });
    expectInvariant(s, 'duplicate case');
    s = reducer(s, { type: 'deleteCase', id: caseId });
    expectInvariant(s, 'delete case');
    s = reducer(s, { type: 'importRack', rack, createCase: true });
    expectInvariant(s, 'import again');
    s = reducer(s, { type: 'importRack', rack, createCase: false });
    expectInvariant(s, 'import to the pool again');

    // Forking doubles the placed copies and must leave the pool exactly as it was.
    const beforeFork = s.modules;
    s = reducer(s, { type: 'forkCanvas', id: s.primaryId });
    expectInvariant(s, 'fork');
    expect(s.modules).toBe(beforeFork);

    // A save that kept several pool records per module is repaired on replace.
    s = reducer(s, {
      type: 'replace',
      state: { ...s, modules: [...s.modules, ...s.modules.map((m) => ({ ...m, id: `dup-${m.id}` }))] },
    });
    expectInvariant(s, 'load a save with duplicate pool records');
  });

  it('does not use up the pool when a module is placed', () => {
    const s = reducer(emptyState, { type: 'importRack', rack, createCase: false });
    const inv = pool(s);
    expect(inv.length).toBeGreaterThan(0);
    let t = reducer(s, { type: 'addCase', name: 'A', rows: 3, hp: 104 });
    const caseId = cases(t)[0].id;
    const m = inv.find((x) => !x.is1u && x.hp <= 20)!;
    t = reducer(t, { type: 'placeModule', id: m.id, placement: { caseId, row: 1, col: 1 } });
    t = reducer(t, { type: 'placeModule', id: m.id, placement: { caseId, row: 2, col: 1 } });
    expect(t.modules).toBe(s.modules);
    expect(placed(t).map((x) => x.moduleId)).toEqual([m.moduleId, m.moduleId]);
  });

  it('only moves placed copies with placeModules', () => {
    const s = base();
    const inv = pool(s)[0];
    expect(
      reducer(s, { type: 'placeModules', placements: [{ id: inv.id, placement: { caseId: cases(s)[0].id, row: 1, col: 1 } }] }),
    ).toBe(s);
    const [a, b] = placed(s);
    const h = historyReducer({ past: [], present: s, future: [] }, {
      type: 'placeModules',
      placements: [{ id: a.id, placement: b.placement }, { id: b.id, placement: a.placement }],
    });
    expect(h.past).toHaveLength(1);
    expect(placed(h.present).find((m) => m.id === a.id)!.placement).toEqual(b.placement);
  });

  it('duplicates a case along with its modules, leaving the pool alone', () => {
    const s = base();
    const src = cases(s)[0];
    const next = reducer(s, { type: 'duplicateCase', id: src.id });
    const copy = cases(next)[1];
    expect(copy).toMatchObject({ name: `${src.name} copy`, rows: src.rows, hp: src.hp });
    expect(copy.y).toBeGreaterThan(src.y);
    expect(next.modules).toBe(s.modules);
    // The copy stays on the source's canvas.
    expect(next.canvases).toHaveLength(1);
    const inCopy = placed(next).filter((m) => m.placement.caseId === copy.id);
    expect(inCopy).toHaveLength(28);
    for (const m of placed(s)) {
      expect(
        inCopy.some((x) => x.moduleId === m.moduleId && x.placement.row === m.placement.row && x.placement.col === m.placement.col),
      ).toBe(true);
    }
  });

  it('does not copy locks when duplicating', () => {
    let s = base();
    s = reducer(s, { type: 'setLocked', id: placed(s)[0].id, locked: true });
    const r = duplicateCase(active(s), cases(s)[0].id);
    expect(r.copied).toBe(28);
    expect(r.canvas.placed.filter((m) => m.locked)).toHaveLength(1);
  });

  it('imports a rack without doubling what you already own', () => {
    const first = reducer(emptyState, { type: 'importRack', rack, createCase: false });
    expect(reducer(first, { type: 'importRack', rack, createCase: false })).toEqual(first);
    const withCase = reducer(first, { type: 'importRack', rack, createCase: true });
    expect(withCase.modules).toBe(first.modules);
    expect(placed(withCase)).toHaveLength(28);
  });

  it('removes a module from the pool and every case, unless a copy is locked', () => {
    let s = base();
    const maths = invOf(s, 'Maths');
    s = reducer(s, { type: 'placeModule', id: maths.id, placement: { caseId: cases(s)[0].id, row: 5, col: 1 } });
    // A placed copy isn't a pool record, so it can't be removed from the pool.
    const copy = placed(s).find((m) => m.moduleId === maths.moduleId)!;
    expect(reducer(s, { type: 'removeModule', id: copy.id })).toBe(s);

    const locked = reducer(s, { type: 'setLocked', id: copy.id, locked: true });
    expect(reducer(locked, { type: 'removeModule', id: maths.id })).toBe(locked);

    const gone = reducer(s, { type: 'removeModule', id: maths.id });
    expect(gone.modules.some((m) => m.moduleId === maths.moduleId)).toBe(false);
    expect(allPlaced(gone).some((m) => m.moduleId === maths.moduleId)).toBe(false);
    expect(gone.modules).toHaveLength(s.modules.length - 1);
    expect(placed(gone)).toHaveLength(placed(s).length - 2);
  });

  it('normalizes without changing a consistent state', () => {
    const s = base();
    expect(normalizeInventory(s)).toBe(s);
    expect(normalizeState(s)).toBe(s);
  });
});

describe('legacy saves', () => {
  const legacy = () => JSON.parse(readFileSync(new URL('./fixtures/sample-1u-state.json', import.meta.url), 'utf8'));

  it('migrates a pre-canvas save into one root canvas', () => {
    const s = toAppState(legacy())!;
    expect(s.canvases).toHaveLength(1);
    expect(s.canvases[0].parentId).toBeUndefined();
    expect(s.activeId).toBe(s.canvases[0].id);
    expect(s.primaryId).toBe(s.activeId);
    expect(cases(s).map((c) => c.id)).toEqual(['case-1']);
    expect(placed(s).map((m) => m.id)).toEqual(['m-wide']);
    // The fixture has no pool record for its placed module, so the pool repair backfills one.
    expect(pool(s).map((m) => m.moduleId).sort()).toEqual([
      'fixture-five',
      'fixture-four',
      'fixture-narrow',
      'fixture-tile',
      'fixture-wide',
    ]);
    expect(pool(s).every((m) => m.placement === null)).toBe(true);
  });

  it('rejects anything that is neither shape', () => {
    expect(toAppState(null)).toBeNull();
    expect(toAppState('nope')).toBeNull();
    expect(toAppState({ modules: [] })).toBeNull();
    expect(toAppState({ cases: [] })).toBeNull();
  });

  it('prefers the forest when a hand-merged file carries both shapes', () => {
    const forest = toAppState(legacy())!;
    const s = toAppState({ ...forest, cases: [{ id: 'legacy-case', name: 'L', rows: 1, hp: 84, x: 0, y: 0 }] })!;
    expect(cases(s).map((c) => c.id)).toEqual(['case-1']);
  });

  it('leaves a healthy state alone', () => {
    const s = toAppState(legacy())!;
    expect(normalizeState(s)).toBe(s);
  });

  it('repairs a hand-edited forest: cycles, dangling parents and bogus pointers', () => {
    const c = (id: string, parentId?: string) => ({
      id,
      name: id,
      ...(parentId ? { parentId } : {}),
      cases: [],
      placed: [],
    });
    const s = normalizeState({
      canvases: [c('a', 'b'), c('b', 'a'), c('orphan', 'ghost'), c('self', 'self')],
      activeId: 'nope',
      primaryId: 'ghost',
      modules: [],
    });
    expect(s.canvases).toHaveLength(4); // nothing is lost
    // Deterministically the first canvas, never the primary: primary must not decide what loads.
    expect(s.activeId).toBe('a');
    expect(s.primaryId).toBe('a');
    expect(s.canvases.find((x) => x.id === 'orphan')!.parentId).toBeUndefined();
    expect(s.canvases.find((x) => x.id === 'self')!.parentId).toBeUndefined();
    // The cycle is broken at its first member rather than left to hang a tree walk.
    expect(ancestorsOf(s.canvases, 'b').map((x) => x.id)).toEqual(['a']);
    expect(ancestorsOf(s.canvases, 'a')).toEqual([]);
  });

  it('keeps what you own when a corrupt save has no canvases', () => {
    const healthy = toAppState(legacy())!;
    const s = normalizeState({ ...healthy, canvases: [] });
    expect(s.canvases).toHaveLength(1);
    expect(s.activeId).toBe(s.canvases[0].id);
    expect(s.primaryId).toBe(s.activeId);
    expect(s.modules.map((m) => m.moduleId).sort()).toEqual(healthy.modules.map((m) => m.moduleId).sort());
  });
});

describe('canvases', () => {
  const base = () => reducer(emptyState, { type: 'importRack', rack, createCase: true });

  it('forks the active canvas, lands on the fork and leaves primary alone', () => {
    const s = base();
    const root = s.canvases[0];
    const f = reducer(s, { type: 'forkCanvas', id: root.id });
    expect(f.canvases).toHaveLength(2);
    expect(f.activeId).toBe(f.canvases[1].id);
    expect(f.primaryId).toBe(s.primaryId);
    expect(f.canvases[1].parentId).toBe(root.id);
    expect(f.canvases[1].name).toBe(`${root.name} fork`);
    // The source canvas and the global pool are untouched, by identity.
    expect(f.canvases[0]).toBe(root);
    expect(f.modules).toBe(s.modules);
  });

  it('deep-copies cases and placed copies with fresh ids', () => {
    const s = base();
    const f = reducer(s, { type: 'forkCanvas', id: s.canvases[0].id });
    const [root, fork] = f.canvases;
    expect(fork.cases).toHaveLength(root.cases.length);
    expect(fork.placed).toHaveLength(root.placed.length);
    const sourceIds = new Set([...root.cases.map((c) => c.id), ...root.placed.map((m) => m.id)]);
    for (const id of [...fork.cases.map((c) => c.id), ...fork.placed.map((m) => m.id)]) {
      expect(sourceIds.has(id)).toBe(false);
    }
    // Every copy sits at the same spot, in the matching case of its own canvas.
    const map = new Map(root.cases.map((c, i) => [c.id, fork.cases[i].id]));
    for (const [i, m] of root.placed.entries()) {
      expect(fork.placed[i].placement).toEqual({ ...m.placement, caseId: map.get(m.placement.caseId) });
    }
    // Cases keep their layout, since only one canvas renders at a time.
    expect(fork.cases.map((c) => [c.x, c.y])).toEqual(root.cases.map((c) => [c.x, c.y]));
  });

  it('does not copy locks into a fork', () => {
    let s = base();
    s = reducer(s, { type: 'setLocked', id: placed(s)[0].id, locked: true });
    const f = reducer(s, { type: 'forkCanvas', id: s.activeId });
    expect(active(f).placed.some((m) => m.locked)).toBe(false);
  });

  it('edits one canvas without touching its fork', () => {
    const s = base();
    const f = reducer(s, { type: 'forkCanvas', id: s.canvases[0].id });
    const root = f.canvases[0];
    const t = reducer(f, { type: 'addCase', name: 'Only here', rows: 1, hp: 84 });
    expect(t.canvases[0]).toBe(root); // the parent is untouched, by identity
    expect(active(t).cases).toHaveLength(root.cases.length + 1);
  });

  it('parents a fork of a fork to the fork, not the root', () => {
    const s = base();
    const f = reducer(s, { type: 'forkCanvas', id: s.canvases[0].id });
    const g = reducer(f, { type: 'forkCanvas', id: f.activeId });
    expect(g.canvases[2].parentId).toBe(f.canvases[1].id);
    expect(g.canvases[2].parentId).not.toBe(s.canvases[0].id);
  });

  it('names a fork explicitly when asked', () => {
    const s = base();
    const f = reducer(s, { type: 'forkCanvas', id: s.canvases[0].id, name: '  Sketch B  ' });
    expect(f.canvases[1].name).toBe('Sketch B');
  });

  it('refuses to fork an unknown canvas', () => {
    const s = base();
    expect(reducer(s, { type: 'forkCanvas', id: 'nope' })).toBe(s);
  });

  it('fails a key check when Canvas gains a field', () => {
    const s = base();
    const f = reducer(s, { type: 'forkCanvas', id: s.canvases[0].id });
    // forkCanvas lists its fields, so a new one has to be handled there deliberately.
    expect(Object.keys(f.canvases[1]).sort()).toEqual(['cases', 'id', 'name', 'parentId', 'placed']);
  });

  it('promotes without moving the canvas in the lineage', () => {
    const s = base();
    const f = reducer(s, { type: 'forkCanvas', id: s.canvases[0].id });
    const p = reducer(f, { type: 'setPrimaryCanvas', id: f.canvases[1].id });
    // The whole forest passes through by reference: no reparenting, no reordering.
    expect(p.canvases).toBe(f.canvases);
    expect(p.activeId).toBe(f.activeId);
    expect(p.primaryId).toBe(f.canvases[1].id);
    expect({ ...p, primaryId: f.primaryId }).toEqual(f);
  });

  it('refuses a promote that changes nothing', () => {
    const s = base();
    expect(reducer(s, { type: 'setPrimaryCanvas', id: s.primaryId })).toBe(s);
    expect(reducer(s, { type: 'setPrimaryCanvas', id: 'nope' })).toBe(s);
  });

  it('undoes and redoes a promote, and spends no step on a redundant one', () => {
    const s = base();
    const f = reducer(s, { type: 'forkCanvas', id: s.canvases[0].id });
    let h: History = { past: [], present: f, future: [] };
    h = historyReducer(h, { type: 'setPrimaryCanvas', id: f.canvases[1].id });
    expect(h.present.primaryId).toBe(f.canvases[1].id);
    h = historyReducer(h, { type: 'undo' });
    expect(h.present.primaryId).toBe(f.primaryId);
    h = historyReducer(h, { type: 'redo' });
    expect(h.present.primaryId).toBe(f.canvases[1].id);
    expect(historyReducer(h, { type: 'setPrimaryCanvas', id: h.present.primaryId }).past).toHaveLength(h.past.length);
  });

  it('keeps primary and active independent', () => {
    const s = base();
    const f = reducer(s, { type: 'forkCanvas', id: s.canvases[0].id });
    expect(f.activeId).not.toBe(f.primaryId); // on the fork, primary still the root
    const back = reducer(f, { type: 'setActiveCanvas', id: f.primaryId });
    expect(back.activeId).toBe(back.primaryId);
    expect(back.canvases).toBe(f.canvases);
    expect(reducer(back, { type: 'setActiveCanvas', id: back.activeId })).toBe(back);
    expect(reducer(back, { type: 'setActiveCanvas', id: 'nope' })).toBe(back);
  });

  it('renames a canvas, refusing a blank or unchanged name', () => {
    const s = base();
    const t = reducer(s, { type: 'renameCanvas', id: s.activeId, name: '  Studio  ' });
    expect(active(t).name).toBe('Studio');
    expect(reducer(t, { type: 'renameCanvas', id: t.activeId, name: 'Studio' })).toBe(t);
    expect(reducer(t, { type: 'renameCanvas', id: t.activeId, name: '   ' })).toBe(t);
    expect(reducer(t, { type: 'renameCanvas', id: 'nope', name: 'X' })).toBe(t);
  });

  // root -> a -> b
  const chain = () => {
    let s = base();
    const root = s.canvases[0].id;
    s = reducer(s, { type: 'forkCanvas', id: root, name: 'a' });
    const a = s.activeId;
    s = reducer(s, { type: 'forkCanvas', id: a, name: 'b' });
    return { s, root, a, b: s.activeId };
  };

  it('reparents the forks of a deleted canvas to its parent', () => {
    const { s, root, a, b } = chain();
    const d = reducer(s, { type: 'deleteCanvas', id: a });
    expect(d.canvases.map((c) => c.id)).toEqual([root, b]);
    expect(d.canvases.find((c) => c.id === b)!.parentId).toBe(root);
  });

  it('makes the forks of a deleted root into roots', () => {
    const { s, root, a } = chain();
    const d = reducer(s, { type: 'deleteCanvas', id: root });
    const child = d.canvases.find((c) => c.id === a)!;
    expect(child.parentId).toBeUndefined();
    // Absent, not undefined, so saved JSON stays free of the field.
    expect('parentId' in child).toBe(false);
  });

  it('drops the cases of a deleted canvas but keeps the pool', () => {
    const { s, a } = chain();
    expect(s.canvases.find((c) => c.id === a)!.placed.length).toBeGreaterThan(0);
    const d = reducer(s, { type: 'deleteCanvas', id: a });
    expect(d.canvases.some((c) => c.id === a)).toBe(false);
    expect(d.modules).toBe(s.modules);
  });

  it('moves active and primary off a deleted canvas, onto its parent', () => {
    const { s, root, a, b } = chain();
    let t = reducer(s, { type: 'setPrimaryCanvas', id: b });
    expect(t.activeId).toBe(b);
    t = reducer(t, { type: 'deleteCanvas', id: b });
    expect(t.activeId).toBe(a);
    expect(t.primaryId).toBe(a);
    // Deleting a root sends whichever pointer was on it to the first remaining canvas.
    const u = reducer(reducer(t, { type: 'setPrimaryCanvas', id: root }), { type: 'deleteCanvas', id: root });
    expect(u.canvases.some((c) => c.id === u.primaryId)).toBe(true);
    expect(u.canvases.some((c) => c.id === u.activeId)).toBe(true);
  });

  it('refuses to delete the last canvas', () => {
    const s = base();
    expect(s.canvases).toHaveLength(1);
    expect(reducer(s, { type: 'deleteCanvas', id: s.activeId })).toBe(s);
    expect(reducer(s, { type: 'deleteCanvas', id: 'nope' })).toBe(s);
  });

  it('removes a module from the pool and from every canvas', () => {
    const s = base();
    const f = reducer(s, { type: 'forkCanvas', id: s.canvases[0].id });
    const maths = f.modules.find((m) => m.name === 'Maths')!;
    expect(allPlaced(f).filter((m) => m.moduleId === maths.moduleId)).toHaveLength(2); // one per canvas
    const gone = reducer(f, { type: 'removeModule', id: maths.id });
    expect(allPlaced(gone).some((m) => m.moduleId === maths.moduleId)).toBe(false);
    expect(gone.modules.some((m) => m.moduleId === maths.moduleId)).toBe(false);
  });

  it('refuses to remove a module locked on a canvas you are not looking at', () => {
    const s = base();
    let f = reducer(s, { type: 'forkCanvas', id: s.canvases[0].id });
    const maths = active(f).placed.find((m) => m.name === 'Maths')!;
    f = reducer(f, { type: 'setLocked', id: maths.id, locked: true });
    // Switch away, so the locked copy is on a canvas that isn't rendered.
    const away = reducer(f, { type: 'setActiveCanvas', id: f.canvases[0].id });
    const poolRecord = away.modules.find((m) => m.moduleId === maths.moduleId)!;
    expect(reducer(away, { type: 'removeModule', id: poolRecord.id })).toBe(away);
  });

  it('coalesces a run of canvas switches into one undo step', () => {
    const s = base();
    const f = reducer(s, { type: 'forkCanvas', id: s.canvases[0].id });
    const g = reducer(f, { type: 'forkCanvas', id: f.canvases[0].id });
    const ids = g.canvases.map((c) => c.id);
    let h: History = { past: [], present: g, future: [] };
    h = historyReducer(h, { type: 'setActiveCanvas', id: ids[0] });
    h = historyReducer(h, { type: 'setActiveCanvas', id: ids[1] });
    h = historyReducer(h, { type: 'setActiveCanvas', id: ids[2] });
    expect(h.past).toHaveLength(1);
    // One undo returns to wherever browsing started.
    h = historyReducer(h, { type: 'undo' });
    expect(h.present.activeId).toBe(g.activeId);
  });

  it('starts a new undo step for an edit made after browsing', () => {
    const s = base();
    const f = reducer(s, { type: 'forkCanvas', id: s.canvases[0].id });
    let h: History = { past: [], present: f, future: [] };
    h = historyReducer(h, { type: 'setActiveCanvas', id: f.canvases[0].id });
    h = historyReducer(h, { type: 'setActiveCanvas', id: f.canvases[1].id });
    expect(h.past).toHaveLength(1);
    h = historyReducer(h, { type: 'addCase', name: 'X', rows: 1, hp: 84 });
    expect(h.past).toHaveLength(2);
  });

  it('places into the active canvas only', () => {
    const s = base();
    const f = reducer(s, { type: 'forkCanvas', id: s.canvases[0].id });
    const t = reducer(f, { type: 'addCase', name: 'New', rows: 1, hp: 84 });
    const target = active(t).cases.at(-1)!;
    const u = reducer(t, { type: 'placeModule', id: t.modules[0].id, placement: { caseId: target.id, row: 1, col: 1 } });
    expect(u.canvases[0]).toBe(f.canvases[0]); // the parent gained nothing
  });
});
