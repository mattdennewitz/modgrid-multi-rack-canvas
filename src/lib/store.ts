import { caseSize, rowTypeOf } from './geometry';
import { canPlace } from './placement';
import { allowedRotations, footprintCols, nextRotation } from './rotation';
import type {
  AppState,
  Canvas,
  CaseItem,
  CollectionModule,
  ImportedRack,
  LegacyAppState,
  ModuleItem,
  PlacedModule,
  Placement,
  RowType,
} from './types';

export type Action =
  | { type: 'importRack'; rack: ImportedRack; createCase: boolean }
  | { type: 'importCollection'; modules: CollectionModule[]; source: string }
  | { type: 'duplicateCase'; id: string }
  | { type: 'addCase'; name: string; rows: number; hp: number }
  | { type: 'updateCase'; id: string; patch: Partial<Omit<CaseItem, 'id'>> }
  | { type: 'deleteCase'; id: string }
  | { type: 'placeModule'; id: string; placement: Placement | null }
  | { type: 'placeModules'; placements: { id: string; placement: Placement }[] }
  | { type: 'setLocked'; id: string; locked: boolean }
  | { type: 'rotateModule'; id: string }
  | { type: 'reorderRow'; caseId: string; fromRow: number; toIndex: number }
  | { type: 'swapRows'; aCaseId: string; aRow: number; bCaseId: string; bRow: number }
  | { type: 'removeModule'; id: string }
  | { type: 'forkCanvas'; id: string; name?: string }
  | { type: 'setActiveCanvas'; id: string }
  | { type: 'setPrimaryCanvas'; id: string }
  | { type: 'renameCanvas'; id: string; name: string }
  | { type: 'deleteCanvas'; id: string }
  | { type: 'replace'; state: AppState };

export const uid = () => crypto.randomUUID();

export const newCanvas = (name: string): Canvas => ({ id: uid(), name, cases: [], placed: [] });

/** A brand new app: one empty canvas, which is both active and primary, and nothing owned. */
export function freshState(): AppState {
  const canvas = newCanvas('Main');
  return { canvases: [canvas], activeId: canvas.id, primaryId: canvas.id, modules: [] };
}

export const emptyState: AppState = freshState();

/** A usable record: enough of one to read and render. Anything else in a hand-edited save is dropped, not trusted. */
const isRecord = (m: ModuleItem): boolean => !!m && typeof m === 'object' && typeof m.moduleId === 'string';

/**
 * A record counts as placed only when it carries a usable placement. A missing or malformed `placement` reads as
 * unplaced, so one bad entry in an old or hand-edited save leaves the module in the pool instead of failing the load.
 */
const isPlaced = (m: ModuleItem): m is PlacedModule =>
  !!m.placement && typeof m.placement === 'object' && typeof m.placement.caseId === 'string';

/** A canvas we could actually render: the fields every consumer dereferences. */
const isCanvas = (c: Canvas): boolean =>
  !!c && typeof c === 'object' && typeof c.id === 'string' && Array.isArray(c.cases) && Array.isArray(c.placed);

/** The canvas being viewed. `activeId` is kept valid, so this never returns undefined. */
export const activeCanvas = (s: AppState): Canvas => s.canvases.find((c) => c.id === s.activeId) ?? s.canvases[0];

/** Every placed copy in the app, for pool-wide work like `removeModule`. */
export const allPlaced = (s: AppState): PlacedModule[] => s.canvases.flatMap((c) => c.placed);

/**
 * Applies `fn` to the active canvas. Returns the same state object when `fn` returns the same canvas, so the refusal
 * idiom (`reducer(s, a) === s`) survives one level down and `historyReducer` still skips refusals.
 */
function inActive(state: AppState, fn: (c: Canvas) => Canvas): AppState {
  const i = state.canvases.findIndex((c) => c.id === state.activeId);
  if (i < 0) return state;
  const next = fn(state.canvases[i]);
  if (next === state.canvases[i]) return state;
  const canvases = [...state.canvases];
  canvases[i] = next;
  return { ...state, canvases };
}

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

/** Drops placed copies that no longer fit a resized case. The pool is untouched; only the placement goes. */
const evictOutOfBounds = (placed: PlacedModule[], c: CaseItem): PlacedModule[] =>
  placed.filter((m) => !isOutOfBounds(m, c));

/** Reorders the rows of one case; the row count never changes. Same canvas when refused or nothing moves. */
function reorderRow(canvas: Canvas, a: { caseId: string; fromRow: number; toIndex: number }): Canvas {
  const c = canvas.cases.find((x) => x.id === a.caseId);
  if (!c || a.fromRow < 1 || a.fromRow > c.rows || a.toIndex < 1 || a.toIndex > c.rows + 1) return canvas;

  // Moving down shifts the insertion point up by the removed row.
  const target = a.toIndex > a.fromRow ? a.toIndex - 1 : a.toIndex;
  if (target === a.fromRow) return canvas;

  const renumber = (row: number) => {
    if (row === a.fromRow) return target;
    if (a.fromRow < target && row > a.fromRow && row <= target) return row - 1;
    if (target < a.fromRow && row >= target && row < a.fromRow) return row + 1;
    return row;
  };

  let blocked = false;
  const placed = canvas.placed.map((m) => {
    const p = m.placement;
    if (p.caseId !== c.id) return m;
    const row = renumber(p.row);
    if (row === p.row) return m;
    if (m.locked) blocked = true;
    return { ...m, placement: { ...p, row } };
  });
  if (blocked) return canvas;

  const types = Array.from({ length: c.rows }, (_, i) => rowTypeOf(c, i + 1));
  const [moved] = types.splice(a.fromRow - 1, 1);
  types.splice(target - 1, 0, moved);
  const cases = canvas.cases.map((x) => (x.id === c.id ? { ...c, rowTypes: normalizeRowTypes(types, c.rows) } : x));
  return { ...canvas, cases, placed };
}

/**
 * Trades the modules of two rows, in one case or in two cases of the same width on the same canvas. Rows are fixed
 * slots, so no case changes size: swapping with an empty row moves the modules and leaves a blank row behind. The rows
 * must be the same type (a 1U row can't become 3U). Same canvas when refused, when a row holds a locked module, or
 * both are empty.
 */
function swapRows(canvas: Canvas, a: { aCaseId: string; aRow: number; bCaseId: string; bRow: number }): Canvas {
  const ca = canvas.cases.find((c) => c.id === a.aCaseId);
  const cb = canvas.cases.find((c) => c.id === a.bCaseId);
  if (!ca || !cb || ca.hp !== cb.hp) return canvas;
  if (a.aRow < 1 || a.aRow > ca.rows || a.bRow < 1 || a.bRow > cb.rows) return canvas;
  if (ca.id === cb.id && a.aRow === a.bRow) return canvas;
  if (rowTypeOf(ca, a.aRow) !== rowTypeOf(cb, a.bRow)) return canvas;

  let moved = false;
  let blocked = false;
  const placed = canvas.placed.map((m) => {
    const p = m.placement;
    let placement: Placement | null = null;
    if (p.caseId === ca.id && p.row === a.aRow) placement = { ...p, caseId: cb.id, row: a.bRow };
    else if (p.caseId === cb.id && p.row === a.bRow) placement = { ...p, caseId: ca.id, row: a.aRow };
    if (!placement) return m;
    moved = true;
    if (m.locked) blocked = true;
    return { ...m, placement };
  });
  return moved && !blocked ? { ...canvas, placed } : canvas;
}

/**
 * Inventory model: `AppState.modules` is the pool — one record per module you own, never placed and never used up. A
 * module can sit in any number of cases on any number of canvases; each spot is a `PlacedModule` in that canvas's
 * `placed`, cloned from the pool record. So the tray is the pool, placing clones, taking a module out of a case
 * deletes that copy, and only adding to or removing from the pool changes what you own. The pool is global: forking a
 * canvas copies placed copies and never touches it.
 */

/** A fresh pool record for a module, copied from any record of it. */
const inventoryRecord = (m: ModuleItem): ModuleItem => ({ ...m, id: uid(), placement: null, locked: false });

/**
 * Restores the pool invariants across the whole forest: exactly one record per `moduleId`, never placed or locked, and
 * one for every module placed in any canvas (old saves kept one record per unit). Also drops placed copies whose case
 * is gone from their canvas. Same object when nothing changes, at both levels.
 */
export function normalizeInventory(state: AppState): AppState {
  let canvasesChanged = false;
  const canvases = state.canvases.map((c) => {
    const caseIds = new Set(c.cases.map((x) => x.id));
    const placed = c.placed.filter((m) => isRecord(m) && isPlaced(m) && caseIds.has(m.placement.caseId));
    if (placed.length === c.placed.length) return c;
    canvasesChanged = true;
    return { ...c, placed };
  });

  const seen = new Set<string>();
  const pool: ModuleItem[] = [];
  for (const m of state.modules) {
    if (!isRecord(m) || seen.has(m.moduleId)) continue;
    seen.add(m.moduleId);
    // `!== null` rather than a truthiness test, so a `placement` of undefined is repaired to null too.
    pool.push(m.placement !== null || m.locked ? inventoryRecord(m) : m);
  }
  // Backfilled from the ORIGINAL canvases, not the filtered ones: a copy dropped just above was perhaps the module's
  // only record anywhere, and dropping its case must never cost you the module itself.
  for (const c of state.canvases) {
    for (const m of c.placed) {
      if (!isRecord(m) || seen.has(m.moduleId)) continue;
      seen.add(m.moduleId);
      pool.push(inventoryRecord(m));
    }
  }

  const poolChanged = pool.length !== state.modules.length || pool.some((m, i) => m !== state.modules[i]);
  if (!canvasesChanged && !poolChanged) return state;
  return { ...state, canvases, modules: pool };
}

/** `parentId` is absent on roots rather than null, so roots stay free of the field in saved JSON. */
function reparent(c: Canvas, parentId: string | undefined): Canvas {
  const next = { ...c };
  if (parentId) next.parentId = parentId;
  else delete next.parentId;
  return next;
}

/**
 * Repairs the lineage forest and the two pointers: a canvas always exists, no canvas parents itself or a missing
 * canvas, no cycles, and `activeId`/`primaryId` name real canvases. Same object when nothing changes.
 */
export function normalizePrimary(state: AppState): AppState {
  // Drop entries nothing could render, so one malformed canvas can't fail the whole load, and never fall back to
  // freshState(), which would discard the module pool.
  const usable = state.canvases.filter(isCanvas);
  const base = usable.length ? usable : [newCanvas('Main')];
  const ids = new Set(base.map((c) => c.id));

  // A dangling or self parent makes a root.
  const parent = new Map(
    base.map((c) => [c.id, c.parentId === undefined || c.parentId === c.id || !ids.has(c.parentId) ? undefined : c.parentId]),
  );

  // Cut exactly one edge per cycle, and only from a canvas that is itself ON the cycle. A canvas merely descended
  // from one keeps its own parent, which is a real, existing canvas and not the cycle's fault.
  for (const c of base) {
    const seen = new Set<string>([c.id]);
    let at = parent.get(c.id);
    while (at !== undefined) {
      if (at === c.id) {
        parent.set(c.id, undefined);
        break;
      }
      if (seen.has(at)) break; // a cycle further up the chain; not this canvas's edge to cut
      seen.add(at);
      at = parent.get(at);
    }
  }

  let changed = usable.length !== state.canvases.length || usable.length === 0;
  const canvases = base.map((c) => {
    const parentId = parent.get(c.id);
    if (parentId === c.parentId) return c;
    changed = true;
    return reparent(c, parentId);
  });

  // Deterministically the first canvas, never the primary: primary must not decide which canvas loads.
  const activeId = ids.has(state.activeId) ? state.activeId : canvases[0].id;
  const primaryId = ids.has(state.primaryId) ? state.primaryId : canvases[0].id;
  if (!changed && activeId === state.activeId && primaryId === state.primaryId) return state;
  return { ...state, canvases, activeId, primaryId };
}

export const normalizeState = (s: AppState): AppState => normalizeInventory(normalizePrimary(s));

/**
 * Copies a case beside the originals on the same canvas, modules included: every module in the source case is placed
 * again at the same spot, rotation and all. The pool is untouched, since a module can be in any number of cases.
 * Locks aren't copied.
 */
export function duplicateCase(canvas: Canvas, id: string): { canvas: Canvas; copied: number } {
  const source = canvas.cases.find((c) => c.id === id);
  if (!source) return { canvas, copied: 0 };
  const copy: CaseItem = { ...source, id: uid(), name: `${source.name} copy`, ...nextCasePosition(canvas.cases) };
  const units: PlacedModule[] = canvas.placed
    .filter((m) => m.placement.caseId === source.id)
    .map((m) => ({ ...m, id: uid(), locked: false, placement: { ...m.placement, caseId: copy.id } }));
  return {
    canvas: { ...canvas, cases: [...canvas.cases, copy], placed: [...canvas.placed, ...units] },
    copied: units.length,
  };
}

/**
 * A deep copy of a canvas, recorded as its child. Cases and placed copies get fresh ids, so ids stay unique app-wide
 * and the two canvases can never interfere. The global module pool is not touched. Locks aren't copied.
 *
 * The fields are listed rather than spread, so adding one to `Canvas` is a type error right here instead of a
 * reference silently shared between a canvas and its fork.
 */
export function forkCanvas(source: Canvas, name: string): Canvas {
  const caseIds = new Map(source.cases.map((c) => [c.id, uid()]));
  return {
    id: uid(),
    name,
    parentId: source.id,
    // Order is preserved: it is the fork's z-order too. Cases keep x/y, since only one canvas renders at a time.
    cases: source.cases.map((c) => ({ ...c, id: caseIds.get(c.id)! })),
    placed: source.placed.map((m) => ({
      ...m,
      id: uid(),
      locked: false,
      placement: { ...m.placement, caseId: caseIds.get(m.placement.caseId)! },
    })),
  };
}

/** Deletes a canvas, moving its forks up to its parent so the lineage stays connected. The pool is untouched. */
function deleteCanvas(state: AppState, id: string): AppState {
  if (state.canvases.length < 2) return state; // the app always has a canvas
  const gone = state.canvases.find((c) => c.id === id);
  if (!gone) return state;
  // Children move up to the deleted canvas's parent; a deleted root's children become roots.
  const canvases = state.canvases
    .filter((c) => c.id !== id)
    .map((c) => (c.parentId === id ? reparent(c, gone.parentId) : c));
  const fallback = (current: string) =>
    current !== id
      ? current
      : gone.parentId && canvases.some((c) => c.id === gone.parentId)
        ? gone.parentId
        : canvases[0].id;
  return { ...state, canvases, activeId: fallback(state.activeId), primaryId: fallback(state.primaryId) };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'importRack': {
      const { rack } = action;
      const canvas = activeCanvas(state);
      const newCase: CaseItem | null = action.createCase
        ? { id: uid(), name: rack.name, rows: rack.rows, hp: rack.hp, ...nextCasePosition(canvas.cases) }
        : null;
      // Modules you already own aren't added twice; the case just places them again.
      const owned = new Set(state.modules.map((m) => m.moduleId));
      const added: ModuleItem[] = [];
      const placed: PlacedModule[] = [];
      for (const m of rack.modules) {
        const record: ModuleItem = {
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
        if (!owned.has(m.moduleId)) {
          owned.add(m.moduleId);
          added.push(record);
        }
        if (newCase && m.inBounds && canPlace(placed, newCase, record, { row: m.row, col: m.col })) {
          placed.push({ ...record, id: uid(), placement: { caseId: newCase.id, row: m.row, col: m.col } });
        }
      }
      const next: Canvas = {
        ...canvas,
        cases: newCase ? [...canvas.cases, newCase] : canvas.cases,
        placed: [...canvas.placed, ...placed],
      };
      return {
        ...state,
        canvases: state.canvases.map((c) => (c.id === canvas.id ? next : c)),
        // Keep the very same array when you already owned everything, so "the pool didn't change" stays provable.
        modules: added.length ? [...state.modules, ...added] : state.modules,
      };
    }
    case 'importCollection': {
      // A collection lists each module once, and so does the pool.
      const have = new Set(state.modules.flatMap((m) => [m.slug, m.moduleId]));
      const added: ModuleItem[] = [];
      for (const m of action.modules) {
        if (have.has(m.slug) || have.has(m.moduleId)) continue;
        have.add(m.slug);
        have.add(m.moduleId);
        added.push({ ...m, id: uid(), source: action.source, placement: null });
      }
      return added.length ? { ...state, modules: [...state.modules, ...added] } : state;
    }
    case 'duplicateCase':
      return inActive(state, (c) => duplicateCase(c, action.id).canvas);
    case 'addCase':
      return inActive(state, (c) => ({
        ...c,
        cases: [
          ...c.cases,
          { id: uid(), name: action.name, rows: action.rows, hp: action.hp, ...nextCasePosition(c.cases) },
        ],
      }));
    case 'updateCase':
      return inActive(state, (canvas) => {
        const existing = canvas.cases.find((c) => c.id === action.id);
        if (!existing) return canvas;
        const merged = { ...existing, ...action.patch };
        const updated = { ...merged, rowTypes: normalizeRowTypes(merged.rowTypes, merged.rows) };
        // A resize may not push a locked module out of the case.
        if (canvas.placed.some((m) => m.locked && isOutOfBounds(m, updated))) return canvas;
        // Moving a case raises it above the others.
        const moved = action.patch.x !== undefined || action.patch.y !== undefined;
        const others = canvas.cases.filter((c) => c.id !== action.id);
        return {
          ...canvas,
          cases: moved ? [...others, updated] : canvas.cases.map((c) => (c.id === action.id ? updated : c)),
          placed: evictOutOfBounds(canvas.placed, updated),
        };
      });
    case 'deleteCase':
      // The modules stay in the pool; their placements go with the case.
      return inActive(state, (c) =>
        c.cases.some((x) => x.id === action.id)
          ? {
              ...c,
              cases: c.cases.filter((x) => x.id !== action.id),
              placed: c.placed.filter((m) => m.placement.caseId !== action.id),
            }
          : c,
      );
    case 'placeModule': {
      const pooled = state.modules.find((x) => x.id === action.id);
      if (pooled) {
        // From the pool: the record stays there and a copy is placed on the active canvas.
        if (!action.placement) return state;
        const placement = action.placement;
        return inActive(state, (c) => ({
          ...c,
          placed: [...c.placed, { ...pooled, id: uid(), locked: false, placement }],
        }));
      }
      return inActive(state, (c) => {
        const m = c.placed.find((x) => x.id === action.id);
        if (!m || m.locked) return c;
        // A placed copy moves, or is taken out of the case (deleted; the pool record remains).
        if (!action.placement) return { ...c, placed: c.placed.filter((x) => x.id !== m.id) };
        const placement = action.placement;
        return { ...c, placed: c.placed.map((x) => (x.id === m.id ? { ...x, placement } : x)) };
      });
    }
    case 'placeModules':
      // Moves only, in one action so a swap is a single undo step.
      return inActive(state, (c) => {
        const byId = new Map(action.placements.map((p) => [p.id, p.placement]));
        const targets = c.placed.filter((m) => byId.has(m.id));
        if (targets.length !== byId.size || targets.some((m) => m.locked)) return c;
        return { ...c, placed: c.placed.map((m) => (byId.has(m.id) ? { ...m, placement: byId.get(m.id)! } : m)) };
      });
    case 'setLocked':
      // Only a placed copy can be locked; a pool record has nothing to lock.
      return inActive(state, (c) => {
        const m = c.placed.find((x) => x.id === action.id);
        if (!m || (m.locked ?? false) === action.locked) return c;
        return { ...c, placed: c.placed.map((x) => (x.id === m.id ? { ...x, locked: action.locked } : x)) };
      });
    case 'rotateModule':
      return inActive(state, (canvas) => {
        const m = canvas.placed.find((x) => x.id === action.id);
        if (!m || m.locked) return canvas;
        const c = canvas.cases.find((x) => x.id === m.placement.caseId);
        if (!c) return canvas;
        const current = m.placement.rotation ?? 0;
        const rotation = nextRotation(m, rowTypeOf(c, m.placement.row), current);
        if (rotation === current) return canvas;
        return {
          ...canvas,
          placed: canvas.placed.map((x) => (x.id === m.id ? { ...x, placement: { ...x.placement, rotation } } : x)),
        };
      });
    case 'reorderRow':
      return inActive(state, (c) => reorderRow(c, action));
    case 'swapRows':
      return inActive(state, (c) => swapRows(c, action));
    case 'removeModule': {
      // Removing from the pool also takes the module out of every canvas, unless a copy is locked somewhere.
      const m = state.modules.find((x) => x.id === action.id);
      if (!m) return state;
      if (allPlaced(state).some((x) => x.moduleId === m.moduleId && x.locked)) return state;
      const canvases = state.canvases.map((c) => {
        const placed = c.placed.filter((x) => x.moduleId !== m.moduleId);
        return placed.length === c.placed.length ? c : { ...c, placed };
      });
      return { ...state, canvases, modules: state.modules.filter((x) => x.id !== m.id) };
    }
    case 'forkCanvas': {
      const source = state.canvases.find((c) => c.id === action.id);
      if (!source) return state;
      const fork = forkCanvas(source, action.name?.trim() || `${source.name} fork`);
      // You land on the fork. Primary is deliberately left where it was.
      return { ...state, canvases: [...state.canvases, fork], activeId: fork.id };
    }
    case 'setActiveCanvas':
      if (state.activeId === action.id || !state.canvases.some((c) => c.id === action.id)) return state;
      return { ...state, activeId: action.id };
    case 'setPrimaryCanvas':
      // Only the pointer moves: `canvases` and every `parentId` pass through, so nothing shifts in the tree.
      if (state.primaryId === action.id || !state.canvases.some((c) => c.id === action.id)) return state;
      return { ...state, primaryId: action.id };
    case 'renameCanvas': {
      const name = action.name.trim();
      const c = state.canvases.find((x) => x.id === action.id);
      if (!c || !name || c.name === name) return state;
      return { ...state, canvases: state.canvases.map((x) => (x.id === c.id ? { ...x, name } : x)) };
    }
    case 'deleteCanvas':
      return deleteCanvas(state, action.id);
    case 'replace':
      return normalizeState(action.state);
  }
}

// --- undo/redo -------------------------------------------------------------

export interface History {
  past: AppState[];
  present: AppState;
  future: AppState[];
  /** The action that produced `present`, so a run of canvas switches can coalesce into one undo step. */
  last?: HistoryAction['type'];
}

export type HistoryAction = Action | { type: 'undo' } | { type: 'redo' };

const HISTORY_LIMIT = 100;

export function historyReducer(h: History, action: HistoryAction): History {
  if (action.type === 'undo') {
    if (h.past.length === 0) return h;
    return {
      past: h.past.slice(0, -1),
      present: h.past[h.past.length - 1],
      future: [h.present, ...h.future],
      last: action.type,
    };
  }
  if (action.type === 'redo') {
    if (h.future.length === 0) return h;
    return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), last: action.type };
  }
  const next = reducer(h.present, action);
  if (next === h.present) return h;
  // Browsing the forest shouldn't cost one undo step per hop: a run of switches collapses to the first one.
  if (action.type === 'setActiveCanvas' && h.last === 'setActiveCanvas') {
    return { ...h, present: next, future: [], last: action.type };
  }
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [], last: action.type };
}

// --- persistence -----------------------------------------------------------

const STORAGE_KEY = 'rack-canvas:v2';
const LEGACY_STORAGE_KEY = 'rack-canvas:v1';

/** A save written before canvases existed. Kept permissive: this is what lets old files keep loading. */
export function isLegacyState(value: unknown): value is LegacyAppState {
  const v = value as LegacyAppState;
  return !!v && Array.isArray(v.cases) && Array.isArray(v.modules);
}

export function isAppState(value: unknown): value is AppState {
  const v = value as AppState;
  return (
    !!v &&
    Array.isArray(v.canvases) &&
    Array.isArray(v.modules) &&
    typeof v.activeId === 'string' &&
    typeof v.primaryId === 'string'
  );
}

/** A pre-canvas save becomes one root canvas, with the pool lifted out of the mixed `modules` array. */
export function migrateLegacy(v: LegacyAppState): AppState {
  const records = v.modules.filter(isRecord);
  const canvas: Canvas = {
    id: uid(),
    name: 'Main',
    cases: v.cases.filter((c) => !!c && typeof c === 'object' && typeof c.id === 'string'),
    placed: records.filter(isPlaced),
  };
  // Split on the same predicate both ways, so a record with no usable placement lands in the pool and nowhere else.
  return {
    canvases: [canvas],
    activeId: canvas.id,
    primaryId: canvas.id,
    modules: records.filter((m) => !isPlaced(m)),
  };
}

/** Parsed JSON from a save or an exported file, in either format, repaired. Null when it is neither. */
export function toAppState(value: unknown): AppState | null {
  // `canvases` first: a legacy payload never has it, so a hand-merged file carrying both loads as a forest.
  if (isAppState(value)) return normalizeState(value);
  if (isLegacyState(value)) return normalizeState(migrateLegacy(value));
  return null;
}

export function loadState(): AppState {
  for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    try {
      const next = toAppState(JSON.parse(localStorage.getItem(key) ?? 'null'));
      if (next) return next;
    } catch {
      // Unreadable or unparseable; fall through to the next key.
    }
  }
  return freshState();
}

/**
 * Writes only the current key, so rolling back to a build that reads `v1` finds that save intact instead of an empty
 * state it would then overwrite. False when the write failed, so the app can warn once instead of losing work silently.
 */
export function saveState(state: AppState): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
