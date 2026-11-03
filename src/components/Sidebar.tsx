import { useMemo, useRef, useState } from 'react';
import { HP_PX, ROW_1U_PX, ROW_PX, rowTypeOf } from '../lib/geometry';
import { extractUserId } from '../lib/parseCollection';
import { extractRackId } from '../lib/parseRack';
import { modulePageUrl } from '../lib/modulargrid';
import { nextRotation } from '../lib/rotation';
import { isAppState, type Action } from '../lib/store';
import type { AppState, CollectionEntry, CollectionModule, ImportedRack, ModuleItem, RowType } from '../lib/types';
import { ModulePanel } from './ModulePanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ConfirmDialog } from './ConfirmDialog';
import { ChevronDown, Download, Link2, Plus, Trash2, Upload, Lock, LockOpen, RotateCw, Copy, Inbox, LayoutGrid, Boxes, Package, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const TRAY_SCALE = 0.5;

type TraySize = 'all' | '1u' | '3u';
const TRAY_SIZES: { value: TraySize; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: '1u', label: '1U' },
  { value: '3u', label: '3U' },
];

const CASE_PRESETS = [
  { rows: 1, hp: 84 },
  { rows: 1, hp: 104 },
  { rows: 2, hp: 84 },
  { rows: 2, hp: 104 },
  { rows: 3, hp: 104 },
  { rows: 3, hp: 126 },
];

function SectionHeading({
  open,
  icon: Icon,
  children,
  aside,
}: {
  open: boolean;
  icon: LucideIcon;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md text-left text-[13px] font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
      <Icon className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
      <h2 className="flex-1">{children}</h2>
      {aside}
      <ChevronDown
        className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`}
      />
    </CollapsibleTrigger>
  );
}

function Section({
  title,
  icon,
  defaultOpen = true,
  children,
}: {
  title: React.ReactNode;
  icon: LucideIcon;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible asChild open={open} onOpenChange={setOpen}>
      <section className="border-b border-border/60 px-4 py-3.5">
        <SectionHeading open={open} icon={icon}>
          {title}
        </SectionHeading>
        <CollapsibleContent className="pt-3">{children}</CollapsibleContent>
      </section>
    </Collapsible>
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
          (oneU
            ? ` ${oneU} 1U module(s) went to the tray: imported cases have 3U rows only. Switch a row to 1U in Edit case, then drag them in.`
            : '') +
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
      <div className="relative">
        <Link2 className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="modulargrid.net rack or profile URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-normal">
          <Checkbox checked={createCase} onCheckedChange={(v) => setCreateCase(v === true)} />
          Create a case with this layout <span className="text-muted-foreground">(racks only)</span>
        </Label>
        <Button className="w-full" disabled={busy || !url.trim()}>
          <Download />
          {busy ? 'Importing…' : 'Import'}
        </Button>
      </div>
      {message && (
        <Alert variant={message.kind === 'error' ? 'destructive' : 'default'} className="px-3 py-2 text-xs">
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
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
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={1.5}
        className="grid w-full grid-cols-3"
        value={CASE_PRESETS.some((p) => p.rows === rows && p.hp === hp) ? `${rows}x${hp}` : ''}
        onValueChange={(v) => {
          const p = CASE_PRESETS.find((x) => `${x.rows}x${x.hp}` === v);
          if (p) {
            setRows(p.rows);
            setHp(p.hp);
          }
        }}
      >
        {CASE_PRESETS.map((p) => (
          <ToggleGroupItem key={`${p.rows}x${p.hp}`} value={`${p.rows}x${p.hp}`} className="text-xs tabular-nums data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
            {p.rows}×{p.hp}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="flex items-end gap-2">
        <Label className="flex-1 flex-col items-stretch gap-1.5 text-xs font-normal text-muted-foreground">
          Rows (3U)
          <Input
            type="number"
            min={1}
            max={12}
            value={rows}
            onChange={(e) => setRows(Math.max(1, Number(e.target.value) || 1))}
          />
        </Label>
        <Label className="flex-1 flex-col items-stretch gap-1.5 text-xs font-normal text-muted-foreground">
          Width (HP)
          <Input
            type="number"
            min={4}
            max={300}
            value={hp}
            onChange={(e) => setHp(Math.max(1, Number(e.target.value) || 1))}
          />
        </Label>
        <Button size="icon" aria-label="Add case" title="Add case">
          <Plus />
        </Button>
      </div>
    </form>
  );
}

function SelectedModule({
  module,
  caseName,
  rowType,
  dispatch,
}: {
  module: ModuleItem;
  caseName: string | null;
  rowType: RowType | null;
  dispatch: React.Dispatch<Action>;
}) {
  const rotation = module.placement?.rotation ?? 0;
  return (
    <div className="space-y-2.5 text-sm">
      <div className="rounded-lg border bg-background/60 p-3">
        <a
          href={modulePageUrl(module)}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-foreground underline-offset-2 hover:text-sky-400 hover:underline"
        >
          {module.name}
        </a>
        <div className="text-xs text-muted-foreground">
          {module.vendor} · {module.hp}HP{module.is1u && ' · 1U'}
        </div>
        {module.description && <div className="text-xs text-muted-foreground">{module.description}</div>}
      </div>
      <div className="text-xs text-muted-foreground">
        +12V {module.power.plus12}mA · −12V {module.power.minus12}mA · 5V {module.power.plus5}mA
      </div>
      <div className="text-xs text-muted-foreground">
        {module.placement
          ? `In ${caseName ?? 'a case'}, row ${module.placement.row}, HP ${module.placement.col}${
              rotation ? ` · rotated ${rotation}°` : ''
            }`
          : 'In the tray'}
        {' · from '}
        {module.source}
      </div>
      {module.locked && <p className="text-xs text-amber-400">Locked in place. Unlock to move or remove it.</p>}
      <div className="flex flex-wrap gap-2">
        {module.placement && (
          <Button
            size="sm"
            variant={module.locked ? 'default' : 'secondary'}
            onClick={() => dispatch({ type: 'setLocked', id: module.id, locked: !module.locked })}
            title="Toggle lock (L)"
          >
            {module.locked ? <LockOpen /> : <Lock />}
            {module.locked ? 'Unlock' : 'Lock'}
          </Button>
        )}
        {module.placement && rowType && (
          <Button size="sm" variant="secondary"
            disabled={module.locked || nextRotation(module, rowType, rotation) === rotation}
            onClick={() => dispatch({ type: 'rotateModule', id: module.id })}
            title="Rotate (R)"
          >
            <RotateCw />
            Rotate
          </Button>
        )}
        {module.placement && (
          <Button size="sm" variant="secondary"
            disabled={module.locked}
            onClick={() => dispatch({ type: 'placeModule', id: module.id, placement: null })}
          >
            Send to tray
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => dispatch({ type: 'duplicateModule', id: module.id })}>
          <Copy />
          Duplicate
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={module.locked}
          onClick={() => dispatch({ type: 'removeModule', id: module.id })}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}

function FileActions({ state, dispatch }: { state: AppState; dispatch: React.Dispatch<Action> }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);

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
      toast.error(`Couldn't load file: ${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onClick={exportJson}>
        <Download />
        Export
      </Button>
      <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
        <Upload />
        Load…
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setConfirmClear(true)}>
        <Trash2 />
        Clear
      </Button>
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear everything?"
        description="This removes all cases and modules. You can undo."
        confirmLabel="Clear"
        onConfirm={() => dispatch({ type: 'replace', state: { cases: [], modules: [] } })}
      />
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
  const [size, setSize] = useState<TraySize>('all');
  const tray = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return state.modules
      .filter((m) => !m.placement)
      .filter((m) => size === 'all' || m.is1u === (size === '1u'))
      .filter((m) => !q || `${m.name} ${m.vendor} ${m.description}`.toLowerCase().includes(q))
      .sort((a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name));
  }, [state.modules, filter, size]);
  const trayTotal = state.modules.filter((m) => !m.placement).length;

  const [trayOpen, setTrayOpen] = useState(true);
  const selected = state.modules.find((m) => m.id === selectedId) ?? null;
  const selectedCase = selected?.placement ? state.cases.find((c) => c.id === selected.placement!.caseId) : null;

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-r bg-card">
      <header className="flex items-center gap-3 border-b border-border/60 px-4 py-4">
        <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-indigo-500 text-white shadow-sm">
          <LayoutGrid className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm leading-tight font-semibold tracking-tight text-foreground">Rack Canvas</h1>
          <p className="text-xs text-muted-foreground">
            {state.cases.length} {state.cases.length === 1 ? 'case' : 'cases'} · {state.modules.length}{' '}
            {state.modules.length === 1 ? 'module' : 'modules'}
          </p>
        </div>
      </header>
      <Section title="Import from ModularGrid" icon={Download}>
        <ImportRack state={state} dispatch={dispatch} />
      </Section>
      <Section title="Add a case" icon={Boxes}>
        <AddCase dispatch={dispatch} />
      </Section>
      {selected && (
        <Section title="Selected module" icon={Package}>
          <SelectedModule
            module={selected}
            caseName={selectedCase?.name ?? null}
            rowType={selected.placement && selectedCase ? rowTypeOf(selectedCase, selected.placement.row) : null}
            dispatch={dispatch}
          />
        </Section>
      )}
      <div
        ref={trayRef}
        className={`flex flex-col overflow-hidden border-b border-border/60 transition-colors ${
          trayOpen ? 'min-h-40 flex-1' : ''
        } ${trayIsTarget ? 'bg-sky-500/10 ring-2 ring-sky-500/70 ring-inset' : ''}`}
      >
        <Collapsible open={trayOpen} onOpenChange={setTrayOpen} className="flex min-h-0 flex-1 flex-col">
        <div className="px-4 pt-3.5">
          <div className="mb-3">
            <SectionHeading
              open={trayOpen}
              icon={Inbox}
              aside={
                <Badge variant="secondary" className="tabular-nums">
                  {trayTotal}
                </Badge>
              }
            >
              Tray
            </SectionHeading>
          </div>
          <CollapsibleContent>
          {trayTotal > 0 && (
            <>
              <Input
                className="mb-2"
                placeholder="Filter by name or maker"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={1.5}
                className="mb-3 w-full"
                aria-label="Filter by module height"
                value={size}
                onValueChange={(v) => v && setSize(v as typeof size)}
              >
                {TRAY_SIZES.map((s) => (
                  <ToggleGroupItem key={s.value} value={s.value} className="flex-1 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                    {s.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </>
          )}
          </CollapsibleContent>
        </div>
        <CollapsibleContent className="flex-1 overflow-y-auto px-4 pb-4">
          {trayTotal === 0 ? (
            <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
              Drag modules here to take them out of a case. Imported modules that don't fit land here too.
            </p>
          ) : (
            <div className="flex flex-wrap items-start gap-1.5">
              {tray.map((m) => (
                <ModulePanel
                  key={m.id}
                  module={m}
                  width={m.hp * HP_PX * TRAY_SCALE}
                  height={(m.is1u ? ROW_1U_PX : ROW_PX) * TRAY_SCALE}
                  className={`cursor-grab rounded-sm ${m.id === draggingId ? 'opacity-25' : ''} ${
                    m.id === selectedId ? 'outline-2 outline-sky-400' : ''
                  }`}
                  onPointerDown={(e) => onModulePointerDown(e, m)}
                />
              ))}
            </div>
          )}
        </CollapsibleContent>
        </Collapsible>
      </div>
      <Section title="File" icon={Upload}>
        <FileActions state={state} dispatch={dispatch} />
      </Section>
    </aside>
  );
}
