import type { ModuleItem, Rotation, RowType } from './types';

type Mountable = Pick<ModuleItem, 'hp' | 'is1u'>;

/** A 3U panel lying on its side spans its full height in columns: ceil(ROW_PX / HP_PX). */
export const SIDEWAYS_COLS = 26;

export const isSideways = (r: Rotation | undefined) => r === 90 || r === 270;

/** Only narrow 3U panels are short enough to lie across a 1U row. */
export const canLieSideways = (m: Mountable) => !m.is1u && m.hp >= 1 && m.hp <= 4;

/** Legal rotations for a module in a row type, as an [unflipped, flipped] pair, or [] when it can't go there. */
export function allowedRotations(m: Mountable, rowType: RowType): Rotation[] {
  if (rowType === '3U') return m.is1u ? [] : [0, 180];
  if (m.is1u) return [0, 180];
  return canLieSideways(m) ? [90, 270] : [];
}

/** Columns a module occupies in its row. */
export function footprintCols(m: Pick<ModuleItem, 'hp'>, rotation: Rotation | undefined) {
  return isSideways(rotation) ? SIDEWAYS_COLS : m.hp;
}

/**
 * `current` if it is legal in `rowType`, otherwise the row's default orientation (upright in a 3U row, 90° in a 1U row)
 * so a module changing row type never carries over a rotation from the old row. Null when it can't go in that row.
 */
export function snapRotation(m: Mountable, rowType: RowType, current: Rotation): Rotation | null {
  const allowed = allowedRotations(m, rowType);
  if (allowed.length === 0) return null;
  if (allowed.includes(current)) return current;
  return allowed[0];
}

/** What R does: the next 90° step that is legal in `rowType`, or a plain 90° step when there is no row. */
export function nextRotation(m: Mountable, rowType: RowType | null, current: Rotation): Rotation {
  if (!rowType) return ((current + 90) % 360) as Rotation;
  const allowed = allowedRotations(m, rowType);
  for (let d = 90; d <= 270; d += 90) {
    const r = ((current + d) % 360) as Rotation;
    if (allowed.includes(r)) return r;
  }
  return current;
}
