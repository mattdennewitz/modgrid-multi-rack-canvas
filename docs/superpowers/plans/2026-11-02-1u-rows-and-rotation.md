# 1U Rows and Module Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cases can mix 3U and 1U rows; 1–4HP 3U modules snap sideways into 1U rows, 3U modules can flip 180°, and native 1U modules sit in 1U rows.

**Architecture:** A new pure `rotation.ts` owns the rotation rules (which rotations are legal in which row type, footprint width, snapping, next rotation). `geometry.ts`, `placement.ts`, `store.ts` and `layoutSummary.ts` consume it through per-row `rowTypes` on cases and `rotation` on placements. The UI (`ModulePanel`, `CaseView`, `App`, `Sidebar`) renders and drives it.

**Tech Stack:** TypeScript, React 19, Vite, Vitest. Run tests with `npm test`, types with `npm run typecheck`.

## Global Constraints

- `CaseItem.rowTypes?: ('3U' | '1U')[]`, missing means every row is 3U. Old saves and exports must load unchanged.
- `Placement.rotation?: 0 | 90 | 180 | 270`, missing means 0.
- A 1U row is `ROW_1U_PX = 88` px tall. A 3U row stays `ROW_PX = 255`. `HP_PX = 10`.
- A sideways module spans `SIDEWAYS_COLS = 26` columns and the full 1U row height. One module per horizontal span, no stacking.
- Rotation table (row type → module → allowed rotations): 3U row: any non-1U module → 0, 180; 1U row: native 1U module → 0, 180; 1U row: non-1U module of 1–4HP → 90, 270; everything else is not placeable.
- Dragging snaps rotation to the row under the cursor; a 180/270 "flip" is kept across the snap (see `snapRotation`).
- `npm test` and `npm run typecheck` (tsc covers `src`, `server`, `test`; `noUnusedLocals` is on) must pass at the end of every task.

---

### Task 0: Branch

- [ ] **Step 1: Create a feature branch**

Run: `cd /Users/matt/src/new-modgrid && git switch -c feat/1u-rows-rotation`
Expected: `Switched to a new branch 'feat/1u-rows-rotation'`

- [ ] **Step 2: Confirm the baseline is green**

Run: `npm test 2>&1 | tail -6 && npm run typecheck 2>&1 | tail -3`
Expected: `Tests  41 passed (41)` and no tsc errors.

---

### Task 1: Types and `rotation.ts`

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/lib/rotation.ts`
- Test: `test/rotation.test.ts`

**Interfaces:**
- Produces (types): `RowType = '3U' | '1U'`, `Rotation = 0 | 90 | 180 | 270`, `Placement.rotation?: Rotation`, `CaseItem.rowTypes?: RowType[]`.
- Produces (`rotation.ts`):
  - `SIDEWAYS_COLS: 26`
  - `isSideways(r: Rotation | undefined): boolean`
  - `canLieSideways(m: Pick<ModuleItem,'hp'|'is1u'>): boolean`
  - `allowedRotations(m: Pick<ModuleItem,'hp'|'is1u'>, rowType: RowType): Rotation[]`
  - `footprintCols(m: Pick<ModuleItem,'hp'>, rotation: Rotation | undefined): number`
  - `snapRotation(m, rowType, current: Rotation): Rotation | null`
  - `nextRotation(m, rowType: RowType | null, current: Rotation): Rotation`

- [ ] **Step 1: Add the types**

In `src/lib/types.ts`, replace the `Placement` interface and add the new types above it:

```ts
export type RowType = '3U' | '1U';

/** Clockwise rotation of a panel in degrees. */
export type Rotation = 0 | 90 | 180 | 270;

export interface Placement {
  caseId: string;
  row: number;
  col: number;
  /** Missing means 0. */
  rotation?: Rotation;
}
```

In the same file, replace `CaseItem`:

```ts
export interface CaseItem {
  id: string;
  name: string;
  rows: number;
  hp: number;
  /** One entry per row; missing means every row is 3U. */
  rowTypes?: RowType[];
  x: number;
  y: number;
}
```

- [ ] **Step 2: Write the failing tests**

Create `test/rotation.test.ts`:

```ts
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
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/rotation.test.ts`
Expected: FAIL, cannot resolve `../src/lib/rotation`.

- [ ] **Step 4: Implement `rotation.ts`**

Create `src/lib/rotation.ts`:

```ts
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

/** Nearest legal rotation in `rowType`, keeping a 180/270 flip; null when the module can't go in that row. */
export function snapRotation(m: Mountable, rowType: RowType, current: Rotation): Rotation | null {
  const allowed = allowedRotations(m, rowType);
  if (allowed.length === 0) return null;
  if (allowed.includes(current)) return current;
  return allowed[current >= 180 ? 1 : 0];
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
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run test/rotation.test.ts && npm run typecheck`
Expected: all rotation tests PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/rotation.ts test/rotation.test.ts
git commit -m "feat: add rotation rules and row/rotation types

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Geometry for mixed row heights

**Files:**
- Modify: `src/lib/geometry.ts`
- Modify: `src/components/CaseView.tsx` (row rendering only)
- Modify: `src/App.tsx` (call site of `pointToSlot` only)
- Test: `test/placement.test.ts` (holds the geometry tests)

**Interfaces:**
- Consumes: `snapRotation`, `footprintCols` from `rotation.ts`; `RowType`, `Rotation` from `types.ts`.
- Produces (`geometry.ts`):
  - `ROW_1U_PX = 88`
  - `rowTypeOf(c: Pick<CaseItem,'rowTypes'>, row: number): RowType`
  - `rowHeight(type: RowType): number`
  - `caseSize(c: Pick<CaseItem,'rows'|'hp'|'rowTypes'>): { w; h }` (now sums row heights)
  - `rowTop(c: Pick<CaseItem,'rowTypes'>, row: number): number` (**signature change**: was `rowTop(row)`)
  - `pointToSlot(c: CaseItem, wx, wy, module: Pick<ModuleItem,'hp'|'is1u'>, rotation: Rotation, grabFx: number): { row; col; rotation: Rotation } | null` (**signature change**: `grabFx` is the grab point as a fraction of the module's width, not pixels)

- [ ] **Step 1: Update and extend the geometry tests**

In `test/placement.test.ts`, replace the import lines and the `pointToSlot` describe block.

Imports at the top become:

```ts
import { describe, expect, it } from 'vitest';
import {
  CASE_PAD,
  HEADER_PX,
  HP_PX,
  ROW_1U_PX,
  ROW_GAP,
  ROW_PX,
  caseSize,
  pointToSlot,
  rowTop,
  rowTypeOf,
} from '../src/lib/geometry';
import { fits, nearestFreeCol, rowGaps } from '../src/lib/placement';
import type { RowType } from '../src/lib/types';
```

Right after `const placed = [...]` add:

```ts
const plain = (hp: number) => ({ hp, is1u: false });
```

Replace the whole `describe('pointToSlot', ...)` block with:

```ts
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

  it('stands it back up over a 3U row, keeping the flip', () => {
    expect(pointToSlot(mixed, x, y1, plain(2), 270, 0)).toEqual({ row: 1, col: 11, rotation: 180 });
  });

  it('assigns the gap below a row to that row', () => {
    const inGap = mixed.y + rowTop(mixed, 1) + ROW_PX + ROW_GAP - 1;
    expect(pointToSlot(mixed, x, inGap, plain(4), 0, 0)?.row).toBe(1);
    expect(pointToSlot(mixed, x, inGap + 1, plain(4), 0, 0)?.row).toBe(2);
  });
});
```

(The existing `fits`, `nearestFreeCol` and `rowGaps` blocks stay as they are.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/placement.test.ts`
Expected: FAIL (`rowTypeOf` / `ROW_1U_PX` not exported, `rowTop` called with a case).

- [ ] **Step 3: Rewrite `geometry.ts`**

Replace the whole file `src/lib/geometry.ts`:

```ts
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

/** A row's type; rows beyond `rowTypes` (or a case without it) are 3U. */
export function rowTypeOf(c: Pick<CaseItem, 'rowTypes'>, row: number): RowType {
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
export function rowTop(c: Pick<CaseItem, 'rowTypes'>, row: number) {
  let top = HEADER_PX + CASE_PAD;
  for (let r = 1; r < row; r++) top += rowHeight(rowTypeOf(c, r)) + ROW_GAP;
  return top;
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
```

- [ ] **Step 4: Fix the call sites so `tsc` stays green**

In `src/components/CaseView.tsx`:

1. Change the geometry import to:

```ts
import { CASE_PAD, HP_PX, ROW_PX, caseSize, colLeft, rowHeight, rowTop, rowTypeOf, snapToGrid } from '../lib/geometry';
```

2. Replace the `GapLabel` component with a version that takes explicit `top`/`height`:

```tsx
/** Free-HP label centred in an empty stretch of a row; sized to stay readable when zoomed out. */
function GapLabel({
  top,
  height,
  gap,
  zoom,
}: {
  top: number;
  height: number;
  gap: { col: number; hp: number };
  zoom: number;
}) {
  const width = gap.hp * HP_PX;
  const vertical = gap.hp < 4;
  const fontSize = Math.min(12 / zoom, vertical ? width * 0.8 : 28);
  return (
    <div
      className="pointer-events-none absolute flex items-center justify-center"
      style={{ left: CASE_PAD + colLeft(gap.col), top, width, height }}
    >
      <span
        className="rounded-sm bg-black/60 font-medium whitespace-nowrap text-neutral-400 tabular-nums"
        style={{
          fontSize,
          padding: `${fontSize * 0.15}px ${fontSize * 0.35}px`,
          writingMode: vertical ? 'vertical-rl' : undefined,
        }}
      >
        {gap.hp}HP
      </span>
    </div>
  );
}
```

3. Replace the two row-rendering blocks (the `rack-row` map and the `rowGaps` map) with:

```tsx
      {Array.from({ length: c.rows }, (_, i) => (
        <div
          key={i}
          className="rack-row absolute"
          style={{
            left: CASE_PAD,
            top: rowTop(c, i + 1),
            width: c.hp * HP_PX,
            height: rowHeight(rowTypeOf(c, i + 1)),
          }}
        />
      ))}

      {Array.from({ length: c.rows }, (_, i) =>
        rowGaps(modules, c, i + 1).map((g) => (
          <GapLabel
            key={`${i}:${g.col}`}
            top={rowTop(c, i + 1)}
            height={rowHeight(rowTypeOf(c, i + 1))}
            gap={g}
            zoom={zoom}
          />
        )),
      )}
```

4. In the module map change `style={{ left: CASE_PAD + colLeft(p.col), top: rowTop(p.row) }}` to `top: rowTop(c, p.row)`, and in the preview block change `top: rowTop(preview.row)` to `top: rowTop(c, preview.row)`. (`ROW_PX` is still used for module/preview heights until Task 6.)

In `src/App.tsx`, inside `findTarget`, remove the `const grabDx = ...` line and change the slot lookup to:

```ts
      const slot = pointToSlot(c, wx, wy, module, 0, grabFx);
```

(Rotation is wired through the drag in Task 6.) `HP_PX` is still used by the ghost size in `App.tsx`, so its import stays.

- [ ] **Step 5: Run everything**

Run: `npm test && npm run typecheck`
Expected: all tests PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/geometry.ts src/components/CaseView.tsx src/App.tsx test/placement.test.ts
git commit -m "feat: geometry for mixed 3U/1U row heights

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Placement with footprints

**Files:**
- Modify: `src/lib/placement.ts`
- Test: `test/placement.test.ts`

**Interfaces:**
- Consumes: `footprintCols`, `allowedRotations` from `rotation.ts`; `rowTypeOf` from `geometry.ts`.
- Produces (`placement.ts`):
  - `fits(modules, c, row, col, cols, excludeId?)`, same as before but existing modules count by footprint (sideways = 26 columns). The 5th parameter is now a column count, not necessarily the module's `hp`.
  - `nearestFreeCol(modules, c, row, col, cols, excludeId?, maxShift?)`, same note.
  - `rowGaps(modules, c, row)`, gaps respect footprints.
  - `canPlace(modules, c: Pick<CaseItem,'id'|'rows'|'hp'|'rowTypes'>, module: Pick<ModuleItem,'id'|'hp'|'is1u'>, placement: { row: number; col: number; rotation?: Rotation }): boolean`

- [ ] **Step 1: Write the failing tests**

In `test/placement.test.ts` change the placement import to:

```ts
import { canPlace, fits, nearestFreeCol, rowGaps } from '../src/lib/placement';
```

Append to the end of the file:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/placement.test.ts`
Expected: FAIL (`canPlace` not exported; sideways overlap assertions fail).

- [ ] **Step 3: Implement**

Replace `src/lib/placement.ts`:

```ts
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
```

- [ ] **Step 4: Run everything**

Run: `npm test && npm run typecheck`
Expected: all PASS, tsc clean. (`nearestFreeCol([side], mixed, 2, 6, 4)` → col 6 overlaps 5..30; d=5 gives col 1 (1..4) which fits before col 11 on the right, so `1` is returned.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/placement.ts test/placement.test.ts
git commit -m "feat: placement honours rotated footprints and row types

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Store (row types, eviction, `rotateModule`)

**Files:**
- Modify: `src/lib/store.ts`
- Test: `test/store.test.ts`

**Interfaces:**
- Consumes: `canPlace` (placement), `allowedRotations`, `footprintCols`, `nextRotation` (rotation), `rowTypeOf` (geometry).
- Produces:
  - `Action` gains `{ type: 'rotateModule'; id: string }`. It moves a placed, unlocked module to `nextRotation(module, rowType, current)`; no-op otherwise. (Both rotations in a row type have the same width, so it never collides.)
  - `updateCase` accepts `patch.rowTypes`; the stored `rowTypes` is padded/trimmed to `rows` and omitted (undefined) when every row is 3U.
  - `isOutOfBounds(m, c: Pick<CaseItem,'id'|'rows'|'hp'|'rowTypes'>)` is also true when the module's rotation isn't legal for its row's type.
  - `importRack` places a module only when `canPlace` allows it; 1U modules stay in the tray (imported cases are all 3U).

- [ ] **Step 1: Write the failing tests**

In `test/store.test.ts` extend the imports:

```ts
import type { CollectionModule } from '../src/lib/types';
```

Append to the end of the file:

```ts
describe('1U rows and rotation', () => {
  const mod = (over: Partial<CollectionModule> & { slug: string }): CollectionModule => ({
    moduleId: over.slug,
    versionId: null,
    name: over.slug,
    vendor: 'V',
    description: '',
    hp: 4,
    depth: 0,
    is1u: false,
    power: { plus12: 0, minus12: 0, plus5: 0 },
    ...over,
  });

  function setup() {
    let s = reducer(emptyState, { type: 'addCase', name: 'A', rows: 2, hp: 84 });
    const caseId = s.cases[0].id;
    s = reducer(s, { type: 'updateCase', id: caseId, patch: { rowTypes: ['3U', '1U'] } });
    s = reducer(s, {
      type: 'importCollection',
      source: 'test',
      modules: [mod({ slug: 'narrow', hp: 2 }), mod({ slug: 'wide', hp: 10 }), mod({ slug: 'one-u', hp: 8, is1u: true })],
    });
    const id = (slug: string) => s.modules.find((m) => m.slug === slug)!.id;
    return { s, caseId, id };
  }
  const get = (s: ReturnType<typeof setup>['s'], id: string) => s.modules.find((m) => m.id === id)!;

  it('keeps rowTypes in step with the row count and drops them when all rows are 3U', () => {
    const { s, caseId } = setup();
    expect(s.cases[0].rowTypes).toEqual(['3U', '1U']);
    const grown = reducer(s, { type: 'updateCase', id: caseId, patch: { rows: 3 } });
    expect(grown.cases[0].rowTypes).toEqual(['3U', '1U', '3U']);
    const flat = reducer(s, { type: 'updateCase', id: caseId, patch: { rowTypes: ['3U', '3U'] } });
    expect(flat.cases[0].rowTypes).toBeUndefined();
  });

  it('flips a module 180° in a 3U row and turns it 90° in a 1U row', () => {
    const { s, caseId, id } = setup();
    let t = reducer(s, { type: 'placeModule', id: id('wide'), placement: { caseId, row: 1, col: 1 } });
    t = reducer(t, { type: 'rotateModule', id: id('wide') });
    expect(get(t, id('wide')).placement!.rotation).toBe(180);
    t = reducer(t, { type: 'rotateModule', id: id('wide') });
    expect(get(t, id('wide')).placement!.rotation ?? 0).toBe(0);

    t = reducer(t, { type: 'placeModule', id: id('narrow'), placement: { caseId, row: 2, col: 1, rotation: 90 } });
    t = reducer(t, { type: 'rotateModule', id: id('narrow') });
    expect(get(t, id('narrow')).placement!.rotation).toBe(270);
    t = reducer(t, { type: 'rotateModule', id: id('narrow') });
    expect(get(t, id('narrow')).placement!.rotation).toBe(90);
  });

  it('ignores rotation for locked and unplaced modules', () => {
    const { s, caseId, id } = setup();
    expect(reducer(s, { type: 'rotateModule', id: id('wide') })).toBe(s);
    let t = reducer(s, { type: 'placeModule', id: id('wide'), placement: { caseId, row: 1, col: 1 } });
    t = reducer(t, { type: 'setLocked', id: id('wide'), locked: true });
    expect(reducer(t, { type: 'rotateModule', id: id('wide') })).toBe(t);
  });

  it('sends modules to the tray when their row type stops suiting them', () => {
    const { s, caseId, id } = setup();
    let t = reducer(s, { type: 'placeModule', id: id('wide'), placement: { caseId, row: 1, col: 1 } });
    t = reducer(t, { type: 'placeModule', id: id('narrow'), placement: { caseId, row: 2, col: 1, rotation: 90 } });
    t = reducer(t, { type: 'placeModule', id: id('one-u'), placement: { caseId, row: 2, col: 30 } });

    // Row 1 becomes 1U: the upright 3U module no longer fits; the others stay.
    const a = reducer(t, { type: 'updateCase', id: caseId, patch: { rowTypes: ['1U', '1U'] } });
    expect(get(a, id('wide')).placement).toBeNull();
    expect(get(a, id('narrow')).placement).not.toBeNull();
    expect(get(a, id('one-u')).placement).not.toBeNull();

    // Row 2 becomes 3U: the sideways module and the 1U module go.
    const b = reducer(t, { type: 'updateCase', id: caseId, patch: { rowTypes: ['3U', '3U'] } });
    expect(get(b, id('wide')).placement).not.toBeNull();
    expect(get(b, id('narrow')).placement).toBeNull();
    expect(get(b, id('one-u')).placement).toBeNull();
  });

  it('refuses a row-type change that would evict a locked module', () => {
    const { s, caseId, id } = setup();
    let t = reducer(s, { type: 'placeModule', id: id('wide'), placement: { caseId, row: 1, col: 1 } });
    t = reducer(t, { type: 'setLocked', id: id('wide'), locked: true });
    expect(reducer(t, { type: 'updateCase', id: caseId, patch: { rowTypes: ['1U', '1U'] } })).toBe(t);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/store.test.ts`
Expected: FAIL (`rotateModule` is not an action; `rowTypes` not normalised, no eviction by row type).

- [ ] **Step 3: Implement the store changes**

In `src/lib/store.ts`:

1. Replace the first three imports:

```ts
import { caseSize, rowTypeOf } from './geometry';
import { canPlace } from './placement';
import { allowedRotations, footprintCols, nextRotation } from './rotation';
import type { AppState, CaseItem, CollectionModule, ImportedRack, ModuleItem, Placement, RowType } from './types';
```

2. Add the action to the `Action` union (after `setLocked`):

```ts
  | { type: 'rotateModule'; id: string }
```

3. Replace `isOutOfBounds` (and its doc) and add `normalizeRowTypes`:

```ts
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
```

4. In `importRack`, replace the placement condition

```ts
        if (newCase && !m.is1u && m.inBounds && fits(added, newCase, m.row, m.col, m.hp)) {
```

with

```ts
        if (newCase && m.inBounds && canPlace(added, newCase, item, { row: m.row, col: m.col })) {
```

5. In `updateCase`, replace `const updated = { ...existing, ...action.patch };` with:

```ts
      const merged = { ...existing, ...action.patch };
      const updated = { ...merged, rowTypes: normalizeRowTypes(merged.rowTypes, merged.rows) };
```

6. Add the `rotateModule` case after `setLocked`:

```ts
    case 'rotateModule': {
      const m = state.modules.find((x) => x.id === action.id);
      const p = m?.placement;
      if (!m || !p || m.locked) return state;
      const c = state.cases.find((x) => x.id === p.caseId);
      if (!c) return state;
      const current = p.rotation ?? 0;
      const rotation = nextRotation(m, rowTypeOf(c, p.row), current);
      if (rotation === current) return state;
      return {
        ...state,
        modules: state.modules.map((x) => (x.id === m.id ? { ...x, placement: { ...p, rotation } } : x)),
      };
    }
```

- [ ] **Step 4: Run everything**

Run: `npm test && npm run typecheck`
Expected: all PASS, tsc clean. (`App.tsx` and `Sidebar.tsx` still compile: `isOutOfBounds` gained only an optional field.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.ts test/store.test.ts
git commit -m "feat: row types, rotateModule and row-type eviction in the store

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Layout summary for the advisor

**Files:**
- Modify: `src/lib/layoutSummary.ts`
- Test: `test/layoutSummary.test.ts`

**Interfaces:**
- Consumes: `rowTypeOf` (geometry), `footprintCols`, `isSideways`, `SIDEWAYS_COLS` (rotation).
- Produces: summary text where 1U rows read `Row 2 (1U):` (3U rows keep `Row N:`), sideways modules read `mounted sideways, rotated 90°, spans 26HP`, flipped ones `flipped 180°`, and HP ranges/used-HP use the footprint.

- [ ] **Step 1: Write the failing test**

Append to `test/layoutSummary.test.ts`:

```ts
describe('summarizeLayout with 1U rows', () => {
  it('labels 1U rows and describes sideways and flipped modules', () => {
    const mod = (slug: string, hp: number) => ({
      slug,
      moduleId: slug,
      versionId: null,
      name: slug,
      vendor: 'V',
      description: '',
      hp,
      depth: 0,
      is1u: false,
      power: { plus12: 0, minus12: 0, plus5: 0 },
    });
    let s = reducer(emptyState, { type: 'addCase', name: 'A', rows: 2, hp: 84 });
    const caseId = s.cases[0].id;
    s = reducer(s, { type: 'updateCase', id: caseId, patch: { rowTypes: ['3U', '1U'] } });
    s = reducer(s, { type: 'importCollection', source: 't', modules: [mod('narrow', 2), mod('flip', 6)] });
    const id = (slug: string) => s.modules.find((m) => m.slug === slug)!.id;
    s = reducer(s, { type: 'placeModule', id: id('narrow'), placement: { caseId, row: 2, col: 1, rotation: 90 } });
    s = reducer(s, { type: 'placeModule', id: id('flip'), placement: { caseId, row: 1, col: 1, rotation: 180 } });

    const text = summarizeLayout(s);
    expect(text).toContain('Row 1:\n');
    expect(text).toMatch(/- HP 1–6: flip — V .*flipped 180°/);
    expect(text).toMatch(/Row 2 \(1U\):\n- HP 1–26: narrow — V .*mounted sideways, rotated 90°, spans 26HP/);
    expect(text).toContain('- HP 27–84: empty (58HP)');
    expect(text).toContain('32/168HP used');
  });
});
```

(`32` = 6 + 26 used columns; `168` = 2 rows × 84.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/layoutSummary.test.ts`
Expected: FAIL (no `(1U)` label, HP range uses `hp`).

- [ ] **Step 3: Implement**

In `src/lib/layoutSummary.ts`:

1. Imports:

```ts
import { rowTypeOf } from './geometry';
import { sumPower } from './modulargrid';
import { rowGaps } from './placement';
import { SIDEWAYS_COLS, footprintCols, isSideways } from './rotation';
import type { AppState, CaseItem, ModuleItem } from './types';
```

2. In `describeModule`, before the `is1u` line add:

```ts
  const rotation = m.placement?.rotation ?? 0;
  if (isSideways(rotation)) specs.push(`mounted sideways, rotated ${rotation}°, spans ${SIDEWAYS_COLS}HP`);
  else if (rotation === 180) specs.push('flipped 180°');
```

3. Add a helper above `describeRow` and replace `describeRow`:

```ts
const colsOf = (m: ModuleItem) => footprintCols(m, m.placement?.rotation);

function describeRow(c: CaseItem, row: number, modules: ModuleItem[]) {
  const entries = [
    ...modules
      .filter((m) => m.placement!.row === row)
      .map((m) => ({
        col: m.placement!.col,
        line: `- HP ${m.placement!.col}–${m.placement!.col + colsOf(m) - 1}: ${describeModule(m)}`,
      })),
    ...rowGaps(modules, c, row).map((g) => ({ col: g.col, line: `- HP ${g.col}–${g.col + g.hp - 1}: empty (${g.hp}HP)` })),
  ].sort((a, b) => a.col - b.col);
  const label = rowTypeOf(c, row) === '1U' ? `Row ${row} (1U):` : `Row ${row}:`;
  return [label, ...entries.map((e) => e.line)].join('\n');
}
```

4. In `summarizeLayout`, replace the header line `'HP columns are 1-indexed from the left edge of each row. Every row is a 3U Eurorack row.',` with:

```ts
    'HP columns are 1-indexed from the left edge of each row. Rows are 3U Eurorack rows unless labelled (1U), which are one third the height.',
    'A 1–4HP 3U module can lie sideways in a 1U row, where it spans 26HP; native 1U modules sit upright in 1U rows. 3U modules may be flipped 180°.',
```

5. In the per-case block, replace `const used = modules.reduce((n, m) => n + m.hp, 0);` with `const used = modules.reduce((n, m) => n + colsOf(m), 0);`.

6. In the selected-module block replace `selected.hp - 1` with `colsOf(selected) - 1`:

```ts
    const where = p && c ? `case "${c.name}", row ${p.row}, HP ${p.col}–${p.col + colsOf(selected) - 1}` : 'the tray';
```

- [ ] **Step 4: Run everything**

Run: `npm test && npm run typecheck`
Expected: all PASS (the existing accounting test still passes since all-3U rows keep the `Row N:` label), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/layoutSummary.ts test/layoutSummary.test.ts
git commit -m "feat: describe row types and rotation in the advisor summary

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: UI (panel rotation, drag, R key, editor, sidebar)

**Files:**
- Modify: `src/components/ModulePanel.tsx`
- Modify: `src/components/CaseView.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`
- Create: `test/fixtures/sample-1u-state.json` (dev aid for manual checking via **Load…**)

**Interfaces:**
- Consumes: everything above.
- Produces: `ModulePanel` gains `rotation?: Rotation` and `scale?: number`; `DropPreview` gains `rotation: Rotation`.

No unit tests here (React components, no DOM test setup in the repo). Verification is `tsc`, the existing tests, a production build and the manual check in Step 9.

- [ ] **Step 1: `ModulePanel` renders rotated panels**

Replace `src/components/ModulePanel.tsx`:

```tsx
import { useState } from 'react';
import { HP_PX, ROW_1U_PX, ROW_PX } from '../lib/geometry';
import { panelImageUrl } from '../lib/modulargrid';
import type { ModuleItem, Rotation } from '../lib/types';

interface Props {
  module: ModuleItem;
  /** Size of the box the panel occupies, i.e. already swapped for sideways panels. */
  width: number;
  height: number;
  rotation?: Rotation;
  /** Pixels per world unit; used to size the unrotated panel inside a rotated box. */
  scale?: number;
  className?: string;
  style?: React.CSSProperties;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  children?: React.ReactNode;
}

/** ModularGrid's panel image, with a labelled blank if it fails to load. */
export function ModulePanel({
  module,
  width,
  height,
  rotation = 0,
  scale = 1,
  className = '',
  style,
  onPointerDown,
  children,
}: Props) {
  const [failed, setFailed] = useState(false);
  const face = failed ? (
    <div className="flex h-full w-full items-center justify-center border border-neutral-500 bg-neutral-700">
      <span className="rotate-90 whitespace-nowrap text-[10px] text-neutral-200">{module.name}</span>
    </div>
  ) : (
    <img
      src={panelImageUrl(module)}
      alt={module.name}
      draggable={false}
      className="pointer-events-none block h-full w-full"
      onError={() => setFailed(true)}
    />
  );
  return (
    <div
      className={`select-none overflow-hidden ${className}`}
      style={{ width, height, ...style }}
      title={`${module.name} — ${module.vendor} (${module.hp}HP)${module.locked ? ' · locked' : ''}`}
      onPointerDown={onPointerDown}
    >
      {rotation === 0 ? (
        face
      ) : (
        <div className="relative h-full w-full">
          {/* The panel keeps its own upright size and is turned about the centre of the box. */}
          <div
            className="absolute top-1/2 left-1/2"
            style={{
              width: module.hp * HP_PX * scale,
              height: (module.is1u ? ROW_1U_PX : ROW_PX) * scale,
              transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
            }}
          >
            {face}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
```

- [ ] **Step 2: `CaseView` draws footprints**

In `src/components/CaseView.tsx`:

1. Imports: change the geometry import to

```ts
import { CASE_PAD, HP_PX, caseSize, colLeft, rowHeight, rowTop, rowTypeOf, snapToGrid } from '../lib/geometry';
```

(`ROW_PX` is no longer used there) and add

```ts
import { footprintCols } from '../lib/rotation';
```

and change the types import to `import type { CaseItem, ModuleItem, Rotation } from '../lib/types';`.

2. `DropPreview` gains the rotation:

```ts
export interface DropPreview {
  module: ModuleItem;
  row: number;
  col: number;
  rotation: Rotation;
  valid: boolean;
}
```

3. Used HP counts footprints. Replace `const usedHp = modules.reduce((n, m) => n + m.hp, 0);` with:

```ts
  const usedHp = modules.reduce((n, m) => n + footprintCols(m, m.placement?.rotation), 0);
```

4. Replace the module map and the preview block with:

```tsx
      {modules.map((m) => {
        const p = m.placement!;
        const rotation = p.rotation ?? 0;
        return (
          <ModulePanel
            key={m.id}
            module={m}
            width={footprintCols(m, rotation) * HP_PX}
            height={rowHeight(rowTypeOf(c, p.row))}
            rotation={rotation}
            className={`absolute ${m.locked ? 'cursor-default' : 'cursor-grab'} ${
              m.id === draggingId ? 'opacity-25' : ''
            } ${m.id === selectedId ? 'z-10 outline-2 outline-sky-400' : ''}`}
            style={{ left: CASE_PAD + colLeft(p.col), top: rowTop(c, p.row) }}
            onPointerDown={(e) => onModulePointerDown(e, m)}
          >
            {m.locked && <LockBadge />}
          </ModulePanel>
        );
      })}

      {preview && (
        <div
          className={`pointer-events-none absolute z-20 outline-2 ${
            preview.valid ? 'outline-emerald-400' : 'bg-red-500/40 outline-red-500'
          }`}
          style={{
            left: CASE_PAD + colLeft(preview.col),
            top: rowTop(c, preview.row),
            width: footprintCols(preview.module, preview.rotation) * HP_PX,
            height: rowHeight(rowTypeOf(c, preview.row)),
          }}
        >
          {preview.valid && (
            <ModulePanel
              module={preview.module}
              width={footprintCols(preview.module, preview.rotation) * HP_PX}
              height={rowHeight(rowTypeOf(c, preview.row))}
              rotation={preview.rotation}
              className="opacity-80"
            />
          )}
        </div>
      )}
```

- [ ] **Step 3: `App.tsx` drag carries a rotation**

In `src/App.tsx`:

1. Imports. Replace the geometry/placement/types imports with:

```ts
import { ROW_1U_PX, ROW_PX, HP_PX, caseSize, pointToSlot, rowTypeOf } from './lib/geometry';
import { nearestFreeCol } from './lib/placement';
import { allowedRotations, footprintCols, isSideways, nextRotation } from './lib/rotation';
import { historyReducer, isOutOfBounds, loadState, saveState, type Action } from './lib/store';
import type { AppState, CaseItem, ModuleItem, Rotation, RowType } from './lib/types';
```

2. Types. Replace `DropTarget` and `DragState`:

```ts
type DropTarget =
  | { kind: 'case'; caseId: string; row: number; col: number; rotation: Rotation; valid: boolean }
  | { kind: 'tray' }
  | null;

interface DragState {
  module: ModuleItem;
  clientX: number;
  clientY: number;
  /** Where the module was grabbed, as a fraction of its width/height. */
  grabFx: number;
  grabFy: number;
  /** The rotation the user asked for; the target may snap it to suit the row under the cursor. */
  rotation: Rotation;
  target: DropTarget;
}
```

3. Replace `findTarget`:

```ts
  const findTarget = (
    clientX: number,
    clientY: number,
    module: ModuleItem,
    grabFx: number,
    rotation: Rotation,
  ): DropTarget => {
    const { state, view } = latest.current;
    const trayRect = trayRef.current?.getBoundingClientRect();
    if (trayRect && inside(trayRect, clientX, clientY)) return { kind: 'tray' };

    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect || !inside(canvasRect, clientX, clientY)) return null;
    const wx = (clientX - canvasRect.left - view.x) / view.zoom;
    const wy = (clientY - canvasRect.top - view.y) / view.zoom;

    // Later cases render on top, so test them first.
    for (const c of [...state.cases].reverse()) {
      const slot = pointToSlot(c, wx, wy, module, rotation, grabFx);
      if (!slot) continue;
      const suits = allowedRotations(module, rowTypeOf(c, slot.row)).includes(slot.rotation);
      const col = suits
        ? nearestFreeCol(state.modules, c, slot.row, slot.col, footprintCols(module, slot.rotation), module.id)
        : null;
      return { kind: 'case', caseId: c.id, row: slot.row, col: col ?? slot.col, rotation: slot.rotation, valid: col !== null };
    }
    return null;
  };
```

4. In `onMove`, replace the two `setDrag` calls:

```ts
      if (p && !current) {
        if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < DRAG_THRESHOLD) return;
        pending.current = null;
        setSelectedId(p.module.id);
        const rotation = p.module.placement?.rotation ?? 0;
        setDrag({
          ...p,
          rotation,
          clientX: e.clientX,
          clientY: e.clientY,
          target: findTarget(e.clientX, e.clientY, p.module, p.grabFx, rotation),
        });
        return;
      }
      if (current) {
        setDrag({
          ...current,
          clientX: e.clientX,
          clientY: e.clientY,
          target: findTarget(e.clientX, e.clientY, current.module, current.grabFx, current.rotation),
        });
      }
```

5. In `onUp`, replace the case-drop dispatch:

```ts
      } else if (t?.kind === 'case' && t.valid) {
        const placement = { caseId: t.caseId, row: t.row, col: t.col, ...(t.rotation ? { rotation: t.rotation } : {}) };
        dispatch({ type: 'placeModule', id: d.module.id, placement });
      }
```

6. In `onKey`, add a branch before the `Escape` branch:

```ts
      } else if (!mod && e.key.toLowerCase() === 'r') {
        const { state, drag } = latest.current;
        if (drag) {
          // Mid-drag: turn the module as it would sit in the row under the cursor.
          const t = drag.target?.kind === 'case' ? drag.target : null;
          const c = t && state.cases.find((x) => x.id === t.caseId);
          const rowType: RowType | null = c && t ? rowTypeOf(c, t.row) : null;
          const rotation = nextRotation(drag.module, rowType, t ? t.rotation : drag.rotation);
          setDrag({ ...drag, rotation, target: findTarget(drag.clientX, drag.clientY, drag.module, drag.grabFx, rotation) });
        } else if (selectedRef.current) {
          dispatch({ type: 'rotateModule', id: selectedRef.current });
        }
```

(the existing `} else if (e.key === 'Escape') {` follows directly after this block.)

7. In the render section, replace `previewFor` and the ghost sizing:

```ts
  const previewFor = (caseId: string): DropPreview | null =>
    drag?.target?.kind === 'case' && drag.target.caseId === caseId
      ? {
          module: drag.module,
          row: drag.target.row,
          col: drag.target.col,
          rotation: drag.target.rotation,
          valid: drag.target.valid,
        }
      : null;

  const ghostSnapped = drag?.target?.kind === 'case' && drag.target.valid;
  const ghostRotation = drag?.target?.kind === 'case' ? drag.target.rotation : (drag?.rotation ?? 0);
  // The free-floating ghost is the panel itself, turned: a sideways 3U panel is ROW_PX wide and hp*HP_PX tall.
  const ghostLong = (drag?.module.is1u ? ROW_1U_PX : ROW_PX) * view.zoom;
  const ghostShort = (drag?.module.hp ?? 0) * HP_PX * view.zoom;
  const ghostW = isSideways(ghostRotation) ? ghostLong : ghostShort;
  const ghostH = isSideways(ghostRotation) ? ghostShort : ghostLong;
```

and the ghost element:

```tsx
          <ModulePanel module={drag.module} width={ghostW} height={ghostH} rotation={ghostRotation} scale={view.zoom} />
```

8. `EditCaseDialog`: add per-row 3U/1U toggles. Replace the state/derived block at the top of the component (from `const [name, setName]` through `const lockedEvicted = ...`) with:

```tsx
  const [name, setName] = useState(c.name);
  const [rows, setRows] = useState(c.rows);
  const [hp, setHp] = useState(c.hp);
  const [rowTypes, setRowTypes] = useState<RowType[]>(() => Array.from({ length: c.rows }, (_, i) => rowTypeOf(c, i + 1)));
  const types = Array.from({ length: rows }, (_, i) => rowTypes[i] ?? '3U');
  const outOfBounds = modules.filter((m) => isOutOfBounds(m, { id: c.id, rows, hp, rowTypes: types }));
  const evicted = outOfBounds.length;
  const lockedEvicted = outOfBounds.filter((m) => m.locked).length;
```

change the label `Rows (3U)` to `Rows`, change the submit to `onSave({ name: name.trim() || c.name, rows, hp, rowTypes: types });`, and insert this block directly after the `<div className="flex gap-2">…</div>` that holds the Rows/Width inputs:

```tsx
        <div className="text-xs text-neutral-400">
          Row heights
          <div className="mt-1 flex flex-wrap gap-1">
            {types.map((t, i) => (
              <button
                key={i}
                type="button"
                title="Toggle 3U / 1U"
                className={`rounded px-2 py-0.5 text-xs ${
                  t === '1U' ? 'bg-sky-700 text-white' : 'bg-neutral-900 text-neutral-300 hover:bg-neutral-700'
                }`}
                onClick={() => setRowTypes(types.map((x, j) => (j === i ? (x === '1U' ? '3U' : '1U') : x)))}
              >
                {i + 1}: {t}
              </button>
            ))}
          </div>
        </div>
```

- [ ] **Step 4: Sidebar: rotate button, 1U tray size, import message**

In `src/components/Sidebar.tsx`:

1. Imports:

```ts
import { HP_PX, ROW_1U_PX, ROW_PX, rowTypeOf } from '../lib/geometry';
import { nextRotation } from '../lib/rotation';
```

and add `RowType` to the types import: `import type { AppState, CollectionEntry, CollectionModule, ImportedRack, ModuleItem, RowType } from '../lib/types';`.

2. `SelectedModule` gets the row type. Change its props and add the button:

```tsx
function SelectedModule({
  module,
  caseName,
  rowType,
  dispatch,
}: {
  module: ModuleItem;
  caseName: string | null;
  rowType: RowType | null;
  dispatch: React.Dispatch<Action>;
}) {
  const rotation = module.placement?.rotation ?? 0;
```

Change the location line to include the rotation:

```tsx
        {module.placement
          ? `In ${caseName ?? 'a case'}, row ${module.placement.row}, HP ${module.placement.col}${
              rotation ? ` · rotated ${rotation}°` : ''
            }`
          : 'In the tray'}
```

and add this button right after the Lock button's `{module.placement && (…)}` block:

```tsx
        {module.placement && rowType && (
          <button
            className={buttonClass}
            disabled={module.locked || nextRotation(module, rowType, rotation) === rotation}
            onClick={() => dispatch({ type: 'rotateModule', id: module.id })}
            title="Rotate (R)"
          >
            Rotate
          </button>
        )}
```

3. Where `SelectedModule` is rendered pass the row type:

```tsx
          <SelectedModule
            module={selected}
            caseName={selectedCase?.name ?? null}
            rowType={selected.placement && selectedCase ? rowTypeOf(selectedCase, selected.placement.row) : null}
            dispatch={dispatch}
          />
```

4. Tray panel height (1U modules are shorter):

```tsx
                  height={(m.is1u ? ROW_1U_PX : ROW_PX) * TRAY_SCALE}
```

5. The import message. Replace `(oneU ? \` ${oneU} 1U module(s) went to the tray (1U rows aren't supported yet).\` : '')` with:

```ts
          (oneU
            ? ` ${oneU} 1U module(s) went to the tray: imported cases have 3U rows only. Switch a row to 1U in Edit case, then drag them in.`
            : '') +
```

(keep the following `(rack.format !== 'e' ? … : '')` expression unchanged.)

- [ ] **Step 5: Add the manual-check fixture**

Create `test/fixtures/sample-1u-state.json` (load it with **Load…** in the sidebar; panel images will fall back to labelled blanks):

```json
{
  "cases": [
    { "id": "case-1", "name": "Mixed 104HP", "rows": 3, "hp": 104, "rowTypes": ["3U", "1U", "1U"], "x": 0, "y": 0 }
  ],
  "modules": [
    { "id": "m-wide", "moduleId": "1", "versionId": null, "name": "Wide 12HP", "vendor": "Test", "description": "", "slug": "wide", "hp": 12, "is1u": false, "power": { "plus12": 10, "minus12": 10, "plus5": 0 }, "source": "fixture", "placement": { "caseId": "case-1", "row": 1, "col": 1 } },
    { "id": "m-narrow", "moduleId": "2", "versionId": null, "name": "Narrow 2HP", "vendor": "Test", "description": "", "slug": "narrow", "hp": 2, "is1u": false, "power": { "plus12": 5, "minus12": 0, "plus5": 0 }, "source": "fixture", "placement": null },
    { "id": "m-four", "moduleId": "3", "versionId": null, "name": "Four 4HP", "vendor": "Test", "description": "", "slug": "four", "hp": 4, "is1u": false, "power": { "plus12": 5, "minus12": 5, "plus5": 0 }, "source": "fixture", "placement": null },
    { "id": "m-five", "moduleId": "4", "versionId": null, "name": "Five 5HP", "vendor": "Test", "description": "", "slug": "five", "hp": 5, "is1u": false, "power": { "plus12": 5, "minus12": 5, "plus5": 0 }, "source": "fixture", "placement": null },
    { "id": "m-tile", "moduleId": "5", "versionId": null, "name": "Tile 8HP 1U", "vendor": "Test", "description": "", "slug": "tile", "hp": 8, "is1u": true, "power": { "plus12": 20, "minus12": 0, "plus5": 0 }, "source": "fixture", "placement": null }
  ]
}
```

- [ ] **Step 6: Typecheck, test, build**

Run: `npm run typecheck && npm test && npm run build 2>&1 | tail -5`
Expected: tsc clean, all tests PASS, build finishes with `built in …`. If `tsc` reports an unused import in `App.tsx` (for example `isSideways` or `RowType`) it means a step above was skipped; fix by completing that step rather than deleting the import.

- [ ] **Step 7: Manual check in the browser**

Run: `npm run dev` and open http://localhost:5173. Click **Load…** and pick `test/fixtures/sample-1u-state.json`. Verify each:

1. The case shows one tall row followed by two short (1U) rows; the gap labels in the 1U rows are readable.
2. Drag **Narrow 2HP** from the tray over row 2: a green outline 26 columns wide and 1U tall appears, with the panel turned sideways. Drop it. Selecting it shows "rotated 90°".
3. Press **R** with it selected: it becomes 270° (flipped). Press **R** again: 90°.
4. Drag **Four 4HP** onto the same 26-column span of row 2: red outline (overlap). Move it right of the first module (columns 27+) or into row 3: green.
5. Drag **Five 5HP** over row 2: red outline (not sideways-capable); over row 1: green upright.
6. Drag **Tile 8HP 1U** over row 1: red; over row 3: green, upright, 1U tall. Over row 1 it never snaps.
7. Select **Wide 12HP** in row 1, press **R**: it flips 180° (the panel label/image is upside down). The sidebar **Rotate** button works the same.
8. While dragging **Narrow 2HP** from the tray, press **R** over row 1: the preview flips 0° ↔ 180°; over row 2: 90° ↔ 270°.
9. **Edit** the case, toggle row 1 to 1U: the dialog warns that modules won't fit; save: **Wide 12HP** goes to the tray. Undo (⌘Z) brings it back.
10. Reload the page: the layout, rotations and row types persist.
11. Open **Chat** and send "describe my layout": the request payload isn't visible, but confirm there are no console errors.

- [ ] **Step 8: Commit**

```bash
git add src test/fixtures/sample-1u-state.json
git commit -m "feat: 1U rows and module rotation in the UI

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs and final verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-11-02-1u-rows-and-rotation-design.md`

- [ ] **Step 1: Update the README**

In `README.md`, replace the **Cases** bullet's last sentence and the **Modules** and **Keys** bullets:

- **Cases:** after "…modules that no longer fit go to the tray." add: " **Edit** also lets you set each row to 3U or 1U; changing a row's type sends modules that don't suit it to the tray."
- **Modules:** append: " 1U modules go in 1U rows. A 1–4HP 3U module snaps sideways into a 1U row (it then spans 26HP, one module per span). 3U modules can be flipped 180° in 3U rows."
- **Keys:** add `R` rotates the selected module (or the one being dragged): 0°↔180° in 3U rows, 90°↔270° in 1U rows.

- [ ] **Step 2: Align the spec with the implementation**

In the spec, in the **Store** section replace

`New action \`rotateModule { id, step }\` rotates a placed module by 90°, skipping to the next rotation that is valid for its row, and only if it still fits. No-op for locked modules and when nothing valid fits.`

with

`New action \`rotateModule { id }\` moves a placed module to the next 90° step that is valid for its row (0↔180 in 3U rows, 90↔270 in 1U rows). Both rotations in a row type have the same width, so it can't collide. No-op for locked and unplaced modules and when nothing valid exists.`

- [ ] **Step 3: Full verification**

Run: `npm test && npm run typecheck && npm run build 2>&1 | tail -3`
Expected: all tests PASS (41 original plus the new ones), tsc clean, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add README.md docs
git commit -m "docs: document 1U rows and rotation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage**
- Data model (`rowTypes`, `rotation`, `ROW_1U_PX`, footprint): Tasks 1–2.
- Rotation table, snapping, one module per span: Task 1 (`allowedRotations`, `snapRotation`), Task 2 (`pointToSlot`), Task 3 (`canPlace`, overlap on column ranges).
- Placement functions use footprints and row types: Task 3.
- Native `is1u` placeable in 1U rows, rack import places only when allowed: Tasks 3–4.
- Store (`placeModule` rotation, `updateCase` rowTypes with eviction and locked block, `rotateModule`, `addCase`/`importRack` produce no `rowTypes`): Task 4. `placeModule` already stores the whole `Placement`, so rotation flows through unchanged.
- UI (editor toggles, row heights, footprints, panel rotation, `R` including mid-drag, sidebar Rotate button, preview): Task 6.
- Chat advisor summary: Task 5.
- Tests listed in the spec: Tasks 1–5.
- Out of scope items untouched.

**Placeholder scan:** none; every step has code or an exact command.

**Type consistency:** `Rotation`/`RowType` defined in Task 1 and used unchanged. `pointToSlot` returns `{row, col, rotation}` (Task 2) and is consumed that way in Task 6. `fits`/`nearestFreeCol` fifth parameter is `cols` (Task 3), called with `footprintCols(...)` in Task 6. `canPlace` takes `{row, col, rotation?}` (Task 3), used in Task 4. `DropPreview.rotation` added in Task 6 step 2 and supplied in step 3. `nextRotation(m, rowType | null, current)` (Task 1) used identically in Tasks 4 and 6. The `rotateModule` action has no `step`; the spec is aligned in Task 7.
