import { useState } from 'react';
import { panelImageUrl } from '../lib/modulargrid';
import type { ModuleItem } from '../lib/types';

interface Props {
  module: ModuleItem;
  width: number;
  height: number;
  className?: string;
  style?: React.CSSProperties;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  children?: React.ReactNode;
}

/** ModularGrid's panel image, with a labelled blank if it fails to load. */
export function ModulePanel({ module, width, height, className = '', style, onPointerDown, children }: Props) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={`select-none overflow-hidden ${className}`}
      style={{ width, height, ...style }}
      title={`${module.name} — ${module.vendor} (${module.hp}HP)${module.locked ? ' · locked' : ''}`}
      onPointerDown={onPointerDown}
    >
      {failed ? (
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
      )}
      {children}
    </div>
  );
}
