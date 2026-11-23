# Rack Canvas

Lay out all of your Eurorack cases on one canvas, using modules imported from ModularGrid.

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # parser, placement and store tests
```

## Using it

- **Import:** paste a rack URL (e.g. `https://modulargrid.net/e/racks/view/3246217`) or its id. With
  "Create a case with this layout" checked, you get a case that matches the ModularGrid rack. Unchecked,
  the modules are only added to your inventory (the tray).
- **Collection:** paste a profile URL (e.g. `https://modulargrid.net/s/users/view/254121`) in the same box to
  import everything in that user's public collection. Modules go to your inventory. A collection has no quantities, so
  anything already in the app (matched by slug) is skipped; use **Add another** for multiples. Specs come from each
  module's page, fetched once and cached in `.cache/modulargrid/`, so the first import of ~70 modules takes about
  a minute and later ones are instant.
- **Inventory:** the tray is your inventory, with one entry per module you own. Entries are never used up: a module
  can go into any number of cases, any number of times, and the number on a tray tile shows how many times it is placed
  on the canvas you are viewing.
  Dragging from the tray places a copy. Dragging a placed copy moves it, and dragging it back to the tray (or `Delete`)
  takes that copy out of the case without touching the inventory. Importing a rack or collection never adds a module you
  already own, so importing the same rack twice leaves the inventory alone. **Remove from inventory** (on a tray entry,
  or `Delete` on it) deletes the module and every copy of it on every canvas, after a confirmation that says so, and is
  refused while a copy is locked anywhere — the warning names the canvas holding it, since it may not be the one on screen.
- **Canvases:** a canvas is one whole rack configuration — all of its cases and everything placed in them. **Fork** a
  canvas to branch it: you get a copy of every case and placed module, recorded as its child, and you land on the fork
  so the original is safe to leave alone. The **Canvases** list in the sidebar shows the resulting lineage as a tree, so
  you can see what each layout came from; click a row to switch to it, and use the row menu to rename or delete it.
  Deleting a canvas moves its forks up to its parent rather than taking them with it. One canvas is **primary**, the
  star in the list, meaning "this is my real rig" — promoting a canvas marks it without moving it in the tree, and it is
  separate from the canvas you happen to be viewing. **Your inventory is global and shared by every canvas:** forking
  never adds, removes or duplicates anything you own, and the count on a tray tile is for the canvas you are looking at.
  Note that **Remove from inventory** still reaches every canvas, since you no longer own the module anywhere.
- **Cases:** add one from a preset or with custom rows and HP. Drag the header to move it. Double-click the
  header (or click **Edit**) to rename or resize. If you shrink a case, modules that no longer fit are taken out of the case. **Duplicate** copies a case next to the others, with its modules in the same spots. **Edit** also sets each row to 3U or 1U; changing a row's type takes out modules that don't suit it.
- **Rows:** a case's row count is fixed. Drag the grip strip at the left edge of a row to reorder rows within its case
  (a green line shows where it lands). Drop it onto a row of another case of the same width to swap the two rows' modules;
  dropping onto an empty row moves the modules and leaves a blank row behind. Both rows must be the same type (3U or 1U),
  and a row holding a locked module can't move. Red means the drop isn't allowed. `Esc` cancels.
- **Modules:** drag from the tray into cases, or between cases. Modules snap to the 1HP grid. If you drop on an occupied
  spot, the module shifts to the nearest free gap within 12HP. A red outline means it won't fit. 1U modules go in 1U rows. A 1–4HP 3U module snaps sideways into a 1U row (it then spans 26HP, one module per span), and 3U modules can be flipped 180° in 3U rows.
- **Locks:** select a placed module and press `L` (or **Lock** in the sidebar) to pin it. A locked module can't
  be dragged, taken out of its case or removed, and a case can't be resized in a way that would push it out. It
  moves with its case. Locks belong to a placed copy, not to the inventory entry.
- **Keys:** `⌘Z` / `⇧⌘Z` undo/redo. `L` toggles the lock. `R` rotates the selected module, or the one being dragged: 0°↔180° in 3U rows, 90°↔270° in 1U rows. `Delete` takes the selected copy out of its case, and on a tray entry
  removes the module. `Esc` cancels a drag.
- **Canvas:** scroll to pan, pinch or `⌘`+scroll to zoom, drag empty space to pan. **Fit** frames all cases.
- **Saving:** every canvas autosaves to localStorage, under `rack-canvas:v2`. Saves written before canvases existed
  (`rack-canvas:v1`) load automatically as a single canvas named "Main", and that older key is left untouched as a
  backstop. Use **Export**/**Load…** for JSON backups; an export carries the whole forest, lineage included, and
  **Load…** accepts both formats. If storage is ever full the app says so rather than quietly dropping changes.

## How it works

ModularGrid rack pages embed their full state as JSON in `<script data-mg-json="rtd">`. They don't send CORS
headers, so a Vite middleware (`server/modulargridApi.ts`) fetches the page server-side. It is exposed as
`GET /api/rack/:id`, which returns parsed JSON (`src/lib/parseRack.ts`). `GET /api/collection/:userId` and
`GET /api/module/:slug` work the same way (`parseCollection.ts`, `parseModule.ts`). Requests identify themselves
honestly, run one at a time and at least 1s apart, and only happen when you click Import. Panel images are hotlinked from
`modulargrid.net/img/modcache/{id}.r@2x.png`.

The endpoint lives in the Vite dev/preview server, so use `npm run dev` or `npm run build && npm run preview`.
A static deploy would need that route reimplemented as a serverless function.

## Limitations

- Eurorack 3U only. 1U modules are added to the inventory but can't be placed in imported cases until a row is switched to 1U.
- Only public racks and public collections can be imported. The server fetches pages without your ModularGrid login.
