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
