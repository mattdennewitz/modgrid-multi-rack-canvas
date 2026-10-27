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
  the modules go into the tray.
- **Collection:** paste a profile URL (e.g. `https://modulargrid.net/s/users/view/254121`) in the same box to
  import everything in that user's public collection. Modules go to the tray. A collection has no quantities, so
  anything already in the app (matched by slug) is skipped; use duplicate for multiples. Specs come from each
  module's page, fetched once and cached in `.cache/modulargrid/`, so the first import of ~70 modules takes about
  a minute and later ones are instant.
- **Cases:** add one from a preset or with custom rows and HP. Drag the header to move it. Double-click the
  header (or click **Edit**) to rename or resize. If you shrink a case, modules that no longer fit go to the tray.
- **Modules:** drag between cases and the tray. Modules snap to the 1HP grid. If you drop on an occupied
  spot, the module shifts to the nearest free gap within 12HP. A red outline means it won't fit.
- **Locks:** select a placed module and press `L` (or **Lock** in the sidebar) to pin it. A locked module can't
  be dragged, sent to the tray or removed, and a case can't be resized in a way that would push it out. It
  moves with its case. Deleting the case unlocks it.
- **Keys:** `⌘Z` / `⇧⌘Z` undo/redo. `L` toggles the lock. `Delete` sends the selected module to the tray, and pressing it again
  removes the module. `Esc` cancels a drag.
- **Canvas:** scroll to pan, pinch or `⌘`+scroll to zoom, drag empty space to pan. **Fit** frames all cases.
- **Saving:** the layout autosaves to localStorage. Use **Export**/**Load…** for JSON backups.

## Layout advisor (chat)

Click **Chat** in the toolbar. The advisor sees your current layout every time you send a message: cases,
rows, modules with HP, depth and power, empty gaps, locks, the tray, and the selected module. It gives advice
only and can't change the layout. Suggested moves are written as `Move X → case, row, HP a–b` for you to do
by hand. Chat history is saved in the browser (`rack-canvas:chat:v1`). **Clear** wipes it.

Configure in `.env` (read server-side only; never exposed to the browser):

```sh
OPENROUTER_API_KEY=...                       # required
OPENROUTER_MODEL=openai/gpt-6-luna           # optional, any OpenRouter model id
OPENROUTER_MAX_TOKENS=16000                  # optional cap; reasoning and answer share it
OPENROUTER_REASONING_EFFORT=medium           # optional: low | medium | high
```

Values in `.env` take priority over the same variables exported in your shell.

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

- Eurorack 3U only. 1U modules are imported to the tray but can't be placed.
- Only public racks and public collections can be imported. The server fetches pages without your ModularGrid login.
