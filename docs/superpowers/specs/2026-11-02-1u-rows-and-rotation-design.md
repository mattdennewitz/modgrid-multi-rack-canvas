# 1U rows and module rotation

## Goal

Let a case mix 3U and 1U rows, and let modules be rotated so narrow 3U modules can sit sideways in a 1U row.

## Data model

- `CaseItem.rowTypes?: ('3U' | '1U')[]`, one entry per row. Missing means every row is 3U, so old saves and exports load unchanged. `rows` stays the row count. If `rowTypes` and `rows` disagree, treat missing entries as `'3U'`.
- `Placement.rotation?: 0 | 90 | 180 | 270`. Missing means 0.
- Geometry (`geometry.ts`): `ROW_1U_PX = 88` (44.45mm at the app's 255px = 128.5mm scale). `rowHeight(type)`, `rowTop`, `caseSize` and `pointToSlot` take the case's row types, so rows of mixed height stack correctly.
- Footprint helper `footprint(module, rotation)` returns `{ w, h }` in HP columns and px. Upright (0/180): `w = hp`, panel height is the row height. Sideways (90/270): `w = ceil(ROW_PX / HP_PX) = 26` columns, `h` is the full 1U row.

## Rotation rules

| Module | Row type | Allowed rotations |
|---|---|---|
| 3U, any HP | 3U | 0, 180 (flip) |
| 3U, 1–4HP | 1U | 90, 270 (sideways) |
| native 1U (`is1u`), any HP | 1U | 0, 180 |
| 3U, more than 4HP | 1U | not allowed |
| native 1U | 3U | not allowed |
| 3U, 1–4HP | 3U sideways | not allowed |

- Snapping: dragging a 1–4HP 3U module over a 1U row snaps it to 90 (keeping 270 if it already had 270). Dragging it over a 3U row snaps it back to an upright rotation (0 or 180).
- One module per horizontal span: a sideways module takes the full 1U row height over its 26 columns even if it is only 1HP thick. No stacking within a row.

## Placement (`placement.ts`)

- `fits`, `nearestFreeCol` and `rowGaps` use the footprint width and the row's type. A placement is invalid if the rotation/row-type pair is not in the table above.
- Overlap stays per row on column ranges.
- Native `is1u` modules are now placeable. Rack imports place them using their source row/col only when the target row is 1U; otherwise they go to the tray, as today.

## Store (`store.ts`)

- `placeModule` carries `rotation` through `Placement`.
- `updateCase` accepts `rowTypes`. Changing a row type or shrinking the case evicts modules whose placement no longer fits to the tray. A locked module that would be evicted blocks the change, matching today's resize rule.
- New action `rotateModule { id }` moves a placed module to the next 90° step that is valid for its row (0↔180 in 3U rows, 90↔270 in 1U rows). Both rotations in a row type have the same width, so it can't collide. No-op for locked and unplaced modules and when nothing valid exists.
- `addCase` and `importRack` produce no `rowTypes` (all 3U) unless specified.

## UI

- Case editor: per-row 3U/1U toggle.
- `CaseView`: row height follows the row type. Modules, the gap labels and the drop preview use the footprint. The panel image is rotated with a CSS transform.
- `R` rotates the selected placed module, or the module being dragged, by 90°. The sidebar gets a Rotate button, disabled when no other rotation is valid.
- The red/green drop outline uses the rotated footprint.

## Chat advisor

`layoutSummary.ts` reports each row's type and each module's rotation when non-zero.

## Tests

- `placement.test.ts`: each row of the rotation table, the 26-column sideways footprint, overlap in a 1U row, `nearestFreeCol` with sideways modules.
- `store.test.ts`: `rotateModule` cycling and skipping, row-type change eviction, locked-module block, old saves with no `rowTypes` or `rotation`.
- `layoutSummary.test.ts`: row types and rotation appear in the summary.

## Out of scope

Stacking several sideways modules in one 1U row, 1U rows in presets, importing row types from ModularGrid racks.
