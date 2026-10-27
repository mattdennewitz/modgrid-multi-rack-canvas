import { useMemo, useRef, useState } from 'react';
import { HP_PX, ROW_PX } from '../lib/geometry';
import { extractUserId } from '../lib/parseCollection';
import { extractRackId } from '../lib/parseRack';
import { modulePageUrl } from '../lib/modulargrid';
import { isAppState, type Action } from '../lib/store';
import type { AppState, CollectionEntry, CollectionModule, ImportedRack, ModuleItem } from '../lib/types';
import { ModulePanel } from './ModulePanel';

const TRAY_SCALE = 0.5;

const CASE_PRESETS = [
  { rows: 1, hp: 84 },
  { rows: 1, hp: 104 },
  { rows: 2, hp: 84 },
  { rows: 2, hp: 104 },
  { rows: 3, hp: 104 },
  { rows: 3, hp: 126 },
];

const inputClass =
  'w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-sky-500 focus:outline-none';
const buttonClass =
  'rounded bg-neutral-700 px-3 py-1 text-sm text-neutral-100 hover:bg-neutral-600 disabled:opacity-50';
const primaryClass = 'rounded bg-sky-600 px-3 py-1 text-sm text-white hover:bg-sky-500 disabled:opacity-50';

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-neutral-800 p-4">
      <h2 className="mb-2 text-xs font-semibold tracking-wider text-neutral-400 uppercase">{title}</h2>
      {children}
    </section>
  );
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

function ImportRack({ state, dispatch }: { state: AppState; dispatch: React.Dispatch<Action> }) {
  const [url, setUrl] = useState('');
  const [createCase, setCreateCase] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  /** Specs live on each module's page, so only modules not already in the app are fetched (cached server-side). */
  const importCollection = async (userId: string) => {
    const entries = await getJson<CollectionEntry[]>(`/api/collection/${userId}`);
    const have = new Set(state.modules.map((m) => m.slug));
    const todo = entries.filter((e) => !have.has(e.slug));
    const modules: CollectionModule[] = [];
    const failed: string[] = [];
    for (const [i, entry] of todo.entries()) {
      setMessage({ kind: 'ok', text: `Fetching module specs… ${i + 1}/${todo.length}` });
      try {
        modules.push(await getJson<CollectionModule>(`/api/module/${entry.slug}`));
      } catch {
        failed.push(entry.name);
      }
    }
    dispatch({ type: 'importCollection', modules, source: 'Collection' });
    setMessage({
      kind: failed.length ? 'error' : 'ok',
      text:
        `Collection has ${entries.length} modules: ${modules.length} added to the tray, ` +
        `${entries.length - todo.length} already here.` +
        (failed.length ? ` Couldn't read: ${failed.join(', ')}. Import again to retry.` : ''),
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const userId = /users\/view\//.test(url) ? extractUserId(url) : null;
    const id = userId ? null : extractRackId(url);
    if (!userId && !id) {
      setMessage({
        kind: 'error',
        text: 'Paste a rack URL (…/e/racks/view/3246217) or a profile URL (…/s/users/view/254121)',
      });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (userId) {
        await importCollection(userId);
        setUrl('');
        return;
      }
      const rack = await getJson<ImportedRack>(`/api/rack/${id}`);
      dispatch({ type: 'importRack', rack, createCase });
      const oneU = rack.modules.filter((m) => m.is1u).length;
      setMessage({
        kind: 'ok',
        text:
          `Imported ${rack.modules.length} modules from “${rack.name}”.` +
          (oneU ? ` ${oneU} 1U module(s) went to the tray (1U rows aren't supported yet).` : '') +
          (rack.format !== 'e' ? ' Warning: this is not a Eurorack rack.' : ''),
      });
      setUrl('');
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <input
        className={inputClass}
        placeholder="Rack or profile URL on modulargrid.net"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-neutral-300">
          <input type="checkbox" checked={createCase} onChange={(e) => setCreateCase(e.target.checked)} />
          Create a case with this layout <span className="text-neutral-500">(racks only)</span>
        </label>
        <button className={primaryClass} disabled={busy || !url.trim()}>
          {busy ? 'Importing…' : 'Import'}
        </button>
      </div>
      {message && (
        <p className={`text-xs ${message.kind === 'error' ? 'text-red-400' : 'text-emerald-400'}`}>{message.text}</p>
      )}
    </form>
  );
}

function AddCase({ dispatch }: { dispatch: React.Dispatch<Action> }) {
  const [name, setName] = useState('');
  const [rows, setRows] = useState(2);
  const [hp, setHp] = useState(104);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    dispatch({ type: 'addCase', name: name.trim() || `${rows}×${hp}HP case`, rows, hp });
    setName('');
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {CASE_PRESETS.map((p) => (
          <button
            key={`${p.rows}x${p.hp}`}
            type="button"
            className={`rounded px-2 py-0.5 text-xs ${
              p.rows === rows && p.hp === hp ? 'bg-sky-700 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
            onClick={() => {
              setRows(p.rows);
              setHp(p.hp);
            }}
          >
            {p.rows}×{p.hp}
          </button>
        ))}
      </div>
      <input className={inputClass} placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="flex items-end gap-2">
        <label className="flex-1 text-xs text-neutral-400">
          Rows (3U)
          <input
            type="number"
            min={1}
            max={12}
            className={inputClass}
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
            className={inputClass}
            value={hp}
            onChange={(e) => setHp(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <button className={primaryClass}>Add</button>
      </div>
    </form>
  );
}

function SelectedModule({
  module,
  caseName,
  dispatch,
}: {
  module: ModuleItem;
  caseName: string | null;
  dispatch: React.Dispatch<Action>;
}) {
  return (
    <div className="space-y-2 text-sm">
      <div>
        <a
          href={modulePageUrl(module)}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-neutral-100 hover:text-sky-400"
        >
          {module.name}
        </a>
        <div className="text-xs text-neutral-400">
          {module.vendor} · {module.hp}HP{module.is1u && ' · 1U'}
        </div>
        {module.description && <div className="text-xs text-neutral-500">{module.description}</div>}
      </div>
      <div className="text-xs text-neutral-400">
        +12V {module.power.plus12}mA · −12V {module.power.minus12}mA · 5V {module.power.plus5}mA
      </div>
      <div className="text-xs text-neutral-500">
        {module.placement
          ? `In ${caseName ?? 'a case'}, row ${module.placement.row}, HP ${module.placement.col}`
          : 'In the tray'}
        {' · from '}
        {module.source}
      </div>
      {module.locked && <p className="text-xs text-amber-400">Locked in place. Unlock to move or remove it.</p>}
      <div className="flex flex-wrap gap-2">
        {module.placement && (
          <button
            className={module.locked ? 'rounded bg-amber-600 px-3 py-1 text-sm text-neutral-950 hover:bg-amber-500' : buttonClass}
            onClick={() => dispatch({ type: 'setLocked', id: module.id, locked: !module.locked })}
            title="Toggle lock (L)"
          >
            {module.locked ? 'Unlock' : 'Lock'}
          </button>
        )}
        {module.placement && (
          <button
            className={buttonClass}
            disabled={module.locked}
            onClick={() => dispatch({ type: 'placeModule', id: module.id, placement: null })}
          >
            Send to tray
          </button>
        )}
        <button className={buttonClass} onClick={() => dispatch({ type: 'duplicateModule', id: module.id })}>
          Duplicate
        </button>
        <button
          className="rounded bg-red-800 px-3 py-1 text-sm text-white hover:bg-red-700 disabled:opacity-50"
          disabled={module.locked}
          onClick={() => dispatch({ type: 'removeModule', id: module.id })}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function FileActions({ state, dispatch }: { state: AppState; dispatch: React.Dispatch<Action> }) {
  const fileRef = useRef<HTMLInputElement>(null);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rack-canvas.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      if (!isAppState(parsed)) throw new Error('Not a rack canvas file');
      dispatch({ type: 'replace', state: parsed });
    } catch (err) {
      alert(`Couldn't load file: ${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <button className={buttonClass} onClick={exportJson}>
        Export
      </button>
      <button className={buttonClass} onClick={() => fileRef.current?.click()}>
        Load…
      </button>
      <button
        className={buttonClass}
        onClick={() => {
          if (confirm('Clear all cases and modules? (You can undo.)')) {
            dispatch({ type: 'replace', state: { cases: [], modules: [] } });
          }
        }}
      >
        Clear
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importJson(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

interface Props {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  trayRef: React.RefObject<HTMLDivElement | null>;
  trayIsTarget: boolean;
  draggingId: string | null;
  selectedId: string | null;
  onModulePointerDown: (e: React.PointerEvent<HTMLDivElement>, m: ModuleItem) => void;
}

export function Sidebar({ state, dispatch, trayRef, trayIsTarget, draggingId, selectedId, onModulePointerDown }: Props) {
  const [filter, setFilter] = useState('');
  const tray = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return state.modules
      .filter((m) => !m.placement)
      .filter((m) => !q || `${m.name} ${m.vendor} ${m.description}`.toLowerCase().includes(q))
      .sort((a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name));
  }, [state.modules, filter]);
  const trayTotal = state.modules.filter((m) => !m.placement).length;

  const selected = state.modules.find((m) => m.id === selectedId) ?? null;
  const selectedCase = selected?.placement ? state.cases.find((c) => c.id === selected.placement!.caseId) : null;

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900/60">
      <header className="border-b border-neutral-800 px-4 py-3">
        <h1 className="text-base font-semibold text-neutral-100">Rack Canvas</h1>
        <p className="text-xs text-neutral-500">All your cases, one view.</p>
      </header>
      <Section title="Import from ModularGrid">
        <ImportRack state={state} dispatch={dispatch} />
      </Section>
      <Section title="Add a case">
        <AddCase dispatch={dispatch} />
      </Section>
      {selected && (
        <Section title="Selected module">
          <SelectedModule module={selected} caseName={selectedCase?.name ?? null} dispatch={dispatch} />
        </Section>
      )}
      <div
        ref={trayRef}
        className={`flex min-h-40 flex-1 flex-col overflow-hidden border-b border-neutral-800 transition-colors ${
          trayIsTarget ? 'bg-sky-950/60 ring-2 ring-sky-500 ring-inset' : ''
        }`}
      >
        <div className="px-4 pt-4">
          <h2 className="mb-2 text-xs font-semibold tracking-wider text-neutral-400 uppercase">
            Tray <span className="font-normal text-neutral-500">({trayTotal} unplaced)</span>
          </h2>
          {trayTotal > 0 && (
            <input
              className={`${inputClass} mb-3`}
              placeholder="Filter by name or maker"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {trayTotal === 0 ? (
            <p className="text-xs text-neutral-500">
              Drag modules here to take them out of a case. Imported modules that don't fit land here too.
            </p>
          ) : (
            <div className="flex flex-wrap items-start gap-1.5">
              {tray.map((m) => (
                <ModulePanel
                  key={m.id}
                  module={m}
                  width={m.hp * HP_PX * TRAY_SCALE}
                  height={ROW_PX * TRAY_SCALE}
                  className={`cursor-grab rounded-sm ${m.id === draggingId ? 'opacity-25' : ''} ${
                    m.id === selectedId ? 'outline-2 outline-sky-400' : ''
                  }`}
                  onPointerDown={(e) => onModulePointerDown(e, m)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="p-4">
        <FileActions state={state} dispatch={dispatch} />
      </div>
    </aside>
  );
}
