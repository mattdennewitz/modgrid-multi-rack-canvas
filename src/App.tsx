import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Canvas, clampZoom, zoomAt, type View } from './components/Canvas';
import { CaseView, type DropPreview } from './components/CaseView';
import { ModulePanel } from './components/ModulePanel';
import { Sidebar } from './components/Sidebar';
import { HP_PX, ROW_1U_PX, ROW_PX, caseSize, pointToSlot, rowAtY, rowInsertIndex, rowTypeOf } from './lib/geometry';
import { nearestFreeCol, planSwap, type Swap } from './lib/placement';
import { SIDEWAYS_COLS, allowedRotations, footprintCols, isSideways, nextRotation } from './lib/rotation';
import {
  activeCanvas,
  allPlaced,
  duplicateCase,
  historyReducer,
  isOutOfBounds,
  loadState,
  reducer,
  saveState,
  type Action,
} from './lib/store';
import type { AppState, CaseItem, ModuleItem, PlacedModule, Rotation, RowType } from './lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/ConfirmDialog';

type DropTarget =
  | { kind: 'case'; caseId: string; row: number; col: number; rotation: Rotation; valid: boolean; swaps?: Swap[] }
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

interface PendingDrag {
  module: ModuleItem;
  startX: number;
  startY: number;
  grabFx: number;
  grabFy: number;
}

/** Over its own case a dragged row is reordered (insertion point); over another case it swaps with the row under it. */
type RowSpot = { kind: 'insert'; caseId: string; index: number } | { kind: 'swap'; caseId: string; row: number };

interface RowDrag {
  caseId: string;
  row: number;
  /** The drop under the cursor, or null when it isn't over a case of the same width. */
  target: (RowSpot & { valid: boolean }) | null;
}

const rowAction = (from: { caseId: string; row: number }, t: RowSpot): Action =>
  t.kind === 'insert'
    ? { type: 'reorderRow', caseId: from.caseId, fromRow: from.row, toIndex: t.index }
    : { type: 'swapRows', aCaseId: from.caseId, aRow: from.row, bCaseId: t.caseId, bRow: t.row };

const DRAG_THRESHOLD = 4;

const isTyping = (e: KeyboardEvent) =>
  e.target instanceof HTMLElement && (e.target.closest('input, textarea, select') || e.target.isContentEditable);

const inside = (r: DOMRect, x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

/** A record by id, from the active canvas's placed copies or the global pool. */
const recordOf = (s: AppState, id: string): ModuleItem | undefined =>
  activeCanvas(s).placed.find((m) => m.id === id) ?? s.modules.find((m) => m.id === id);

export default function App() {
  const [history, dispatchHistory] = useReducer(historyReducer, undefined, () => ({
    past: [],
    present: loadState(),
    future: [],
  }));
  const state = history.present;
  const active = activeCanvas(state);
  const dispatch = dispatchHistory as React.Dispatch<Action>;

  const [view, setView] = useState<View>({ x: 40, y: 40, zoom: 0.6 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [rowDrag, setRowDrag] = useState<RowDrag | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingCaseId, setEditingCaseId] = useState<string | null>(null);
  const [deletingCaseId, setDeletingCaseId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const pending = useRef<PendingDrag | null>(null);

  // Window listeners read the latest values through this ref instead of re-binding every render.
  const latest = useRef({ state, view, drag, rowDrag });
  latest.current = { state, view, drag, rowDrag };

  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  // Autosave, warning once if storage is full rather than losing work silently.
  const saved = useRef(true);
  useEffect(() => {
    const ok = saveState(state);
    if (!ok && saved.current) toast.error("Couldn't autosave — storage is full. Export your work to keep it.");
    saved.current = ok;
  }, [state]);

  const fitToContent = useCallback((cases: CaseItem[]) => {
    const el = canvasRef.current;
    if (!el || cases.length === 0) return;
    const rect = el.getBoundingClientRect();
    const minX = Math.min(...cases.map((c) => c.x));
    const minY = Math.min(...cases.map((c) => c.y));
    const maxX = Math.max(...cases.map((c) => c.x + caseSize(c).w));
    const maxY = Math.max(...cases.map((c) => c.y + caseSize(c).h));
    const pad = 60;
    const zoom = clampZoom(Math.min((rect.width - pad * 2) / (maxX - minX), (rect.height - pad * 2) / (maxY - minY), 1));
    setView({
      zoom,
      x: (rect.width - (maxX - minX) * zoom) / 2 - minX * zoom,
      y: (rect.height - (maxY - minY) * zoom) / 2 - minY * zoom,
    });
  }, []);

  // Frame the active canvas on load and on every switch, and drop anything selected or half-dragged on the canvas you
  // just left: the window pointer handlers read `latest.current.drag`, which would still hold one of its modules.
  // Declared before the auto-fit effect below, which compares the canvas id so a switch doesn't also fit there.
  useEffect(() => {
    setSelectedId(null);
    setEditingCaseId(null);
    setDeletingCaseId(null);
    setDrag(null);
    setRowDrag(null);
    pending.current = null;
    fitToContent(activeCanvas(latest.current.state).cases);
  }, [state.activeId, fitToContent]);

  // Bring newly added cases into view, but only when the canvas itself didn't change.
  const seen = useRef({ id: state.activeId, count: active.cases.length });
  useEffect(() => {
    if (seen.current.id === state.activeId && active.cases.length > seen.current.count) fitToContent(active.cases);
    seen.current = { id: state.activeId, count: active.cases.length };
  }, [state.activeId, active.cases, fitToContent]);

  // --- module drag & drop ---------------------------------------------------

  const findTarget = (
    clientX: number,
    clientY: number,
    module: ModuleItem,
    grabFx: number,
    rotation: Rotation,
  ): DropTarget => {
    const { state, view } = latest.current;
    const canvas = activeCanvas(state);
    const trayRect = trayRef.current?.getBoundingClientRect();
    if (trayRect && inside(trayRect, clientX, clientY)) return { kind: 'tray' };

    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect || !inside(canvasRect, clientX, clientY)) return null;
    const wx = (clientX - canvasRect.left - view.x) / view.zoom;
    const wy = (clientY - canvasRect.top - view.y) / view.zoom;

    // Later cases render on top, so test them first.
    for (const c of [...canvas.cases].reverse()) {
      const slot = pointToSlot(c, wx, wy, module, rotation, grabFx);
      if (!slot) continue;
      const suits = allowedRotations(module, rowTypeOf(c, slot.row)).includes(slot.rotation);
      // Dropping a placed module onto another bumps that one into the space just vacated, when it fits there.
      const swap = suits
        ? planSwap(
            canvas.placed,
            canvas.cases,
            module,
            { caseId: c.id, row: slot.row, col: slot.col, rotation: slot.rotation },
            isSideways(slot.rotation) ? SIDEWAYS_COLS : undefined,
          )
        : null;
      if (swap) {
        return { kind: 'case', caseId: c.id, row: slot.row, col: swap.col, rotation: slot.rotation, valid: true, swaps: swap.swaps };
      }
      const col = suits
        ? nearestFreeCol(
            canvas.placed,
            c,
            slot.row,
            slot.col,
            footprintCols(module, slot.rotation),
            module.id,
            // A sideways module is 26 columns wide, so let it hop over a neighbour instead of showing red.
            isSideways(slot.rotation) ? SIDEWAYS_COLS : undefined,
          )
        : null;
      return { kind: 'case', caseId: c.id, row: slot.row, col: col ?? slot.col, rotation: slot.rotation, valid: col !== null };
    }
    return null;
  };

  /** The case under the cursor, as a row-drop target; null unless it has the dragged row's width. */
  const findRowTarget = (clientX: number, clientY: number, from: { caseId: string; row: number }): RowDrag['target'] => {
    const { state, view } = latest.current;
    const canvas = activeCanvas(state);
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    const source = canvas.cases.find((c) => c.id === from.caseId);
    if (!canvasRect || !source || !inside(canvasRect, clientX, clientY)) return null;
    const wx = (clientX - canvasRect.left - view.x) / view.zoom;
    const wy = (clientY - canvasRect.top - view.y) / view.zoom;
    // Later cases render on top; the first one under the cursor is the only candidate.
    const c = [...canvas.cases].reverse().find((x) => {
      const { w, h } = caseSize(x);
      return wx >= x.x && wx <= x.x + w && wy >= x.y && wy <= x.y + h;
    });
    if (!c || c.hp !== source.hp) return null;
    const spot: RowSpot =
      c.id === source.id
        ? { kind: 'insert', caseId: c.id, index: rowInsertIndex(c, wy) }
        : { kind: 'swap', caseId: c.id, row: rowAtY(c, wy) };
    return { ...spot, valid: reducer(state, rowAction(from, spot)) !== state };
  };

  const onRowGripPointerDown = (e: React.PointerEvent<HTMLDivElement>, caseId: string, row: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setRowDrag({ caseId, row, target: findRowTarget(e.clientX, e.clientY, { caseId, row }) });
  };

  const onModulePointerDown = (e: React.PointerEvent<HTMLDivElement>, module: ModuleItem) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (module.locked) {
      setSelectedId(module.id);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    pending.current = {
      module,
      startX: e.clientX,
      startY: e.clientY,
      grabFx: (e.clientX - rect.left) / rect.width,
      grabFy: (e.clientY - rect.top) / rect.height,
    };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const rd = latest.current.rowDrag;
      if (rd) {
        setRowDrag({ ...rd, target: findRowTarget(e.clientX, e.clientY, rd) });
        return;
      }
      const p = pending.current;
      const current = latest.current.drag;
      if (!p && !current) return;
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
    };

    const onUp = () => {
      const rd = latest.current.rowDrag;
      if (rd) {
        setRowDrag(null);
        const t = rd.target;
        if (t?.valid) dispatch(rowAction(rd, t));
        return;
      }
      const p = pending.current;
      if (p) {
        // A click without movement just selects.
        pending.current = null;
        setSelectedId(p.module.id);
        return;
      }
      const d = latest.current.drag;
      if (!d) return;
      setDrag(null);
      const t = d.target;
      // Dropping a placed copy on the tray takes it out of its case; the inventory keeps the module.
      if (t?.kind === 'tray' && d.module.placement) {
        dispatch({ type: 'placeModule', id: d.module.id, placement: null });
      } else if (t?.kind === 'case' && t.valid) {
        const placement = { caseId: t.caseId, row: t.row, col: t.col, ...(t.rotation ? { rotation: t.rotation } : {}) };
        dispatch(
          t.swaps
            ? { type: 'placeModules', placements: [{ id: d.module.id, placement }, ...t.swaps] }
            : { type: 'placeModule', id: d.module.id, placement },
        );
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatchHistory({ type: e.shiftKey ? 'redo' : 'undo' });
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        dispatchHistory({ type: 'redo' });
      } else if (!mod && e.key.toLowerCase() === 'l' && selectedRef.current) {
        const m = recordOf(latest.current.state, selectedRef.current);
        if (m?.placement) dispatch({ type: 'setLocked', id: m.id, locked: !m.locked });
      } else if (!mod && e.key.toLowerCase() === 'r') {
        const { state, drag } = latest.current;
        if (drag) {
          // Mid-drag: turn the module as it would sit in the row under the cursor.
          const t = drag.target?.kind === 'case' ? drag.target : null;
          const c = t && activeCanvas(state).cases.find((x) => x.id === t.caseId);
          const rowType: RowType | null = c && t ? rowTypeOf(c, t.row) : null;
          const rotation = nextRotation(drag.module, rowType, t ? t.rotation : drag.rotation);
          setDrag({ ...drag, rotation, target: findTarget(drag.clientX, drag.clientY, drag.module, drag.grabFx, rotation) });
        } else if (selectedRef.current) {
          dispatch({ type: 'rotateModule', id: selectedRef.current });
        }
      } else if (e.key === 'Escape') {
        pending.current = null;
        setDrag(null);
        setRowDrag(null);
        setSelectedId(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRef.current) {
        e.preventDefault();
        const m = recordOf(latest.current.state, selectedRef.current);
        if (!m || m.locked) return;
        // On a placed copy it takes the copy out of its case; on an inventory entry it removes the module (after a check).
        if (m.placement) dispatch({ type: 'placeModule', id: m.id, placement: null });
        else requestRemove(m.id);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
    };
    // findTarget and dispatch only read refs/stable values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Removing a module from the pool takes it out of every canvas, so ask first when it is placed somewhere.
  const requestRemove = (id: string) => {
    const { state } = latest.current;
    const m = state.modules.find((x) => x.id === id);
    if (!m) return;
    // The locked copy may be on a canvas you can't see, so name it.
    const lockedIn = state.canvases.find((c) => c.placed.some((x) => x.moduleId === m.moduleId && x.locked));
    if (lockedIn) {
      toast.error(`“${m.name}” has a locked copy in “${lockedIn.name}”. Unlock it first.`);
    } else if (!allPlaced(state).some((x) => x.moduleId === m.moduleId)) {
      dispatch({ type: 'removeModule', id });
    } else {
      setRemovingId(id);
    }
  };

  const onDuplicateCase = (id: string) => {
    const { copied } = duplicateCase(activeCanvas(latest.current.state), id);
    dispatch({ type: 'duplicateCase', id });
    toast.success(`Copied the case with ${copied} module${copied === 1 ? '' : 's'}.`);
  };

  // Forking lands you on the fork; primary stays where it was.
  const onForkCanvas = (id: string) => {
    const source = latest.current.state.canvases.find((c) => c.id === id);
    if (!source) return;
    dispatch({ type: 'forkCanvas', id });
    const cases = source.cases.length;
    const modules = source.placed.length;
    toast.success(
      `Forked “${source.name}” — ${cases} case${cases === 1 ? '' : 's'}, ${modules} module${modules === 1 ? '' : 's'}.`,
    );
  };

  // --- render ---------------------------------------------------------------

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

  // While a swap is previewed the bumped module sits in the vacated space; moving off reverts it by itself.
  const swaps = drag?.target?.kind === 'case' ? drag.target.swaps : undefined;
  const shownPlaced: PlacedModule[] = swaps
    ? active.placed.map((m) => {
        const s = swaps.find((x) => x.id === m.id);
        return s ? { ...m, placement: s.placement } : m;
      })
    : active.placed;

  const ghostSnapped = drag?.target?.kind === 'case' && drag.target.valid;
  const ghostRotation = drag?.target?.kind === 'case' ? drag.target.rotation : (drag?.rotation ?? 0);
  // The free-floating ghost is the panel itself, turned: a sideways 3U panel is ROW_PX wide and hp*HP_PX tall.
  const ghostLong = (drag?.module.is1u ? ROW_1U_PX : ROW_PX) * view.zoom;
  const ghostShort = (drag?.module.hp ?? 0) * HP_PX * view.zoom;
  const ghostW = isSideways(ghostRotation) ? ghostLong : ghostShort;
  const ghostH = isSideways(ghostRotation) ? ghostShort : ghostLong;

  const editingCase = active.cases.find((c) => c.id === editingCaseId) ?? null;
  const deletingCase = active.cases.find((c) => c.id === deletingCaseId) ?? null;
  const removing = state.modules.find((m) => m.id === removingId) ?? null;
  // Scoped like the tray badge, but removal reaches every canvas, so the copy has to say both.
  const removingHere = removing ? active.placed.filter((m) => m.moduleId === removing.moduleId) : [];
  const removingElsewhere = removing
    ? allPlaced(state).filter((m) => m.moduleId === removing.moduleId).length - removingHere.length
    : 0;
  const removingOtherCanvases = removing
    ? state.canvases.filter((c) => c.id !== active.id && c.placed.some((m) => m.moduleId === removing.moduleId)).length
    : 0;

  return (
    <div className={`flex h-full ${drag || rowDrag ? 'cursor-grabbing select-none' : ''}`}>
      <Sidebar
        state={state}
        dispatch={dispatch}
        trayRef={trayRef}
        trayIsTarget={drag?.target?.kind === 'tray'}
        selectedId={selectedId}
        onModulePointerDown={onModulePointerDown}
        onRemoveModule={requestRemove}
        onForkCanvas={onForkCanvas}
      />

      <main className="relative flex-1">
        <Canvas view={view} setView={setView} canvasRef={canvasRef} onBackgroundClick={() => setSelectedId(null)}>
          {active.cases.map((c) => (
            <CaseView
              key={c.id}
              c={c}
              modules={shownPlaced.filter((m) => m.placement.caseId === c.id)}
              zoom={view.zoom}
              preview={previewFor(c.id)}
              draggingId={drag?.module.id ?? null}
              draggingRow={rowDrag?.caseId === c.id ? rowDrag.row : null}
              rowInsert={rowDrag?.target?.kind === 'insert' && rowDrag.target.caseId === c.id ? rowDrag.target : null}
              rowSwap={rowDrag?.target?.kind === 'swap' && rowDrag.target.caseId === c.id ? rowDrag.target : null}
              selectedId={selectedId}
              onModulePointerDown={onModulePointerDown}
              onRowGripPointerDown={onRowGripPointerDown}
              onMove={(id, x, y) => dispatch({ type: 'updateCase', id, patch: { x, y } })}
              onEdit={setEditingCaseId}
              onDuplicate={onDuplicateCase}
              onDelete={setDeletingCaseId}
            />
          ))}
        </Canvas>

        {active.cases.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="max-w-sm text-center text-sm text-neutral-500">
              Import a rack from ModularGrid or add an empty case to get started. Drag case headers to arrange them,
              and drag modules from the tray into cases, as many times as you like.
            </div>
          </div>
        )}

        <Toolbar
          zoom={view.zoom}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          onUndo={() => dispatchHistory({ type: 'undo' })}
          onRedo={() => dispatchHistory({ type: 'redo' })}
          onZoom={(factor) => {
            const r = canvasRef.current?.getBoundingClientRect();
            if (r) setView((v) => zoomAt(v, r.width / 2, r.height / 2, factor));
          }}
          onFit={() => fitToContent(active.cases)}
        />
      </main>

      {drag && !ghostSnapped && (
        <div
          className="pointer-events-none fixed z-50 opacity-70 shadow-2xl"
          style={{ left: drag.clientX - drag.grabFx * ghostW, top: drag.clientY - drag.grabFy * ghostH }}
        >
          <ModulePanel module={drag.module} width={ghostW} height={ghostH} rotation={ghostRotation} scale={view.zoom} />
        </div>
      )}

      {editingCase && (
        <EditCaseDialog
          c={editingCase}
          modules={active.placed}
          onClose={() => setEditingCaseId(null)}
          onSave={(patch) => {
            dispatch({ type: 'updateCase', id: editingCase.id, patch });
            setEditingCaseId(null);
          }}
        />
      )}

      <ConfirmDialog
        open={deletingCase !== null}
        onOpenChange={(open) => !open && setDeletingCaseId(null)}
        title={`Delete “${deletingCase?.name ?? ''}”?`}
        description="Its modules are taken out of the case. They stay in your inventory. You can undo."
        confirmLabel="Delete"
        onConfirm={() => deletingCase && dispatch({ type: 'deleteCase', id: deletingCase.id })}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemovingId(null)}
        title={`Remove “${removing?.name ?? ''}”?`}
        description={
          // Reads naturally in all three cases: only here, here and elsewhere, or only on canvases you aren't viewing.
          (removingHere.length === 0
            ? `It is placed ${removingElsewhere} time${removingElsewhere === 1 ? '' : 's'} on ${removingOtherCanvases} other canvas${removingOtherCanvases === 1 ? '' : 'es'}, and not in “${active.name}”`
            : `It is placed ${removingHere.length} time${removingHere.length === 1 ? '' : 's'} in “${active.name}”` +
              (removingElsewhere > 0
                ? `, and ${removingElsewhere} more time${removingElsewhere === 1 ? '' : 's'} on ${removingOtherCanvases} other canvas${removingOtherCanvases === 1 ? '' : 'es'}`
                : '')) +
          `. Removing it from your inventory takes it out of every canvas. You can undo.`
        }
        confirmLabel="Remove"
        onConfirm={() => removing && dispatch({ type: 'removeModule', id: removing.id })}
      />
      <Toaster />
    </div>
  );
}

function Tip({ label, keys, children }: { label: string; keys?: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        {label}
        {keys && <Kbd className="ml-2">{keys}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

function Toolbar(props: {
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onZoom: (factor: number) => void;
  onFit: () => void;
}) {
  return (
    <div className="absolute top-3 right-3 flex items-center gap-1 rounded-xl border border-border/60 bg-card/80 p-1 shadow-xl shadow-black/30 backdrop-blur-md">
      <Tip label="Undo" keys="⌘Z">
        <Button variant="ghost" size="sm" onClick={props.onUndo} disabled={!props.canUndo}>
          Undo
        </Button>
      </Tip>
      <Tip label="Redo" keys="⇧⌘Z">
        <Button variant="ghost" size="sm" onClick={props.onRedo} disabled={!props.canRedo}>
          Redo
        </Button>
      </Tip>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Tip label="Zoom out">
        <Button variant="ghost" size="sm" onClick={() => props.onZoom(1 / 1.2)}>
          −
        </Button>
      </Tip>
      <span className="w-12 text-center text-xs text-muted-foreground tabular-nums">{Math.round(props.zoom * 100)}%</span>
      <Tip label="Zoom in">
        <Button variant="ghost" size="sm" onClick={() => props.onZoom(1.2)}>
          +
        </Button>
      </Tip>
      <Tip label="Fit all cases">
        <Button variant="ghost" size="sm" onClick={props.onFit}>
          Fit
        </Button>
      </Tip>
    </div>
  );
}

function EditCaseDialog({
  c,
  modules,
  onClose,
  onSave,
}: {
  c: CaseItem;
  modules: PlacedModule[];
  onClose: () => void;
  onSave: (patch: Partial<CaseItem>) => void;
}) {
  const [name, setName] = useState(c.name);
  const [rows, setRows] = useState(c.rows);
  const [hp, setHp] = useState(c.hp);
  const [rowTypes, setRowTypes] = useState<RowType[]>(() => Array.from({ length: c.rows }, (_, i) => rowTypeOf(c, i + 1)));
  const types = Array.from({ length: rows }, (_, i) => rowTypes[i] ?? '3U');
  const outOfBounds = modules.filter((m) => isOutOfBounds(m, { id: c.id, rows, hp, rowTypes: types }));
  const evicted = outOfBounds.length;
  const lockedEvicted = outOfBounds.filter((m) => m.locked).length;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-80 sm:max-w-80">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ name: name.trim() || c.name, rows, hp, rowTypes: types });
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit case</DialogTitle>
          </DialogHeader>
          <label className="block text-xs text-muted-foreground">
            Name
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <div className="flex gap-2">
            <label className="flex-1 text-xs text-muted-foreground">
              Rows
              <Input
                type="number"
                min={1}
                max={12}
                value={rows}
                onChange={(e) => setRows(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>
            <label className="flex-1 text-xs text-muted-foreground">
              Width (HP)
              <Input
                type="number"
                min={4}
                max={300}
                value={hp}
                onChange={(e) => setHp(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>
          </div>
          <div className="text-xs text-muted-foreground">
            Row heights
            <div className="mt-1 flex flex-wrap gap-1">
              {types.map((t, i) => (
                <Button
                  key={i}
                  type="button"
                  size="xs"
                  variant={t === '1U' ? 'default' : 'secondary'}
                  title="Toggle 3U / 1U"
                  onClick={() => setRowTypes(types.map((x, j) => (j === i ? (x === '1U' ? '3U' : '1U') : x)))}
                >
                  {i + 1}: {t}
                </Button>
              ))}
            </div>
          </div>
          {lockedEvicted > 0 ? (
            <p className="text-xs text-destructive">
              {lockedEvicted} locked module(s) wouldn't fit. Unlock them or pick a larger size.
            </p>
          ) : (
            evicted > 0 && <p className="text-xs text-amber-400">{evicted} module(s) won't fit and will be taken out of the case.</p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={lockedEvicted > 0}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
