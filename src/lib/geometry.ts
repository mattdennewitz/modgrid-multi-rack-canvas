import type { CaseItem } from './types';

// World units match ModularGrid's own rendering: 10px per HP, 255px per 3U row.
export const HP_PX = 10;
export const ROW_PX = 255;
export const ROW_GAP = 10;
export const CASE_PAD = 14;
export const HEADER_PX = 36;
export const GRID_PX = 10;

export function caseSize(c: Pick<CaseItem, 'rows' | 'hp'>) {
  return {
    w: CASE_PAD * 2 + c.hp * HP_PX,
    h: HEADER_PX + CASE_PAD * 2 + c.rows * ROW_PX + (c.rows - 1) * ROW_GAP,
  };
}

/** Top of a row, relative to the case origin. */
export function rowTop(row: number) {
  return HEADER_PX + CASE_PAD + (row - 1) * (ROW_PX + ROW_GAP);
}

/** Left edge of an HP column, relative to the row. */
export function colLeft(col: number) {
  return (col - 1) * HP_PX;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Maps a world-space cursor position to the row/col a module would snap to.
 * `grabDx` is how far from the module's left edge the user grabbed it.
 * Returns null when the cursor is not over the case.
 */
export function pointToSlot(
  c: CaseItem,
  wx: number,
  wy: number,
  moduleHp: number,
  grabDx: number,
): { row: number; col: number } | null {
  const { w, h } = caseSize(c);
  if (wx < c.x || wx > c.x + w || wy < c.y || wy > c.y + h) return null;

  const localY = wy - c.y - HEADER_PX - CASE_PAD;
  const row = clamp(Math.floor(localY / (ROW_PX + ROW_GAP)) + 1, 1, c.rows);

  const left = wx - grabDx - c.x - CASE_PAD;
  const col = clamp(Math.round(left / HP_PX) + 1, 1, Math.max(1, c.hp - moduleHp + 1));
  return { row, col };
}

export function snapToGrid(v: number) {
  return Math.round(v / GRID_PX) * GRID_PX;
}
