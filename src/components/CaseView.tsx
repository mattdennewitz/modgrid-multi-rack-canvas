import { useRef, useState } from 'react';
import { CASE_PAD, HP_PX, ROW_PX, caseSize, colLeft, rowTop, snapToGrid } from '../lib/geometry';
import { sumPower } from '../lib/modulargrid';
import { rowGaps } from '../lib/placement';
import type { CaseItem, ModuleItem } from '../lib/types';
import { ModulePanel } from './ModulePanel';

export interface DropPreview {
  module: ModuleItem;
  row: number;
  col: number;
  valid: boolean;
}

interface Props {
  c: CaseItem;
  modules: ModuleItem[];
  zoom: number;
  preview: DropPreview | null;
  draggingId: string | null;
  selectedId: string | null;
  onModulePointerDown: (e: React.PointerEvent<HTMLDivElement>, m: ModuleItem) => void;
  onMove: (id: string, x: number, y: number) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

function LockBadge() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full bg-amber-500 shadow ring-1 ring-black/50">
      <svg viewBox="0 0 16 16" className="h-3 w-3 fill-neutral-900" aria-label="Locked">
        <path d="M4 7V5a4 4 0 1 1 8 0v2h1v8H3V7h1Zm2 0h4V5a2 2 0 1 0-4 0v2Z" />
      </svg>
    </div>
  );
}

/** Free-HP label centred in an empty stretch of a row; sized to stay readable when zoomed out. */
function GapLabel({ row, gap, zoom }: { row: number; gap: { col: number; hp: number }; zoom: number }) {
  const width = gap.hp * HP_PX;
  const vertical = gap.hp < 4;
  const fontSize = Math.min(12 / zoom, vertical ? width * 0.8 : 28);
  return (
    <div
      className="pointer-events-none absolute flex items-center justify-center"
      style={{ left: CASE_PAD + colLeft(gap.col), top: rowTop(row), width, height: ROW_PX }}
    >
      <span
        className="rounded-sm bg-black/60 font-medium whitespace-nowrap text-neutral-400 tabular-nums"
        style={{
          fontSize,
          padding: `${fontSize * 0.15}px ${fontSize * 0.35}px`,
          writingMode: vertical ? 'vertical-rl' : undefined,
        }}
      >
        {gap.hp}HP
      </span>
    </div>
  );
}

export function CaseView({
  c,
  modules,
  zoom,
  preview,
  draggingId,
  selectedId,
  onModulePointerDown,
  onMove,
  onEdit,
  onDelete,
}: Props) {
  const { w, h } = caseSize(c);
  // Case position is kept locally while dragging and committed once on release,
  // so a drag is one undo step.
  const [offset, setOffset] = useState<{ dx: number; dy: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const usedHp = modules.reduce((n, m) => n + m.hp, 0);
  const power = sumPower(modules);
  const x = offset ? snapToGrid(c.x + offset.dx) : c.x;
  const y = offset ? snapToGrid(c.y + offset.dy) : c.y;

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY };
    setOffset({ dx: 0, dy: 0 });
  };
  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    setOffset({ dx: (e.clientX - start.current.x) / zoom, dy: (e.clientY - start.current.y) / zoom });
  };
  const onHeaderPointerUp = () => {
    if (!start.current) return;
    start.current = null;
    if (x !== c.x || y !== c.y) onMove(c.id, x, y);
    setOffset(null);
  };

  return (
    <div
      data-case-id={c.id}
      className="absolute rounded-md bg-gradient-to-b from-neutral-700 to-neutral-800 shadow-2xl ring-1 ring-black/60"
      style={{ left: x, top: y, width: w, height: h }}
    >
      <div
        className="flex h-9 cursor-grab items-center gap-3 px-3 text-sm active:cursor-grabbing"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
        onDoubleClick={() => onEdit(c.id)}
      >
        <span className="truncate font-semibold text-neutral-100">{c.name}</span>
        <span className="shrink-0 text-xs text-neutral-400">
          {c.rows}×{c.hp}HP · {usedHp}/{c.rows * c.hp}HP used
        </span>
        <span
          className="hidden shrink-0 text-xs text-neutral-400 sm:inline"
          title="Total current draw of modules in this case"
        >
          +12V {power.plus12}mA · −12V {power.minus12}mA · 5V {power.plus5}mA
        </span>
        <span className="ml-auto flex shrink-0 gap-1">
          <button
            className="rounded px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-600"
            onClick={() => onEdit(c.id)}
          >
            Edit
          </button>
          <button
            className="rounded px-2 py-0.5 text-xs text-neutral-300 hover:bg-red-700"
            onClick={() => onDelete(c.id)}
          >
            Delete
          </button>
        </span>
      </div>

      {Array.from({ length: c.rows }, (_, i) => (
        <div
          key={i}
          className="rack-row absolute"
          style={{ left: CASE_PAD, top: rowTop(i + 1), width: c.hp * HP_PX, height: ROW_PX }}
        />
      ))}

      {Array.from({ length: c.rows }, (_, i) =>
        rowGaps(modules, c, i + 1).map((g) => <GapLabel key={`${i}:${g.col}`} row={i + 1} gap={g} zoom={zoom} />),
      )}

      {modules.map((m) => {
        const p = m.placement!;
        return (
          <ModulePanel
            key={m.id}
            module={m}
            width={m.hp * HP_PX}
            height={ROW_PX}
            className={`absolute ${m.locked ? 'cursor-default' : 'cursor-grab'} ${
              m.id === draggingId ? 'opacity-25' : ''
            } ${m.id === selectedId ? 'z-10 outline-2 outline-sky-400' : ''}`}
            style={{ left: CASE_PAD + colLeft(p.col), top: rowTop(p.row) }}
            onPointerDown={(e) => onModulePointerDown(e, m)}
          >
            {m.locked && <LockBadge />}
          </ModulePanel>
        );
      })}

      {preview && (
        <div
          className={`pointer-events-none absolute z-20 outline-2 ${
            preview.valid ? 'outline-emerald-400' : 'bg-red-500/40 outline-red-500'
          }`}
          style={{
            left: CASE_PAD + colLeft(preview.col),
            top: rowTop(preview.row),
            width: preview.module.hp * HP_PX,
            height: ROW_PX,
          }}
        >
          {preview.valid && (
            <ModulePanel module={preview.module} width={preview.module.hp * HP_PX} height={ROW_PX} className="opacity-80" />
          )}
        </div>
      )}
    </div>
  );
}
