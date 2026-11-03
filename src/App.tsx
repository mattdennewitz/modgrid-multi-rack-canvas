import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Canvas, clampZoom, zoomAt, type View } from './components/Canvas';
import { CaseView, type DropPreview } from './components/CaseView';
import { ChatPanel } from './components/ChatPanel';
import { ModulePanel } from './components/ModulePanel';
import { Sidebar } from './components/Sidebar';
import { HP_PX, ROW_1U_PX, ROW_PX, caseSize, pointToSlot, rowAtY, rowInsertIndex, rowTypeOf } from './lib/geometry';
import { nearestFreeCol } from './lib/placement';
import { SIDEWAYS_COLS, allowedRotations, footprintCols, isSideways, nextRotation } from './lib/rotation';
import { historyReducer, isOutOfBounds, loadState, reducer, saveState, type Action } from './lib/store';
import type { AppState, CaseItem, ModuleItem, Rotation, RowType } from './lib/types';

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
const CHAT_OPEN_KEY = 'rack-canvas:chat-open';

const isTyping = (e: KeyboardEvent) =>
  e.target instanceof HTMLElement && (e.target.closest('input, textarea, select') || e.target.isContentEditable);

const inside = (r: DOMRect, x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

export default function App() {
  const [history, dispatchHistory] = useReducer(historyReducer, undefined, () => ({
    past: [],
    present: loadState(),
    future: [],
  }));
  const state = history.present;
  const dispatch = dispatchHistory as React.Dispatch<Action>;

  const [view, setView] = useState<View>({ x: 40, y: 40, zoom: 0.6 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [rowDrag, setRowDrag] = useState<RowDrag | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingCaseId, setEditingCaseId] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(() => {
    try {
      return localStorage.getItem(CHAT_OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_OPEN_KEY, chatOpen ? '1' : '0');
    } catch {
      // ignore
    }
  }, [chatOpen]);

  const canvasRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const pending = useRef<PendingDrag | null>(null);

  // Window listeners read the latest values through this ref instead of re-binding every render.
  const latest = useRef({ state, view, drag, rowDrag });
  latest.current = { state, view, drag, rowDrag };

  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  useEffect(() => saveState(state), [state]);

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

  // Frame saved cases on load, and bring newly added cases into view.
  useEffect(() => fitToContent(latest.current.state.cases), [fitToContent]);
  const caseCount = useRef(state.cases.length);
  useEffect(() => {
    if (state.cases.length > caseCount.current) fitToContent(state.cases);
    caseCount.current = state.cases.length;
  }, [state.cases, fitToContent]);

  // --- module drag & drop ---------------------------------------------------

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
        ? nearestFreeCol(
            state.modules,
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
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    const source = state.cases.find((c) => c.id === from.caseId);
    if (!canvasRect || !source || !inside(canvasRect, clientX, clientY)) return null;
    const wx = (clientX - canvasRect.left - view.x) / view.zoom;
    const wy = (clientY - canvasRect.top - view.y) / view.zoom;
    // Later cases render on top; the first one under the cursor is the only candidate.
    const c = [...state.cases].reverse().find((x) => {
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
      if (t?.kind === 'tray' && d.module.placement) {
        dispatch({ type: 'placeModule', id: d.module.id, placement: null });
      } else if (t?.kind === 'case' && t.valid) {
        const placement = { caseId: t.caseId, row: t.row, col: t.col, ...(t.rotation ? { rotation: t.rotation } : {}) };
        dispatch({ type: 'placeModule', id: d.module.id, placement });
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
        const m = latest.current.state.modules.find((x) => x.id === selectedRef.current);
        if (m?.placement) dispatch({ type: 'setLocked', id: m.id, locked: !m.locked });
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
      } else if (e.key === 'Escape') {
        pending.current = null;
        setDrag(null);
        setRowDrag(null);
        setSelectedId(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRef.current) {
        e.preventDefault();
        const m = latest.current.state.modules.find((x) => x.id === selectedRef.current);
        if (!m || m.locked) return;
        // First press sends a placed module to the tray; pressing again on a tray module removes it.
        dispatch(m.placement ? { type: 'placeModule', id: m.id, placement: null } : { type: 'removeModule', id: m.id });
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

  const ghostSnapped = drag?.target?.kind === 'case' && drag.target.valid;
  const ghostRotation = drag?.target?.kind === 'case' ? drag.target.rotation : (drag?.rotation ?? 0);
  // The free-floating ghost is the panel itself, turned: a sideways 3U panel is ROW_PX wide and hp*HP_PX tall.
  const ghostLong = (drag?.module.is1u ? ROW_1U_PX : ROW_PX) * view.zoom;
  const ghostShort = (drag?.module.hp ?? 0) * HP_PX * view.zoom;
  const ghostW = isSideways(ghostRotation) ? ghostLong : ghostShort;
  const ghostH = isSideways(ghostRotation) ? ghostShort : ghostLong;

  const editingCase = state.cases.find((c) => c.id === editingCaseId) ?? null;

  return (
    <div className={`flex h-full ${drag || rowDrag ? 'cursor-grabbing select-none' : ''}`}>
      <Sidebar
        state={state}
        dispatch={dispatch}
        trayRef={trayRef}
        trayIsTarget={drag?.target?.kind === 'tray'}
        draggingId={drag?.module.id ?? null}
        selectedId={selectedId}
        onModulePointerDown={onModulePointerDown}
      />

      <main className="relative flex-1">
        <Canvas view={view} setView={setView} canvasRef={canvasRef} onBackgroundClick={() => setSelectedId(null)}>
          {state.cases.map((c) => (
            <CaseView
              key={c.id}
              c={c}
              modules={state.modules.filter((m) => m.placement?.caseId === c.id)}
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
              onDelete={(id) => {
                const c = state.cases.find((x) => x.id === id);
                const locked = state.modules.filter((m) => m.locked && m.placement?.caseId === id).length;
                const note = locked ? ` ${locked} locked module(s) will be unlocked.` : '';
                if (c && confirm(`Delete “${c.name}”? Its modules go back to the tray.${note}`)) {
                  dispatch({ type: 'deleteCase', id });
                }
              }}
            />
          ))}
        </Canvas>

        {state.cases.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="max-w-sm text-center text-sm text-neutral-500">
              Import a rack from ModularGrid or add an empty case to get started. Drag case headers to arrange them,
              and drag modules between cases and the tray.
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
          onFit={() => fitToContent(state.cases)}
          chatOpen={chatOpen}
          onToggleChat={() => setChatOpen((o) => !o)}
        />
      </main>

      {/* Kept mounted while hidden so a reply keeps streaming (and gets saved) after closing. */}
      <div className={chatOpen ? 'contents' : 'hidden'}>
        <ChatPanel state={state} selectedId={selectedId} onClose={() => setChatOpen(false)} />
      </div>

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
          modules={state.modules}
          onClose={() => setEditingCaseId(null)}
          onSave={(patch) => {
            dispatch({ type: 'updateCase', id: editingCase.id, patch });
            setEditingCaseId(null);
          }}
        />
      )}
    </div>
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
  chatOpen: boolean;
  onToggleChat: () => void;
}) {
  const btn = 'rounded px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-700 disabled:opacity-40';
  return (
    <div className="absolute top-3 right-3 flex items-center gap-1 rounded-lg bg-neutral-800/90 p-1 shadow-lg ring-1 ring-black/40 backdrop-blur">
      <button className={btn} onClick={props.onUndo} disabled={!props.canUndo} title="Undo (⌘Z)">
        Undo
      </button>
      <button className={btn} onClick={props.onRedo} disabled={!props.canRedo} title="Redo (⇧⌘Z)">
        Redo
      </button>
      <span className="mx-1 h-5 w-px bg-neutral-600" />
      <button className={btn} onClick={() => props.onZoom(1 / 1.2)} title="Zoom out">
        −
      </button>
      <span className="w-12 text-center text-xs text-neutral-400 tabular-nums">{Math.round(props.zoom * 100)}%</span>
      <button className={btn} onClick={() => props.onZoom(1.2)} title="Zoom in">
        +
      </button>
      <button className={btn} onClick={props.onFit} title="Fit all cases">
        Fit
      </button>
      <span className="mx-1 h-5 w-px bg-neutral-600" />
      <button
        className={`${btn} ${props.chatOpen ? 'bg-sky-700 hover:bg-sky-600' : ''}`}
        onClick={props.onToggleChat}
        title="Layout advisor chat"
      >
        Chat
      </button>
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
  modules: AppState['modules'];
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
  const input =
    'w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 focus:border-sky-500 focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onPointerDown={onClose}>
      <form
        className="w-80 space-y-3 rounded-lg bg-neutral-800 p-5 shadow-2xl ring-1 ring-black/50"
        onPointerDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ name: name.trim() || c.name, rows, hp, rowTypes: types });
        }}
      >
        <h2 className="text-sm font-semibold text-neutral-100">Edit case</h2>
        <label className="block text-xs text-neutral-400">
          Name
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <div className="flex gap-2">
          <label className="flex-1 text-xs text-neutral-400">
            Rows
            <input
              type="number"
              min={1}
              max={12}
              className={input}
              value={rows}
              onChange={(e) => setRows(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
          <label className="flex-1 text-xs text-neutral-400">
            Width (HP)
            <input
              type="number"
              min={4}
              max={300}
              className={input}
              value={hp}
              onChange={(e) => setHp(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
        </div>
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
        {lockedEvicted > 0 ? (
          <p className="text-xs text-red-400">
            {lockedEvicted} locked module(s) wouldn't fit. Unlock them or pick a larger size.
          </p>
        ) : (
          evicted > 0 && (
            <p className="text-xs text-amber-400">{evicted} module(s) won't fit and will move to the tray.</p>
          )
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded px-3 py-1 text-sm text-neutral-300 hover:bg-neutral-700" onClick={onClose}>
            Cancel
          </button>
          <button
            className="rounded bg-sky-600 px-3 py-1 text-sm text-white hover:bg-sky-500 disabled:opacity-50"
            disabled={lockedEvicted > 0}
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
