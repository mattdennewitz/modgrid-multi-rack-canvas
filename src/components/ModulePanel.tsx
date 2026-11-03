import { useState } from 'react';
import { HP_PX, ROW_1U_PX, ROW_PX } from '../lib/geometry';
import { panelImageUrl } from '../lib/modulargrid';
import type { ModuleItem, Rotation } from '../lib/types';

interface Props {
  module: ModuleItem;
  /** Size of the box the panel occupies, i.e. already swapped for sideways panels. */
  width: number;
  height: number;
  rotation?: Rotation;
  /** Pixels per world unit; used to size the unrotated panel inside a rotated box. */
  scale?: number;
  className?: string;
  style?: React.CSSProperties;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  children?: React.ReactNode;
}

/** ModularGrid's panel image, with a labelled blank if it fails to load. */
export function ModulePanel({
  module,
  width,
  height,
  rotation = 0,
  scale = 1,
  className = '',
  style,
  onPointerDown,
  children,
}: Props) {
  const [failed, setFailed] = useState(false);
  const face = failed ? (
    <div className="flex h-full w-full items-center justify-center border border-neutral-500 bg-neutral-700">
      <span className="rotate-90 whitespace-nowrap text-[10px] text-neutral-200">{module.name}</span>
    </div>
  ) : (
    <img
      src={panelImageUrl(module)}
      alt={module.name}
      draggable={false}
      className="pointer-events-none block h-full w-full"
      onError={() => setFailed(true)}
    />
  );
  return (
    <div
      className={`select-none overflow-hidden ${className}`}
      style={{ width, height, ...style }}
      title={`${module.name} — ${module.vendor} (${module.hp}HP)${module.locked ? ' · locked' : ''}`}
      onPointerDown={onPointerDown}
    >
      {rotation === 0 ? (
        face
      ) : (
        <div className="relative h-full w-full">
          {/* The panel keeps its own upright size and is turned about the centre of the box. */}
          <div
            className="absolute top-1/2 left-1/2"
            style={{
              width: module.hp * HP_PX * scale,
              height: (module.is1u ? ROW_1U_PX : ROW_PX) * scale,
              transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
            }}
          >
            {face}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
