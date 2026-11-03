import { describe, expect, it } from 'vitest';
import {
  CASE_PAD,
  HEADER_PX,
  HP_PX,
  ROW_1U_PX,
  ROW_GAP,
  ROW_PX,
  caseSize,
  insertionLineY,
  pointToSlot,
  rowInsertIndex,
  rowTop,
  rowTypeOf,
} from '../src/lib/geometry';
import { canPlace, fits, nearestFreeCol, rowGaps } from '../src/lib/placement';
import type { RowType } from '../src/lib/types';

const c = { id: 'c1', name: 'Case', rows: 2, hp: 84, x: 100, y: 50 };
const placed = [
  { id: 'a', hp: 10, placement: { caseId: 'c1', row: 1, col: 11 } }, // occupies 11..20
  { id: 'b', hp: 4, placement: { caseId: 'other', row: 1, col: 1 } },
];

const plain = (hp: number) => ({ hp, is1u: false });

describe('fits', () => {
  it('rejects out of bounds', () => {
    expect(fits([], c, 0, 1, 4)).toBe(false);
    expect(fits([], c, 3, 1, 4)).toBe(false);
    expect(fits([], c, 1, 0, 4)).toBe(false);
    expect(fits([], c, 1, 81, 4)).toBe(true);
    expect(fits([], c, 1, 82, 4)).toBe(false);
  });

  it('rejects overlap in the same row and case only', () => {
    expect(fits(placed, c, 1, 7, 4)).toBe(true); // 7..10 touches but doesn't overlap
    expect(fits(placed, c, 1, 8, 4)).toBe(false);
    expect(fits(placed, c, 1, 20, 4)).toBe(false);
    expect(fits(placed, c, 1, 21, 4)).toBe(true);
    expect(fits(placed, c, 2, 11, 4)).toBe(true);
    expect(fits(placed, { ...c, id: 'other' }, 1, 5, 4)).toBe(true);
  });

  it('ignores the module being moved', () => {
    expect(fits(placed, c, 1, 12, 10, 'a')).toBe(true);
    expect(fits(placed, c, 1, 12, 10)).toBe(false);
  });
});

describe('nearestFreeCol', () => {
  it('shifts to the closest free spot', () => {
    expect(nearestFreeCol(placed, c, 1, 9, 4)).toBe(7);
    expect(nearestFreeCol(placed, c, 1, 19, 4)).toBe(21);
    expect(nearestFreeCol(placed, c, 1, 5, 4)).toBe(5);
  });

  it('gives up when nothing is free nearby', () => {
    const full = [{ id: 'x', hp: 84, placement: { caseId: 'c1', row: 1, col: 1 } }];
    expect(nearestFreeCol(full, c, 1, 40, 4)).toBeNull();
  });
});

describe('pointToSlot', () => {
  it('maps world coordinates to snapped row/col', () => {
    const x = c.x + CASE_PAD + 20 * HP_PX + 3; // just past HP 21
    expect(pointToSlot(c, x, c.y + rowTop(c, 1) + 10, plain(4), 0, 0)).toEqual({ row: 1, col: 21, rotation: 0 });
    expect(pointToSlot(c, x, c.y + rowTop(c, 2) + 10, plain(4), 0, 0)).toEqual({ row: 2, col: 21, rotation: 0 });
  });

  it('accounts for grab offset and clamps to the case', () => {
    const x = c.x + CASE_PAD + 2 * HP_PX;
    // Grabbed halfway across an 8HP module (40px in).
    expect(pointToSlot(c, x, c.y + rowTop(c, 1) + 10, plain(8), 0, 0.5)).toEqual({ row: 1, col: 1, rotation: 0 });
    const right = c.x + caseSize(c).w - 1;
    expect(pointToSlot(c, right, c.y + rowTop(c, 1) + 10, plain(8), 0, 0)).toEqual({ row: 1, col: 77, rotation: 0 });
  });

  it('returns null outside the case', () => {
    expect(pointToSlot(c, c.x - 1, c.y + 100, plain(4), 0, 0)).toBeNull();
    expect(pointToSlot(c, c.x + 10, c.y + caseSize(c).h + 1, plain(4), 0, 0)).toBeNull();
  });
});

describe('mixed row heights', () => {
  const mixed = { ...c, rowTypes: ['3U', '1U'] as RowType[] };
  const x = mixed.x + CASE_PAD + 10 * HP_PX;
  const y1 = mixed.y + rowTop(mixed, 1) + 10;
  const y2 = mixed.y + rowTop(mixed, 2) + 10;

  it('reads row types, defaulting to 3U', () => {
    expect(rowTypeOf(c, 1)).toBe('3U');
    expect(rowTypeOf(mixed, 2)).toBe('1U');
    expect(rowTypeOf(mixed, 3)).toBe('3U');
  });

  it('stacks rows by their own height', () => {
    expect(rowTop(mixed, 1)).toBe(HEADER_PX + CASE_PAD);
    expect(rowTop(mixed, 2)).toBe(HEADER_PX + CASE_PAD + ROW_PX + ROW_GAP);
    expect(caseSize(mixed).h).toBe(HEADER_PX + CASE_PAD * 2 + ROW_PX + ROW_GAP + ROW_1U_PX);
    // Unchanged for all-3U cases.
    expect(caseSize(c).h).toBe(HEADER_PX + CASE_PAD * 2 + 2 * ROW_PX + ROW_GAP);
  });

  it('snaps a narrow 3U module sideways over a 1U row and clamps its 26 columns inside the case', () => {
    expect(pointToSlot(mixed, x, y2, plain(2), 0, 0)).toEqual({ row: 2, col: 11, rotation: 90 });
    const right = mixed.x + caseSize(mixed).w - 1;
    expect(pointToSlot(mixed, right, y2, plain(2), 0, 0)).toEqual({ row: 2, col: 59, rotation: 90 });
  });

  it('stands it back up over a 3U row in the normal orientation', () => {
    expect(pointToSlot(mixed, x, y1, plain(2), 270, 0)).toEqual({ row: 1, col: 11, rotation: 0 });
  });

  it('assigns the gap below a row to that row', () => {
    const inGap = mixed.y + rowTop(mixed, 1) + ROW_PX + ROW_GAP - 1;
    expect(pointToSlot(mixed, x, inGap, plain(4), 0, 0)?.row).toBe(1);
    expect(pointToSlot(mixed, x, inGap + 1, plain(4), 0, 0)?.row).toBe(2);
  });
});

describe('rowGaps', () => {
  it('finds leading, middle and trailing gaps in one row only', () => {
    const mods = [
      ...placed,
      { id: 'c', hp: 4, placement: { caseId: 'c1', row: 1, col: 25 } }, // 25..28
      { id: 'd', hp: 4, placement: { caseId: 'c1', row: 2, col: 1 } },
    ];
    expect(rowGaps(mods, c, 1)).toEqual([
      { col: 1, hp: 10 },
      { col: 21, hp: 4 },
      { col: 29, hp: 56 },
    ]);
    expect(rowGaps(mods, c, 2)).toEqual([{ col: 5, hp: 80 }]);
  });

  it('reports nothing for a full row and the whole row when empty', () => {
    expect(rowGaps([{ id: 'x', hp: 84, placement: { caseId: 'c1', row: 1, col: 1 } }], c, 1)).toEqual([]);
    expect(rowGaps([], c, 2)).toEqual([{ col: 1, hp: 84 }]);
  });
});

describe('sideways modules', () => {
  const mixed = { ...c, rowTypes: ['3U', '1U'] as RowType[] };
  const side = { id: 's', hp: 2, placement: { caseId: 'c1', row: 2, col: 5, rotation: 90 as const } }; // cols 5..30

  it('occupies 26 columns whatever its HP', () => {
    expect(fits([side], mixed, 2, 30, 4)).toBe(false);
    expect(fits([side], mixed, 2, 31, 4)).toBe(true);
    expect(fits([side], mixed, 2, 1, 4)).toBe(true); // 1..4 touches but doesn't overlap
    expect(fits([side], mixed, 2, 1, 5)).toBe(false);
  });

  it('is reflected in the gaps around it', () => {
    expect(rowGaps([side], mixed, 2)).toEqual([
      { col: 1, hp: 4 },
      { col: 31, hp: 54 },
    ]);
  });

  it('finds the nearest free column around it', () => {
    expect(nearestFreeCol([side], mixed, 2, 6, 4)).toBe(1);
  });

  it('can search further than the usual 12HP so a sideways module can hop over a neighbour', () => {
    const other = { id: 'o', hp: 2, placement: { caseId: 'c1', row: 2, col: 30, rotation: 90 as const } }; // 30..55
    expect(nearestFreeCol([other], mixed, 2, 40, 26)).toBeNull(); // 56 is 16 away
    expect(nearestFreeCol([other], mixed, 2, 40, 26, undefined, 26)).toBe(56);
  });
});

describe('canPlace', () => {
  const mixed = { ...c, rowTypes: ['3U', '1U'] as RowType[] };
  const narrow = { id: 'n', hp: 2, is1u: false };
  const wide = { id: 'w', hp: 10, is1u: false };
  const oneU = { id: 'u', hp: 8, is1u: true };
  const side = { id: 's', hp: 2, placement: { caseId: 'c1', row: 2, col: 5, rotation: 90 as const } };

  it('follows the rotation table', () => {
    expect(canPlace([], mixed, narrow, { row: 1, col: 1 })).toBe(true);
    expect(canPlace([], mixed, narrow, { row: 1, col: 1, rotation: 180 })).toBe(true);
    expect(canPlace([], mixed, narrow, { row: 1, col: 1, rotation: 90 })).toBe(false);
    expect(canPlace([], mixed, narrow, { row: 2, col: 1 })).toBe(false);
    expect(canPlace([], mixed, narrow, { row: 2, col: 1, rotation: 90 })).toBe(true);
    expect(canPlace([], mixed, wide, { row: 2, col: 1, rotation: 90 })).toBe(false);
    expect(canPlace([], mixed, oneU, { row: 2, col: 1 })).toBe(true);
    expect(canPlace([], mixed, oneU, { row: 1, col: 1 })).toBe(false);
  });

  it('still rejects overlap and overflow', () => {
    expect(canPlace([side], mixed, narrow, { row: 2, col: 20, rotation: 90 })).toBe(false);
    expect(canPlace([], mixed, narrow, { row: 2, col: 60, rotation: 90 })).toBe(false); // 60..85
    expect(canPlace([], mixed, narrow, { row: 2, col: 59, rotation: 90 })).toBe(true); // 59..84
    expect(canPlace([], mixed, narrow, { row: 3, col: 1 })).toBe(false);
  });
});

describe('row insertion', () => {
  // Rows start at 50 (3U, midpoint 177.5), 315 (1U, midpoint 359) and 413 (1U, midpoint 457) below the case origin.
  const three = { ...c, rows: 3, rowTypes: ['3U', '1U', '1U'] as RowType[] };
  const at = (localY: number) => rowInsertIndex(three, three.y + localY);

  it('inserts before the first row whose midpoint is below the cursor, else at the end', () => {
    expect(at(0)).toBe(1);
    expect(at(177)).toBe(1);
    expect(at(178)).toBe(2);
    expect(at(358)).toBe(2);
    expect(at(360)).toBe(3);
    expect(at(456)).toBe(3);
    expect(at(458)).toBe(4);
    expect(at(9999)).toBe(4);
  });

  it('draws the line in the gap between rows', () => {
    expect(insertionLineY(three, 1)).toBe(rowTop(three, 1) - ROW_GAP / 2);
    expect(insertionLineY(three, 2)).toBe(rowTop(three, 1) + ROW_PX + ROW_GAP / 2);
    expect(insertionLineY(three, 2)).toBe(rowTop(three, 2) - ROW_GAP / 2);
    expect(insertionLineY(three, 4)).toBe(rowTop(three, 3) + ROW_1U_PX + ROW_GAP / 2);
  });
});
