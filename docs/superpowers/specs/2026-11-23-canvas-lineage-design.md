# Fork a canvas, keep its lineage, promote one to primary

## Goal

Make the **canvas** a first-class, forkable unit, so an alternative layout can be tried without losing the real one.
Forking records where a canvas came from, giving a lineage forest you can browse. One canvas, app-wide, is **primary** —
a bookmark meaning "this is my real rig" — and promoting a canvas to primary never moves it in the tree.

Before this, `AppState` was `{ cases, modules }`: one shared canvas, and the only copy verb was `duplicateCase`, which
cloned a single case with no record of its origin.

## Model

A canvas owns its cases and the placed copies in them. The module pool stays global and outside every canvas.

```ts
type PlacedModule = ModuleItem & { placement: Placement };

interface Canvas {
  id: string;
  name: string;
  parentId?: string;   // missing means a root of the forest
  cases: CaseItem[];   // array order is z-order and hit-test priority, as AppState.cases was
  placed: PlacedModule[];
}

interface AppState {
  canvases: Canvas[];  // flat; the forest is the parentId edges. Never empty.
  activeId: string;    // the canvas you view and edit
  primaryId: string;   // the bookmark: a label and a sibling sort key, nothing more
  modules: ModuleItem[]; // the global pool, one record per module owned, every placement null
}
```

`CaseItem`, `Placement` and `ModuleItem` are unchanged, which is why `placement.ts` and `geometry.ts` needed no edits:
they already filter on `p.caseId !== c.id` and take `Pick<CaseItem, …>`, and a fork mints fresh case ids, so ids stay
unique app-wide and canvases are isolated for collision purposes for free.

- **The pool is global by construction.** A pool record has no `placement`, therefore no case, therefore no canvas —
  there is nowhere for a canvas to put one. `forkCanvas` returns `{ ...state, canvases }`, so
  `expect(forked.modules).toBe(state.modules)` proves in one line that forking touched nothing you own.
- **Primary and active are independent pointers.** They are pointers rather than a per-canvas flag, so "exactly one
  primary" is unrepresentable otherwise and needs no repair pass.
- **Primary is cosmetic.** It contributes a badge and hoists a canvas among *its own siblings* in the tree. It does not
  affect rendering, placement, stats, export contents, or which canvas loads at startup.
- `inventoryOf`/`placedOf` are gone: the pool is `state.modules` and the placed copies are `canvas.placed`.

## Interaction

- A **Canvases** section heads the sidebar, listing the forest as an indented, flattened list. A row shows the canvas
  name, a star when primary, and `N cases · M modules`, plus a fork count when it has forks. The active row is filled.
- Clicking a row switches to that canvas. A **fork** icon button forks it in one click; you land on the fork, and
  primary stays put. A **⋯** menu holds *Make primary* (hidden on the primary), *Rename* (inline input) and *Delete*
  (hidden when it is the last canvas).
- **Promoting is not confirmed:** one pointer, non-destructive, visible immediately, and undoable. **Deleting is**, with
  a description naming the cases that go, where the forks land, and that the inventory is untouched.
- Switching canvases clears the selection and any half-finished drag, then frames the new canvas. The window-level
  pointer handlers read `latest.current.drag`, which would otherwise still hold a module from the canvas you left.
- The tray's "×N placed" badge counts the **active** canvas only, so experimental forks don't inflate it.

## Store

- `forkCanvas { id, name? }` — deep-copies a canvas as its child, with fresh case and record ids, the same case `x`/`y`,
  and locks dropped. Sets `activeId` to the fork and leaves `primaryId` alone. Name defaults to `"<source> fork"`.
- `setPrimaryCanvas { id }` — assigns `primaryId` and nothing else. `canvases` and every `parentId` pass through by
  reference, which is the whole of "promote without moving it in the tree".
- `setActiveCanvas { id }` — assigns `activeId`. A run of consecutive switches coalesces into one undo step.
- `renameCanvas { id, name }`, `deleteCanvas { id }` — delete moves the canvas's forks up to its parent (a deleted
  root's forks become roots) and moves either pointer off it onto its parent, else the first remaining canvas.
- The eleven case and placement actions act on the active canvas implicitly, via `inActive(state, fn)`, which returns
  the same *state* object when `fn` returns the same *canvas*. So every old `return state` refusal became `return c`
  and the `reducer(s, a) === s` contract survives one level down, unchanged for callers.
- `removeModule` is the exception: it sweeps **every** canvas, because the pool is global and every placed module must
  have a pool record. Its locked-copy check spans the forest too.
- `activeId` lives inside the undoable state because `forkCanvas` sets it. Outside history, undoing a fork would delete
  the canvas you are looking at and leave the pointer dangling.

## Refusals

Return the same state object, so `historyReducer` spends no undo step:

- `forkCanvas`, `setActiveCanvas`, `setPrimaryCanvas`, `renameCanvas`, `deleteCanvas`: unknown `id`.
- `setActiveCanvas` / `setPrimaryCanvas`: already active / already primary.
- `renameCanvas`: trimmed name empty or unchanged.
- `deleteCanvas`: it is the last canvas. Not refused by locked copies, matching `deleteCase`.
- `setLocked` on a pool record: a pool record has nothing to lock.

## Migration

Old saves and exported files are bare `{ cases, modules }`.

- `toAppState(unknown)` accepts either shape and repairs it, testing `canvases` first so a hand-merged file carrying
  both loads as a forest. It runs at the two I/O boundaries — `loadState` and the sidebar's **Load…** — so `replace`
  stays total over the live shape and only one function faces untrusted input.
- `migrateLegacy` wraps everything in one root canvas and lifts the pool out of the mixed `modules` array.
- `normalizeInventory` (pool invariants, forest-wide) and `normalizePrimary` (a canvas always exists; no self, dangling
  or cyclic `parentId`; valid pointers) both return the same object when nothing changes. Invalid pointers fall back to
  `canvases[0]`, never to the primary, which would let primary decide what loads.
- **The storage key bumped to `rack-canvas:v2`, reading v2 then v1 and writing only v2.** Writing the new shape into
  `v1` would be data loss: an older build fails its `Array.isArray(v.cases)` check, falls back to an empty state, and
  the autosave effect then overwrites the save. `v1` is never deleted, so a rollback is lossless.
- `saveState` now returns a boolean and the app warns once on failure, instead of losing work silently on a full quota.

## Not included

- No "new empty canvas" action. The only source of extra roots is a deleted root's forks.
- Cross-canvas row swaps. `swapRows` can only see one canvas, so they are impossible by construction rather than
  blocked by a check.
- Storing `placed` as `{ moduleId, caseId, row, col, rotation?, locked? }` references instead of full `ModuleItem`
  clones. A placed record serializes to ~386 bytes, so a 28-module canvas is ~11 KB and the ~5 MB quota allows roughly
  450 forks; references would shrink saves ~10× but churn `ModulePanel`, `CaseView`, power summing and every
  `Placed`-shaped signature in `placement.ts`. Orthogonal to lineage.
- Any server-side persistence. Lineage lives in localStorage and exported JSON.

## Tests

- `test/lineage.test.ts` — pre-order flatten with depth and fork counts; the primary sorts first among its siblings
  only; cycles, self-parents and dangling parents still show every canvas exactly once; ancestors nearest-first,
  stopping on a cycle.
- `test/store.test.ts`
  - `canvases`: fork lands you on the fork and leaves primary alone; the source canvas and pool are untouched *by
    identity*; deep copies get fresh ids at the same spots; a fork of a fork parents to the fork; editing one canvas
    leaves its fork identical by reference; promote leaves `canvases` identical by reference; delete reparents forks
    and moves both pointers; the last delete is refused; `removeModule` sweeps the forest and refuses on a lock you
    cannot see; switches coalesce into one undo step. Plus an `Object.keys(fork)` guard so a new `Canvas` field fails a
    test until `forkCanvas` handles it deliberately.
  - `legacy saves`: `sample-1u-state.json` migrates to one root canvas, backfilling the pool record its placed module
    lacks; a healthy state normalizes to the identical object; a hand-broken forest is repaired without losing a
    canvas; neither-shape input returns null.
- `test/placement.test.ts` and `test/rotation.test.ts` were untouched, which is the check that the model kept them
  canvas-agnostic.
