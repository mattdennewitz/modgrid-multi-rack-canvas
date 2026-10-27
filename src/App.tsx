import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Canvas, clampZoom, zoomAt, type View } from './components/Canvas';
import { CaseView, type DropPreview } from './components/CaseView';
import { ChatPanel } from './components/ChatPanel';
import { ModulePanel } from './components/ModulePanel';
import { Sidebar } from './components/Sidebar';
import { HP_PX, ROW_PX, caseSize, pointToSlot } from './lib/geometry';
import { nearestFreeCol } from './lib/placement';
import { historyReducer, isOutOfBounds, loadState, saveState, type Action } from './lib/store';
import type { AppState, CaseItem, ModuleItem } from './lib/types';

type DropTarget = { kind: 'case'; caseId: string; row: number; col: number; valid: boolean } | { kind: 'tray' } | null;

interface DragState {
  module: ModuleItem;
  clientX: number;
  clientY: number;
  /** Where the module was grabbed, as a fraction of its width/height. */
  grabFx: number;
  grabFy: number;
  target: DropTarget;
}

interface PendingDrag {
  module: ModuleItem;
  startX: number;
  startY: number;
  grabFx: number;
  grabFy: number;
}

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
  const latest = useRef({ state, view, drag });
  latest.current = { state, view, drag };

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

  const findTarget = (clientX: number, clientY: number, module: ModuleItem, grabFx: number): DropTarget => {
    const { state, view } = latest.current;
    const trayRect = trayRef.current?.getBoundingClientRect();
    if (trayRect && inside(trayRect, clientX, clientY)) return { kind: 'tray' };

    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect || !inside(canvasRect, clientX, clientY)) return null;
    const wx = (clientX - canvasRect.left - view.x) / view.zoom;
    const wy = (clientY - canvasRect.top - view.y) / view.zoom;
    const grabDx = grabFx * module.hp * HP_PX;

    // Later cases render on top, so test them first.
    for (const c of [...state.cases].reverse()) {
      const slot = pointToSlot(c, wx, wy, module.hp, grabDx);
      if (!slot) continue;
      const col = module.is1u ? null : nearestFreeCol(state.modules, c, slot.row, slot.col, module.hp, module.id);
      return { kind: 'case', caseId: c.id, row: slot.row, col: col ?? slot.col, valid: col !== null };
    }
    return null;
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
      const p = pending.current;
      const current = latest.current.drag;
      if (!p && !current) return;
      if (p && !current) {
        if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < DRAG_THRESHOLD) return;
        pending.current = null;
        setSelectedId(p.module.id);
        setDrag({ ...p, clientX: e.clientX, clientY: e.clientY, target: findTarget(e.clientX, e.clientY, p.module, p.grabFx) });
        return;
      }
      if (current) {
        setDrag({
          ...current,
          clientX: e.clientX,
          clientY: e.clientY,
          target: findTarget(e.clientX, e.clientY, current.module, current.grabFx),
        });
      }
    };

    const onUp = () => {
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
        dispatch({ type: 'placeModule', id: d.module.id, placement: { caseId: t.caseId, row: t.row, col: t.col } });
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
      } else if (e.key === 'Escape') {
        pending.current = null;
        setDrag(null);
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
      ? { module: drag.module, row: drag.target.row, col: drag.target.col, valid: drag.target.valid }
      : null;

  const ghostSnapped = drag?.target?.kind === 'case' && drag.target.valid;
  const ghostW = (drag?.module.hp ?? 0) * HP_PX * view.zoom;
  const ghostH = ROW_PX * view.zoom;

  const editingCase = state.cases.find((c) => c.id === editingCaseId) ?? null;

  return (
    <div className={`flex h-full ${drag ? 'cursor-grabbing select-none' : ''}`}>
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
              selectedId={selectedId}
              onModulePointerDown={onModulePointerDown}
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
          <ModulePanel module={drag.module} width={ghostW} height={ghostH} />
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
  const outOfBounds = modules.filter((m) => isOutOfBounds(m, { id: c.id, rows, hp }));
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
          onSave({ name: name.trim() || c.name, rows, hp });
        }}
      >
        <h2 className="text-sm font-semibold text-neutral-100">Edit case</h2>
        <label className="block text-xs text-neutral-400">
          Name
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <div className="flex gap-2">
          <label className="flex-1 text-xs text-neutral-400">
            Rows (3U)
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
