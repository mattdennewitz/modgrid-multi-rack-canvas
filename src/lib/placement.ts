import { rowTypeOf } from './geometry';
import { allowedRotations, footprintCols, snapRotation } from './rotation';
import type { CaseItem, ModuleItem, Placement, Rotation } from './types';

type Placed = Pick<ModuleItem, 'id' | 'hp' | 'placement'>;

/** Columns a placed module occupies, which is 26 when it lies sideways. */
const placedCols = (m: Placed) => footprintCols(m, m.placement?.rotation);

/** True when `cols` columns fit at row/col without leaving the case or overlapping another module. */
export function fits(
  modules: Placed[],
  c: Pick<CaseItem, 'id' | 'rows' | 'hp'>,
  row: number,
  col: number,
  cols: number,
  excludeId?: string,
): boolean {
  if (row < 1 || row > c.rows || col < 1 || col + cols - 1 > c.hp) return false;
  return !modules.some((m) => {
    const p = m.placement;
    if (!p || m.id === excludeId || p.caseId !== c.id || p.row !== row) return false;
    return col < p.col + placedCols(m) && p.col < col + cols;
  });
}

/** `fits`, plus the rule that the module's rotation must suit the row's type. */
export function canPlace(
  modules: Placed[],
  c: Pick<CaseItem, 'id' | 'rows' | 'hp' | 'rowTypes'>,
  module: Pick<ModuleItem, 'id' | 'hp' | 'is1u'>,
  placement: { row: number; col: number; rotation?: Rotation },
): boolean {
  const rotation = placement.rotation ?? 0;
  if (placement.row < 1 || placement.row > c.rows) return false;
  if (!allowedRotations(module, rowTypeOf(c, placement.row)).includes(rotation)) return false;
  return fits(modules, c, placement.row, placement.col, footprintCols(module, rotation), module.id);
}

/**
 * Finds the free column closest to `col` in the given row, searching outward
 * up to `maxShift` HP in either direction. Returns null when nothing fits.
 */
export function nearestFreeCol(
  modules: Placed[],
  c: Pick<CaseItem, 'id' | 'rows' | 'hp'>,
  row: number,
  col: number,
  cols: number,
  excludeId?: string,
  maxShift = 12,
): number | null {
  for (let d = 0; d <= maxShift; d++) {
    for (const candidate of d === 0 ? [col] : [col - d, col + d]) {
      if (fits(modules, c, row, candidate, cols, excludeId)) return candidate;
    }
  }
  return null;
}

/** Empty stretches of a row, left to right, as { col, hp }. */
export function rowGaps(modules: Placed[], c: Pick<CaseItem, 'id' | 'hp'>, row: number): { col: number; hp: number }[] {
  const inRow = modules
    .filter((m) => m.placement?.caseId === c.id && m.placement.row === row)
    .sort((a, b) => a.placement!.col - b.placement!.col);
  const gaps: { col: number; hp: number }[] = [];
  let next = 1;
  for (const m of inRow) {
    if (m.placement!.col > next) gaps.push({ col: next, hp: m.placement!.col - next });
    next = Math.max(next, m.placement!.col + placedCols(m));
  }
  if (next <= c.hp) gaps.push({ col: next, hp: c.hp - next + 1 });
  return gaps;
}

/** How much of the narrower module's width a drop must cover before it counts as a swap, not a nudge. */
const SWAP_OVERLAP = 0.75;

/** A module that gets bumped into the space a dragged module vacated. */
export interface Swap {
  id: string;
  placement: Placement;
}

/**
 * Plans a swap for a placed module dragged onto others: the modules under it hop into the space the dragged one
 * left, and the dragged one takes the space that frees up. Null unless the drop covers (at least 75% of the narrower
 * one of) an unlocked module, the bumped modules fit the vacated space, and the dragged module then fits where it
 * was dropped. Modules the drop mostly covers are bumped together; one only clipped at the edge is slid clear of, and
 * if bumping them all doesn't work, just the most-covered module is bumped. `col` is where the dragged module lands.
 */
export function planSwap(
  modules: ModuleItem[],
  cases: Pick<CaseItem, 'id' | 'rows' | 'hp' | 'rowTypes'>[],
  dragged: ModuleItem,
  slot: { caseId: string; row: number; col: number; rotation: Rotation },
  maxShift?: number,
): { swaps: Swap[]; col: number } | null {
  const origin = dragged.placement;
  const target = cases.find((c) => c.id === slot.caseId);
  const originCase = origin && cases.find((c) => c.id === origin.caseId);
  if (!origin || !originCase || !target || dragged.locked) return null;

  const cols = footprintCols(dragged, slot.rotation);
  const overlapOf = (m: ModuleItem) =>
    Math.min(slot.col + cols, m.placement!.col + placedCols(m)) - Math.max(slot.col, m.placement!.col);
  const covered = modules
    .filter(
      (m) =>
        m.id !== dragged.id &&
        m.placement?.caseId === target.id &&
        m.placement.row === slot.row &&
        overlapOf(m) > 0,
    )
    .sort((a, b) => a.placement!.col - b.placement!.col);
  if (covered.length === 0 || covered.some((m) => m.locked)) return null;

  const main = covered.reduce((best, m) => (overlapOf(m) > overlapOf(best) ? m : best));
  if (overlapOf(main) < Math.min(cols, placedCols(main)) * SWAP_OVERLAP) return null;

  const originCols = footprintCols(dragged, origin.rotation);
  // `strict` keeps every bumped module inside the exact space the dragged one left.
  const attempt = (bumped: ModuleItem[], strict = false) => {
    const bumpedIds = new Set(bumped.map((m) => m.id));
    // Line the bumped modules up, in order, from the left edge of the vacated space.
    const staying = modules.filter((m) => m.id !== dragged.id && !bumpedIds.has(m.id));
    const placed: ModuleItem[] = [];
    const swaps: Swap[] = [];
    let cursor = origin.col;
    for (const m of bumped) {
      const rotation = snapRotation(m, rowTypeOf(originCase, origin.row), m.placement!.rotation ?? 0);
      if (rotation === null) return null;
      const newCol = nearestFreeCol([...staying, ...placed], originCase, origin.row, cursor, footprintCols(m, rotation));
      if (newCol === null) return null;
      if (strict && (newCol < origin.col || newCol + footprintCols(m, rotation) > origin.col + originCols)) return null;
      const placement: Placement = {
        caseId: originCase.id,
        row: origin.row,
        col: newCol,
        ...(rotation ? { rotation } : {}),
      };
      placed.push({ ...m, placement });
      swaps.push({ id: m.id, placement });
      cursor = newCol + footprintCols(m, rotation);
    }
    const col = nearestFreeCol([...staying, ...placed], target, slot.row, slot.col, cols, dragged.id, maxShift);
    // The dragged module has to land in the space the bumped modules gave up.
    const landsOnBumped = col !== null && bumped.some((m) => col < m.placement!.col + placedCols(m) && m.placement!.col < col + cols);
    return col !== null && landsOnBumped ? { swaps, col } : null;
  };

  // Modules the drop mostly covers go together; one only clipped at the edge gets slid clear of instead.
  const mostlyCovered = covered.filter((m) => m === main || overlapOf(m) >= placedCols(m) * SWAP_OVERLAP);
  const direct = (mostlyCovered.length > 1 ? attempt(mostlyCovered) : null) ?? attempt([main]);
  if (direct) return direct;

  // A wider module needs more room than the one it replaces, so also bump neighbours on either side of it: every run
  // of adjacent modules around the covered one, smallest first. Locked modules end a run.
  const row = modules
    .filter((m) => m.id !== dragged.id && m.placement?.caseId === target.id && m.placement.row === slot.row)
    .sort((a, b) => a.placement!.col - b.placement!.col);
  const at = row.indexOf(main);
  const runs: ModuleItem[][] = [];
  for (let lo = at; lo >= 0 && (lo === at || !row[lo].locked); lo--) {
    for (let hi = at; hi < row.length && (hi === at || !row[hi].locked); hi++) {
      if (lo < at || hi > at) runs.push(row.slice(lo, hi + 1));
    }
  }
  const width = (run: ModuleItem[]) => run.reduce((n, m) => n + placedCols(m), 0);
  runs.sort((a, b) => a.length - b.length || width(a) - width(b));
  for (const run of runs) {
    const plan = attempt(run, true);
    if (plan) return plan;
  }
  return null;
}
