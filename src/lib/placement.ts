import { rowTypeOf } from './geometry';
import { allowedRotations, footprintCols } from './rotation';
import type { CaseItem, ModuleItem, Rotation } from './types';

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
