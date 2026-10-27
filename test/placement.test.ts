import { describe, expect, it } from 'vitest';
import { caseSize, pointToSlot, rowTop, CASE_PAD, HP_PX } from '../src/lib/geometry';
import { fits, nearestFreeCol, rowGaps } from '../src/lib/placement';

const c = { id: 'c1', name: 'Case', rows: 2, hp: 84, x: 100, y: 50 };
const placed = [
  { id: 'a', hp: 10, placement: { caseId: 'c1', row: 1, col: 11 } }, // occupies 11..20
  { id: 'b', hp: 4, placement: { caseId: 'other', row: 1, col: 1 } },
];

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
    expect(pointToSlot(c, x, c.y + rowTop(1) + 10, 4, 0)).toEqual({ row: 1, col: 21 });
    expect(pointToSlot(c, x, c.y + rowTop(2) + 10, 4, 0)).toEqual({ row: 2, col: 21 });
  });

  it('accounts for grab offset and clamps to the case', () => {
    const x = c.x + CASE_PAD + 2 * HP_PX;
    expect(pointToSlot(c, x, c.y + rowTop(1) + 10, 8, 40)).toEqual({ row: 1, col: 1 });
    const right = c.x + caseSize(c).w - 1;
    expect(pointToSlot(c, right, c.y + rowTop(1) + 10, 8, 0)).toEqual({ row: 1, col: 77 });
  });

  it('returns null outside the case', () => {
    expect(pointToSlot(c, c.x - 1, c.y + 100, 4, 0)).toBeNull();
    expect(pointToSlot(c, c.x + 10, c.y + caseSize(c).h + 1, 4, 0)).toBeNull();
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
