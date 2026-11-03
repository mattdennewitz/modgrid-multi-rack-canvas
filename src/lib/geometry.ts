import { footprintCols, snapRotation } from './rotation';
import type { CaseItem, ModuleItem, Rotation, RowType } from './types';

// World units match ModularGrid's own rendering: 10px per HP, 255px per 3U row.
export const HP_PX = 10;
export const ROW_PX = 255;
/** 44.45mm at the same scale as ROW_PX = 128.5mm. */
export const ROW_1U_PX = 88;
export const ROW_GAP = 10;
export const CASE_PAD = 14;
export const HEADER_PX = 36;
export const GRID_PX = 10;

/** What the row helpers need from a case. `rows` is required so an all-3U case (no `rowTypes`) still type-checks. */
type RowLayout = Pick<CaseItem, 'rows' | 'rowTypes'>;

/** A row's type; rows beyond `rowTypes` (or a case without it) are 3U. */
export function rowTypeOf(c: RowLayout, row: number): RowType {
  return c.rowTypes?.[row - 1] ?? '3U';
}

export function rowHeight(type: RowType) {
  return type === '1U' ? ROW_1U_PX : ROW_PX;
}

export function caseSize(c: Pick<CaseItem, 'rows' | 'hp' | 'rowTypes'>) {
  let rowsH = (c.rows - 1) * ROW_GAP;
  for (let r = 1; r <= c.rows; r++) rowsH += rowHeight(rowTypeOf(c, r));
  return { w: CASE_PAD * 2 + c.hp * HP_PX, h: HEADER_PX + CASE_PAD * 2 + rowsH };
}

/** Top of a row, relative to the case origin. */
export function rowTop(c: RowLayout, row: number) {
  let top = HEADER_PX + CASE_PAD;
  for (let r = 1; r < row; r++) top += rowHeight(rowTypeOf(c, r)) + ROW_GAP;
  return top;
}

/** Insertion point (1 to rows+1) for a row dropped at world-space `wy`: before the first row whose midpoint is below it. */
export function rowInsertIndex(c: RowLayout & Pick<CaseItem, 'y'>, wy: number) {
  const localY = wy - c.y;
  for (let r = 1; r <= c.rows; r++) {
    if (localY < rowTop(c, r) + rowHeight(rowTypeOf(c, r)) / 2) return r;
  }
  return c.rows + 1;
}

/** Y of the drop indicator at insertion point `index`, relative to the case origin, centred in the gap between rows. */
export function insertionLineY(c: RowLayout, index: number) {
  if (index <= c.rows) return rowTop(c, index) - ROW_GAP / 2;
  return rowTop(c, c.rows) + rowHeight(rowTypeOf(c, c.rows)) + ROW_GAP / 2;
}

/** Left edge of an HP column, relative to the row. */
export function colLeft(col: number) {
  return (col - 1) * HP_PX;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Maps a world-space cursor position to the row/col a module would snap to, and
 * the rotation it takes in that row (see `snapRotation`; the requested rotation is
 * kept when the module has no legal rotation there, so callers can mark it invalid).
 * `grabFx` is how far across the module the user grabbed it, as a fraction of its width.
 * Returns null when the cursor is not over the case.
 */
export function pointToSlot(
  c: CaseItem,
  wx: number,
  wy: number,
  module: Pick<ModuleItem, 'hp' | 'is1u'>,
  rotation: Rotation,
  grabFx: number,
): { row: number; col: number; rotation: Rotation } | null {
  const { w, h } = caseSize(c);
  if (wx < c.x || wx > c.x + w || wy < c.y || wy > c.y + h) return null;

  // The gap below a row belongs to that row; anything past the last row clamps to it.
  const localY = wy - c.y - HEADER_PX - CASE_PAD;
  let row = c.rows;
  let top = 0;
  for (let r = 1; r <= c.rows; r++) {
    const bottom = top + rowHeight(rowTypeOf(c, r)) + ROW_GAP;
    if (localY < bottom) {
      row = r;
      break;
    }
    top = bottom;
  }

  const snapped = snapRotation(module, rowTypeOf(c, row), rotation) ?? rotation;
  const cols = footprintCols(module, snapped);
  const left = wx - grabFx * cols * HP_PX - c.x - CASE_PAD;
  const col = clamp(Math.round(left / HP_PX) + 1, 1, Math.max(1, c.hp - cols + 1));
  return { row, col, rotation: snapped };
}

export function snapToGrid(v: number) {
  return Math.round(v / GRID_PX) * GRID_PX;
}
