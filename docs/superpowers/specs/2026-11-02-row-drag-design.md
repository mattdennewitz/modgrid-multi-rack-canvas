# Drag and drop rows

## Goal

Let a row be dragged to a new position in its own case, or into another case of the same width. A case's size is predefined, so no case ever gains or loses a row.

## Model

Rows are fixed slots. Dragging moves what is in a row, not the row itself.

- **Within one case:** the row is reordered. The other rows renumber by one, and the row count does not change. No blank rows are added.
- **Into another case:** the row you drop on and the row you dragged swap contents (their modules, with `col`, `rotation` and `locked`). Dropping on an empty row is a plain move, and the source is left with a blank row where the dragged row was. Neither case changes size.
- The two rows must be the same type (3U/1U), because a 1U row can't become 3U and a swap must not change any case's height.

## Interaction

- Every row has a grip strip in the case's left padding (the existing 14px `CASE_PAD` gutter), as tall as the row. Dragging it starts a row drag. Module drags and case-header drags are unaffected.
- While dragging, the dragged row's modules dim. Over its own case a green/red insertion line shows where the row would land (before the first row whose midpoint is below the cursor, or after the last). Over another case of the same width the row under the cursor is outlined green/red. Over a case of a different width nothing is shown and a drop does nothing.
- `Esc` cancels. A completed drop is one undo step.

## Store

- `reorderRow { caseId, fromRow, toIndex }`: `toIndex` is the insertion point (1 to rows+1) counted before the row is removed. `toIndex` equal to `fromRow` or `fromRow + 1` is a no-op. The row's type moves with it, and `rowTypes` stays normalised.
- `swapRows { aCaseId, aRow, bCaseId, bRow }`: trades the modules of two rows (also valid within one case). The cases array is untouched.
- Both return the same state object when refused or when nothing changes, so the UI colours its indicator by comparing `reducer(state, action) !== state`.

## Refusals

- `swapRows`: different `hp`; different row types; a row out of range; the same row; either row holds a locked module; both rows empty (nothing to do).
- `reorderRow`: a row or index out of range; the moved row or any row whose number would change holds a locked module (locked modules never change position).

## Geometry

- `rowAtY(c, wy)`: the row under a world-space y (the gap below a row belongs to it; clamps at the ends). `pointToSlot` uses it.
- `rowInsertIndex(c, wy)` and `insertionLineY(c, index)` for the within-case insertion line.

## Not included

Dragging a row to the tray or empty canvas does nothing. Swapping rows of different types is not supported.

## Tests

Store: reorder down and up, no-op indices, row count unchanged, locks; swap between populated rows, into an empty row (blank left behind, cases unchanged), rotation kept, 1U with 1U, refusals (type, width, range, same row), both-empty no-op, locks. Geometry: `rowAtY`, `rowInsertIndex`, `insertionLineY`. The drag is checked in headless Chrome.
