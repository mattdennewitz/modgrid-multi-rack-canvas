# Drag and drop rows

## Goal

Let a row be dragged to a new position in its own case, or into another case of the same width. The row's modules and its 3U/1U type go with it.

## Interaction

- Every row has a grip strip in the case's left padding (the existing 14px `CASE_PAD` gutter), as tall as the row. Dragging the strip starts a row drag. Module drags and case-header drags are unaffected.
- While dragging, the source row's modules dim and an insertion line is drawn between rows of the case under the cursor. Green means the drop is allowed, red means it is refused.
- The insertion point is before the first row whose vertical midpoint is below the cursor, or after the last row.
- A target must be the same case or a case with the same `hp`. Over a case of a different width there is no line and a drop does nothing. `Esc` cancels. A completed drop is one undo step.

## Store

- New action `moveRow { fromCaseId, fromRow, toCaseId, toIndex }`. `toIndex` is the insertion point, 1 to rows+1 of the target, counted before the row is removed.
- Within one case this is a reorder: the row lands at `toIndex` (minus one when it moves down) and the rows between renumber by one. `toIndex` equal to `fromRow` or `fromRow + 1` is a no-op.
- Across cases the source loses the row (rows below renumber up by one) and the target gains it at `toIndex` (rows at or below renumber down by one).
- The row's modules keep `col`, `rotation` and `locked`; they get the new `caseId` and row number. The row's 3U/1U type moves with it. Widths are equal and each row keeps its type, so nothing leaves the case and every rotation stays valid.
- `rowTypes` is normalised as in `updateCase`: padded to `rows`, and absent when every row is 3U.
- The reducer returns the same state object when a move is refused or changes nothing. The UI uses that to colour the insertion line.

## Refusals

- Target `hp` differs from the source's.
- Source and target are different cases and the source has one row (a case keeps at least one row).
- Locks: the moved row holds a locked module, or any row whose number would change (in either case) holds one. Locked modules never change position.
- A row or insertion index out of range.

## Geometry

- `rowInsertIndex(c, wy)`: insertion point for a world-space y over case `c`.
- `insertionLineY(c, index)`: y of the indicator relative to the case origin, centred in the gap between rows (or just above the first row / below the last).

## Not included

Other cases are not pushed out of the way when a case grows taller (same as editing rows today). Dragging a row to the tray or onto empty canvas does nothing.

## Tests

Store: reorder down and up, no-op indices, cross-case move (renumbering on both sides, row type and rotation travel), unequal width, source with one row, and each lock refusal. Geometry: `rowInsertIndex` and `insertionLineY` on a mixed 3U/1U case. The drag itself is checked in headless Chrome.
