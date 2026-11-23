import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ancestorsOf } from '../src/lib/lineage';
import { emptyState, freshState, loadState, normalizeState, reducer, saveState, toAppState } from '../src/lib/store';
import type { AppState } from '../src/lib/types';

/** A minimal localStorage. `failWrites` stands in for a full quota. */
function stubStorage(seed: Record<string, string> = {}, failWrites = false) {
  const store = new Map(Object.entries(seed));
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failWrites) throw new Error('QuotaExceededError');
      store.set(k, v);
    },
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  return store;
}

const legacyJson = readFileSync(new URL('./fixtures/sample-1u-state.json', import.meta.url), 'utf8');

describe('persistence', () => {
  it('reads a pre-canvas save, migrates it, and never writes back to the old key', () => {
    const store = stubStorage({ 'rack-canvas:v1': legacyJson });
    const s = loadState();
    expect(s.canvases).toHaveLength(1);
    expect(s.canvases[0].name).toBe('Main');
    expect(s.canvases[0].cases.map((c) => c.id)).toEqual(['case-1']);
    expect(s.canvases[0].placed.map((m) => m.id)).toEqual(['m-wide']);

    expect(saveState(s)).toBe(true);
    // v1 is left byte-for-byte as it was, so rolling back to a build that reads it is lossless.
    expect(store.get('rack-canvas:v1')).toBe(legacyJson);
    expect(JSON.parse(store.get('rack-canvas:v2')!).canvases).toHaveLength(1);
  });

  it('prefers the current key when both are present', () => {
    const v2: AppState = {
      canvases: [{ id: 'new', name: 'From v2', cases: [], placed: [] }],
      activeId: 'new',
      primaryId: 'new',
      modules: [],
    };
    stubStorage({ 'rack-canvas:v1': legacyJson, 'rack-canvas:v2': JSON.stringify(v2) });
    expect(loadState().canvases[0].name).toBe('From v2');
  });

  it('falls through to the old key when the current save is unreadable', () => {
    stubStorage({ 'rack-canvas:v1': legacyJson, 'rack-canvas:v2': '{ not json' });
    expect(loadState().canvases[0].cases.map((c) => c.id)).toEqual(['case-1']);
  });

  it('round-trips a forked forest through a save and a load', () => {
    stubStorage();
    let s = reducer(emptyState, { type: 'addCase', name: 'A', rows: 1, hp: 84 });
    s = reducer(s, { type: 'forkCanvas', id: s.activeId, name: 'Sketch' });
    s = reducer(s, { type: 'setPrimaryCanvas', id: s.canvases[1].id });
    expect(saveState(s)).toBe(true);

    const back = loadState();
    expect(back.canvases.map((c) => c.name)).toEqual(['Main', 'Sketch']);
    expect(back.canvases[1].parentId).toBe(back.canvases[0].id);
    expect(back.primaryId).toBe(back.canvases[1].id);
    expect(back.activeId).toBe(s.activeId);
    // The fork carries its own copy of the case, and a root stays free of the parentId field.
    expect(back.canvases[1].cases).toHaveLength(1);
    expect(back.canvases[1].cases[0].id).not.toBe(back.canvases[0].cases[0].id);
    expect('parentId' in back.canvases[0]).toBe(false);
  });

  it('falls back to a fresh state when nothing is stored or the save is corrupt', () => {
    stubStorage();
    expect(loadState().canvases).toHaveLength(1);
    stubStorage({ 'rack-canvas:v2': '{ not json' });
    expect(loadState().canvases).toHaveLength(1);
    stubStorage({ 'rack-canvas:v2': '{"nope":true}' });
    expect(loadState().canvases).toHaveLength(1);
  });

  it('reports a failed write instead of dropping it silently', () => {
    stubStorage({}, true);
    expect(saveState(freshState())).toBe(false);
  });
});

// Regression tests for bugs found by the bug hunt. Each one failed before the corresponding fix.
describe('malformed and legacy save repair', () => {
  const mod = (moduleId: string, extra: Record<string, unknown> = {}) => ({
    id: `rec-${moduleId}`, moduleId, versionId: null, name: moduleId, vendor: 'V',
    description: '', slug: moduleId, hp: 4, is1u: false,
    power: { plus12: 0, minus12: 0, plus5: 0 }, source: 'test', ...extra,
  });

  it('keeps a module you own when its only copy sat in a case that is gone', () => {
    // The placed copy must be dropped (its case does not exist) WITHOUT costing you the module.
    const s = toAppState({
      cases: [{ id: 'other-case', name: 'C', rows: 1, hp: 84, x: 0, y: 0 }],
      modules: [
        mod('mod-expensive', { placement: { caseId: 'case-that-vanished', row: 1, col: 1 } }),
        mod('mod-fine', { placement: null }),
      ],
    })!;
    expect(s.canvases[0].placed).toHaveLength(0);
    expect(s.modules.map((m) => m.moduleId).sort()).toEqual(['mod-expensive', 'mod-fine']);
    expect(s.modules.every((m) => m.placement === null)).toBe(true);
  });

  it('treats a module with no placement field as unplaced, not as both', () => {
    const s = toAppState({ cases: [], modules: [mod('mod-nokey')] })!;
    expect(s.canvases[0].placed).toHaveLength(0);
    expect(s.modules.map((m) => m.moduleId)).toEqual(['mod-nokey']);
    expect(s.modules[0].placement).toBeNull();
  });

  it('loads the valid rest of a save that contains one malformed module', () => {
    const store = stubStorage({ 'rack-canvas:v1': JSON.stringify({
      cases: [{ id: 'c1', name: 'Keep me', rows: 1, hp: 84, x: 0, y: 0 }],
      modules: [mod('good-1', { placement: null }), mod('good-2', { placement: null }), mod('bad')],
    }) });
    const s = loadState();
    expect(s.canvases[0].cases.map((c) => c.name)).toEqual(['Keep me']);
    expect(s.modules.map((m) => m.moduleId).sort()).toEqual(['bad', 'good-1', 'good-2']);
    expect(store.size).toBe(1);
  });

  it('drops only the unrenderable canvases from a corrupt forest', () => {
    const good = { id: 'keep', name: 'Keep', cases: [], placed: [] };
    const s = toAppState({
      canvases: [null, { id: 'half', name: 'Half' }, good],
      activeId: 'keep', primaryId: 'keep', modules: [],
    })!;
    expect(s.canvases.map((c) => c.id)).toEqual(['keep']);
    expect(s.activeId).toBe('keep');
    expect(s.primaryId).toBe('keep');
  });

  it('cuts only the cycle edge, leaving real lineage below it intact', () => {
    // d <- e <- a, with a <-> b a cycle. d and e are listed BEFORE the cycle's own members.
    const cv = (id: string, parentId?: string) => ({ id, name: id, ...(parentId ? { parentId } : {}), cases: [], placed: [] });
    const s = normalizeState({
      canvases: [cv('d', 'e'), cv('e', 'a'), cv('a', 'b'), cv('b', 'a')],
      activeId: 'd', primaryId: 'd', modules: [],
    });
    const parents = Object.fromEntries(s.canvases.map((c) => [c.id, c.parentId ?? null]));
    expect(parents).toEqual({ d: 'e', e: 'a', a: null, b: 'a' });
    // The cycle really is gone: walking up from every canvas terminates.
    for (const c of s.canvases) expect(ancestorsOf(s.canvases, c.id).length).toBeLessThan(s.canvases.length);
  });
});
