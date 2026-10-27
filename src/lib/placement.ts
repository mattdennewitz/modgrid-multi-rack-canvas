import type { CaseItem, ModuleItem } from './types';

type Placed = Pick<ModuleItem, 'id' | 'hp' | 'placement'>;

/** True when a module of `hp` fits at row/col without leaving the case or overlapping another module. */
export function fits(
  modules: Placed[],
  c: Pick<CaseItem, 'id' | 'rows' | 'hp'>,
  row: number,
  col: number,
  hp: number,
  excludeId?: string,
): boolean {
  if (row < 1 || row > c.rows || col < 1 || col + hp - 1 > c.hp) return false;
  return !modules.some((m) => {
    const p = m.placement;
    if (!p || m.id === excludeId || p.caseId !== c.id || p.row !== row) return false;
    return col < p.col + m.hp && p.col < col + hp;
  });
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
  hp: number,
  excludeId?: string,
  maxShift = 12,
): number | null {
  for (let d = 0; d <= maxShift; d++) {
    for (const candidate of d === 0 ? [col] : [col - d, col + d]) {
      if (fits(modules, c, row, candidate, hp, excludeId)) return candidate;
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
    next = Math.max(next, m.placement!.col + m.hp);
  }
  if (next <= c.hp) gaps.push({ col: next, hp: c.hp - next + 1 });
  return gaps;
}
