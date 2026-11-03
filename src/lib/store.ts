import { caseSize, rowTypeOf } from './geometry';
import { canPlace } from './placement';
import { allowedRotations, footprintCols, nextRotation } from './rotation';
import type { AppState, CaseItem, CollectionModule, ImportedRack, ModuleItem, Placement, RowType } from './types';

export type Action =
  | { type: 'importRack'; rack: ImportedRack; createCase: boolean }
  | { type: 'importCollection'; modules: CollectionModule[]; source: string }
  | { type: 'addCase'; name: string; rows: number; hp: number }
  | { type: 'updateCase'; id: string; patch: Partial<Omit<CaseItem, 'id'>> }
  | { type: 'deleteCase'; id: string }
  | { type: 'placeModule'; id: string; placement: Placement | null }
  | { type: 'duplicateModule'; id: string }
  | { type: 'setLocked'; id: string; locked: boolean }
  | { type: 'rotateModule'; id: string }
  | { type: 'reorderRow'; caseId: string; fromRow: number; toIndex: number }
  | { type: 'swapRows'; aCaseId: string; aRow: number; bCaseId: string; bRow: number }
  | { type: 'removeModule'; id: string }
  | { type: 'replace'; state: AppState };

export const emptyState: AppState = { cases: [], modules: [] };

const uid = () => crypto.randomUUID();

/** New cases stack below the existing ones. */
function nextCasePosition(cases: CaseItem[]) {
  if (cases.length === 0) return { x: 0, y: 0 };
  const bottom = Math.max(...cases.map((c) => c.y + caseSize(c).h));
  return { x: Math.min(...cases.map((c) => c.x)), y: bottom + 60 };
}

/** True when a placed module no longer fits its case: outside it, or in a row type its rotation doesn't suit. */
export function isOutOfBounds(m: ModuleItem, c: Pick<CaseItem, 'id' | 'rows' | 'hp' | 'rowTypes'>) {
  const p = m.placement;
  if (!p || p.caseId !== c.id) return false;
  const rotation = p.rotation ?? 0;
  return (
    p.row > c.rows ||
    p.col + footprintCols(m, rotation) - 1 > c.hp ||
    !allowedRotations(m, rowTypeOf(c, p.row)).includes(rotation)
  );
}

/** Pads or trims to `rows`; undefined when every row is 3U, so plain cases stay free of the field. */
function normalizeRowTypes(rowTypes: RowType[] | undefined, rows: number): RowType[] | undefined {
  if (!rowTypes) return undefined;
  const out = Array.from({ length: rows }, (_, i) => rowTypes[i] ?? '3U');
  return out.every((t) => t === '3U') ? undefined : out;
}

/** Sends modules that no longer fit a resized case back to the tray. */
function evictOutOfBounds(modules: ModuleItem[], c: CaseItem): ModuleItem[] {
  return modules.map((m) => (isOutOfBounds(m, c) ? { ...m, placement: null } : m));
}

const isLocked = (state: AppState, id: string) => state.modules.some((m) => m.id === id && m.locked);

/** Reorders the rows of one case; the row count never changes. Same state when refused or nothing moves. */
function reorderRow(state: AppState, a: { caseId: string; fromRow: number; toIndex: number }) {
  const c = state.cases.find((x) => x.id === a.caseId);
  if (!c || a.fromRow < 1 || a.fromRow > c.rows || a.toIndex < 1 || a.toIndex > c.rows + 1) return state;

  // Moving down shifts the insertion point up by the removed row.
  const target = a.toIndex > a.fromRow ? a.toIndex - 1 : a.toIndex;
  if (target === a.fromRow) return state;

  const renumber = (row: number) => {
    if (row === a.fromRow) return target;
    if (a.fromRow < target && row > a.fromRow && row <= target) return row - 1;
    if (target < a.fromRow && row >= target && row < a.fromRow) return row + 1;
    return row;
  };

  let blocked = false;
  const modules = state.modules.map((m) => {
    const p = m.placement;
    if (!p || p.caseId !== c.id) return m;
    const row = renumber(p.row);
    if (row === p.row) return m;
    if (m.locked) blocked = true;
    return { ...m, placement: { ...p, row } };
  });
  if (blocked) return state;

  const types = Array.from({ length: c.rows }, (_, i) => rowTypeOf(c, i + 1));
  const [moved] = types.splice(a.fromRow - 1, 1);
  types.splice(target - 1, 0, moved);
  const cases = state.cases.map((x) => (x.id === c.id ? { ...c, rowTypes: normalizeRowTypes(types, c.rows) } : x));
  return { cases, modules };
}

/**
 * Trades the modules of two rows, in one case or in two cases of the same width. Rows are fixed slots, so no case
 * changes size: swapping with an empty row moves the modules and leaves a blank row behind. The rows must be the
 * same type (a 1U row can't become 3U). Same state when refused, when a row holds a locked module, or both are empty.
 */
function swapRows(state: AppState, a: { aCaseId: string; aRow: number; bCaseId: string; bRow: number }) {
  const ca = state.cases.find((c) => c.id === a.aCaseId);
  const cb = state.cases.find((c) => c.id === a.bCaseId);
  if (!ca || !cb || ca.hp !== cb.hp) return state;
  if (a.aRow < 1 || a.aRow > ca.rows || a.bRow < 1 || a.bRow > cb.rows) return state;
  if (ca.id === cb.id && a.aRow === a.bRow) return state;
  if (rowTypeOf(ca, a.aRow) !== rowTypeOf(cb, a.bRow)) return state;

  let moved = false;
  let blocked = false;
  const modules = state.modules.map((m) => {
    const p = m.placement;
    if (!p) return m;
    let placement: Placement | null = null;
    if (p.caseId === ca.id && p.row === a.aRow) placement = { ...p, caseId: cb.id, row: a.bRow };
    else if (p.caseId === cb.id && p.row === a.bRow) placement = { ...p, caseId: ca.id, row: a.aRow };
    if (!placement) return m;
    moved = true;
    if (m.locked) blocked = true;
    return { ...m, placement };
  });
  return moved && !blocked ? { ...state, modules } : state;
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'importRack': {
      const { rack } = action;
      const newCase: CaseItem | null = action.createCase
        ? { id: uid(), name: rack.name, rows: rack.rows, hp: rack.hp, ...nextCasePosition(state.cases) }
        : null;
      const added: ModuleItem[] = [];
      for (const m of rack.modules) {
        const item: ModuleItem = {
          id: uid(),
          moduleId: m.moduleId,
          versionId: m.versionId,
          name: m.name,
          vendor: m.vendor,
          description: m.description,
          slug: m.slug,
          hp: m.hp,
          depth: m.depth,
          is1u: m.is1u,
          power: m.power,
          source: rack.name,
          placement: null,
        };
        if (newCase && m.inBounds && canPlace(added, newCase, item, { row: m.row, col: m.col })) {
          item.placement = { caseId: newCase.id, row: m.row, col: m.col };
        }
        added.push(item);
      }
      return {
        cases: newCase ? [...state.cases, newCase] : state.cases,
        modules: [...state.modules, ...added],
      };
    }
    case 'importCollection': {
      // The collection has no quantities, so a module already in the app counts as owned.
      const have = new Set(state.modules.map((m) => m.slug));
      const added: ModuleItem[] = [];
      for (const m of action.modules) {
        if (have.has(m.slug)) continue;
        have.add(m.slug);
        added.push({ ...m, id: uid(), source: action.source, placement: null });
      }
      return added.length ? { ...state, modules: [...state.modules, ...added] } : state;
    }
    case 'addCase': {
      const c: CaseItem = {
        id: uid(),
        name: action.name,
        rows: action.rows,
        hp: action.hp,
        ...nextCasePosition(state.cases),
      };
      return { ...state, cases: [...state.cases, c] };
    }
    case 'updateCase': {
      const existing = state.cases.find((c) => c.id === action.id);
      if (!existing) return state;
      const merged = { ...existing, ...action.patch };
      const updated = { ...merged, rowTypes: normalizeRowTypes(merged.rowTypes, merged.rows) };
      // A resize may not push a locked module out of the case.
      if (state.modules.some((m) => m.locked && isOutOfBounds(m, updated))) return state;
      // Moving a case raises it above the others.
      const moved = action.patch.x !== undefined || action.patch.y !== undefined;
      const others = state.cases.filter((c) => c.id !== action.id);
      return {
        cases: moved ? [...others, updated] : state.cases.map((c) => (c.id === action.id ? updated : c)),
        modules: evictOutOfBounds(state.modules, updated),
      };
    }
    case 'deleteCase':
      return {
        cases: state.cases.filter((c) => c.id !== action.id),
        modules: state.modules.map((m) =>
          m.placement?.caseId === action.id ? { ...m, placement: null, locked: false } : m,
        ),
      };
    case 'placeModule':
      if (isLocked(state, action.id)) return state;
      return {
        ...state,
        modules: state.modules.map((m) => (m.id === action.id ? { ...m, placement: action.placement } : m)),
      };
    case 'duplicateModule': {
      const original = state.modules.find((m) => m.id === action.id);
      if (!original) return state;
      return { ...state, modules: [...state.modules, { ...original, id: uid(), placement: null, locked: false }] };
    }
    case 'setLocked':
      return {
        ...state,
        modules: state.modules.map((m) =>
          m.id === action.id && (m.placement || !action.locked) ? { ...m, locked: action.locked } : m,
        ),
      };
    case 'rotateModule': {
      const m = state.modules.find((x) => x.id === action.id);
      const p = m?.placement;
      if (!m || !p || m.locked) return state;
      const c = state.cases.find((x) => x.id === p.caseId);
      if (!c) return state;
      const current = p.rotation ?? 0;
      const rotation = nextRotation(m, rowTypeOf(c, p.row), current);
      if (rotation === current) return state;
      return {
        ...state,
        modules: state.modules.map((x) => (x.id === m.id ? { ...x, placement: { ...p, rotation } } : x)),
      };
    }
    case 'reorderRow':
      return reorderRow(state, action);
    case 'swapRows':
      return swapRows(state, action);
    case 'removeModule':
      if (isLocked(state, action.id)) return state;
      return { ...state, modules: state.modules.filter((m) => m.id !== action.id) };
    case 'replace':
      return action.state;
  }
}

// --- undo/redo -------------------------------------------------------------

export interface History {
  past: AppState[];
  present: AppState;
  future: AppState[];
}

export type HistoryAction = Action | { type: 'undo' } | { type: 'redo' };

const HISTORY_LIMIT = 100;

export function historyReducer(h: History, action: HistoryAction): History {
  if (action.type === 'undo') {
    if (h.past.length === 0) return h;
    return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
  }
  if (action.type === 'redo') {
    if (h.future.length === 0) return h;
    return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
  }
  const next = reducer(h.present, action);
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

// --- persistence -----------------------------------------------------------

const STORAGE_KEY = 'rack-canvas:v1';

export function isAppState(value: unknown): value is AppState {
  const v = value as AppState;
  return !!v && Array.isArray(v.cases) && Array.isArray(v.modules);
}

export function loadState(): AppState {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return isAppState(parsed) ? parsed : emptyState;
  } catch {
    return emptyState;
  }
}

export function saveState(state: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable; export still works.
  }
}
