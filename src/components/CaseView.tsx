import { useRef, useState } from 'react';
import { CASE_PAD, HP_PX, caseSize, colLeft, insertionLineY, rowHeight, rowTop, rowTypeOf, snapToGrid } from '../lib/geometry';
import { sumPower } from '../lib/modulargrid';
import { rowGaps } from '../lib/placement';
import { footprintCols } from '../lib/rotation';
import type { CaseItem, ModuleItem, Rotation } from '../lib/types';
import { ModulePanel } from './ModulePanel';

export interface DropPreview {
  module: ModuleItem;
  row: number;
  col: number;
  rotation: Rotation;
  valid: boolean;
}

interface Props {
  c: CaseItem;
  modules: ModuleItem[];
  zoom: number;
  preview: DropPreview | null;
  draggingId: string | null;
  /** The row being dragged in this case, if any; its modules are dimmed. */
  draggingRow: number | null;
  /** Where a dragged row would be inserted in this case, and whether that drop is allowed. */
  rowInsert: { index: number; valid: boolean } | null;
  /** The row of this case a row from another case would swap with, and whether that is allowed. */
  rowSwap: { row: number; valid: boolean } | null;
  selectedId: string | null;
  onModulePointerDown: (e: React.PointerEvent<HTMLDivElement>, m: ModuleItem) => void;
  onRowGripPointerDown: (e: React.PointerEvent<HTMLDivElement>, caseId: string, row: number) => void;
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
function GapLabel({
  top,
  height,
  gap,
  zoom,
}: {
  top: number;
  height: number;
  gap: { col: number; hp: number };
  zoom: number;
}) {
  const width = gap.hp * HP_PX;
  const vertical = gap.hp < 4;
  const fontSize = Math.min(12 / zoom, vertical ? width * 0.8 : 28);
  return (
    <div
      className="pointer-events-none absolute flex items-center justify-center"
      style={{ left: CASE_PAD + colLeft(gap.col), top, width, height }}
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
  draggingRow,
  rowInsert,
  rowSwap,
  selectedId,
  onModulePointerDown,
  onRowGripPointerDown,
  onMove,
  onEdit,
  onDelete,
}: Props) {
  const { w, h } = caseSize(c);
  // Case position is kept locally while dragging and committed once on release,
  // so a drag is one undo step.
  const [offset, setOffset] = useState<{ dx: number; dy: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const usedHp = modules.reduce((n, m) => n + footprintCols(m, m.placement?.rotation), 0);
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
          style={{
            left: CASE_PAD,
            top: rowTop(c, i + 1),
            width: c.hp * HP_PX,
            height: rowHeight(rowTypeOf(c, i + 1)),
          }}
        />
      ))}

      {Array.from({ length: c.rows }, (_, i) => (
        <div
          key={`grip-${i}`}
          title="Drag to move this row"
          className="absolute cursor-grab rounded-sm bg-neutral-600/50 hover:bg-sky-500/70 active:cursor-grabbing"
          style={{ left: 3, top: rowTop(c, i + 1), width: CASE_PAD - 6, height: rowHeight(rowTypeOf(c, i + 1)) }}
          onPointerDown={(e) => onRowGripPointerDown(e, c.id, i + 1)}
        />
      ))}

      {Array.from({ length: c.rows }, (_, i) =>
        rowGaps(modules, c, i + 1).map((g) => (
          <GapLabel
            key={`${i}:${g.col}`}
            top={rowTop(c, i + 1)}
            height={rowHeight(rowTypeOf(c, i + 1))}
            gap={g}
            zoom={zoom}
          />
        )),
      )}

      {modules.map((m) => {
        const p = m.placement!;
        const rotation = p.rotation ?? 0;
        return (
          <ModulePanel
            key={m.id}
            module={m}
            width={footprintCols(m, rotation) * HP_PX}
            height={rowHeight(rowTypeOf(c, p.row))}
            rotation={rotation}
            className={`absolute ${m.locked ? 'cursor-default' : 'cursor-grab'} ${
              m.id === draggingId || p.row === draggingRow ? 'opacity-25' : ''
            } ${m.id === selectedId ? 'z-10 outline-2 outline-sky-400' : ''}`}
            style={{ left: CASE_PAD + colLeft(p.col), top: rowTop(c, p.row) }}
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
            top: rowTop(c, preview.row),
            width: footprintCols(preview.module, preview.rotation) * HP_PX,
            height: rowHeight(rowTypeOf(c, preview.row)),
          }}
        >
          {preview.valid && (
            <ModulePanel
              module={preview.module}
              width={footprintCols(preview.module, preview.rotation) * HP_PX}
              height={rowHeight(rowTypeOf(c, preview.row))}
              rotation={preview.rotation}
              className="opacity-80"
            />
          )}
        </div>
      )}

      {rowSwap && (
        <div
          className={`pointer-events-none absolute z-30 outline-2 ${
            rowSwap.valid ? 'bg-emerald-400/10 outline-emerald-400' : 'bg-red-500/20 outline-red-500'
          }`}
          style={{
            left: CASE_PAD,
            top: rowTop(c, rowSwap.row),
            width: c.hp * HP_PX,
            height: rowHeight(rowTypeOf(c, rowSwap.row)),
          }}
        />
      )}

      {rowInsert && (
        <div
          className={`pointer-events-none absolute z-30 h-1 rounded ${rowInsert.valid ? 'bg-emerald-400' : 'bg-red-500'}`}
          style={{ left: CASE_PAD, top: insertionLineY(c, rowInsert.index) - 2, width: c.hp * HP_PX }}
        />
      )}
    </div>
  );
}
