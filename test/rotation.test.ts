import { describe, expect, it } from 'vitest';
import { HP_PX, ROW_PX } from '../src/lib/geometry';
import { SIDEWAYS_COLS, allowedRotations, footprintCols, nextRotation, snapRotation } from '../src/lib/rotation';

const m3 = (hp: number) => ({ hp, is1u: false });
const m1u = { hp: 8, is1u: true };

describe('allowedRotations', () => {
  it('lets any 3U module sit upright or flipped in a 3U row', () => {
    expect(allowedRotations(m3(2), '3U')).toEqual([0, 180]);
    expect(allowedRotations(m3(20), '3U')).toEqual([0, 180]);
  });

  it('lets only 1–4HP 3U modules lie sideways in a 1U row', () => {
    expect(allowedRotations(m3(1), '1U')).toEqual([90, 270]);
    expect(allowedRotations(m3(4), '1U')).toEqual([90, 270]);
    expect(allowedRotations(m3(5), '1U')).toEqual([]);
  });

  it('puts native 1U modules in 1U rows only', () => {
    expect(allowedRotations(m1u, '1U')).toEqual([0, 180]);
    expect(allowedRotations(m1u, '3U')).toEqual([]);
  });
});

describe('footprintCols', () => {
  it('is the HP width upright and 26 columns sideways', () => {
    expect(SIDEWAYS_COLS).toBe(Math.ceil(ROW_PX / HP_PX));
    expect(footprintCols(m3(6), undefined)).toBe(6);
    expect(footprintCols(m3(6), 180)).toBe(6);
    expect(footprintCols(m3(2), 90)).toBe(SIDEWAYS_COLS);
    expect(footprintCols(m3(2), 270)).toBe(SIDEWAYS_COLS);
  });
});

describe('snapRotation', () => {
  it('turns a narrow module sideways over a 1U row, keeping the flip', () => {
    expect(snapRotation(m3(2), '1U', 0)).toBe(90);
    expect(snapRotation(m3(2), '1U', 180)).toBe(270);
    expect(snapRotation(m3(2), '1U', 90)).toBe(90);
  });

  it('stands a sideways module back up over a 3U row, keeping the flip', () => {
    expect(snapRotation(m3(2), '3U', 90)).toBe(0);
    expect(snapRotation(m3(2), '3U', 270)).toBe(180);
  });

  it('returns null when the module has no legal rotation in that row', () => {
    expect(snapRotation(m3(8), '1U', 0)).toBeNull();
    expect(snapRotation(m1u, '3U', 0)).toBeNull();
  });
});

describe('nextRotation', () => {
  it('flips between the two legal rotations of a row type', () => {
    expect(nextRotation(m3(2), '3U', 0)).toBe(180);
    expect(nextRotation(m3(2), '3U', 180)).toBe(0);
    expect(nextRotation(m3(2), '1U', 90)).toBe(270);
    expect(nextRotation(m3(2), '1U', 270)).toBe(90);
  });

  it('steps a plain 90° with no row, and stays put when nothing is legal', () => {
    expect(nextRotation(m3(2), null, 0)).toBe(90);
    expect(nextRotation(m3(2), null, 270)).toBe(0);
    expect(nextRotation(m3(8), '1U', 0)).toBe(0);
  });
});
