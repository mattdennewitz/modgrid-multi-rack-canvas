import { useEffect, useRef } from 'react';

export interface View {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 3;

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Zooms by `factor` keeping the canvas-relative point (cx, cy) fixed on screen. */
export function zoomAt(v: View, cx: number, cy: number, factor: number): View {
  const zoom = clampZoom(v.zoom * factor);
  const k = zoom / v.zoom;
  return { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
}

interface Props {
  view: View;
  setView: React.Dispatch<React.SetStateAction<View>>;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  onBackgroundClick: () => void;
  children: React.ReactNode;
}

/**
 * Pan with drag on empty space (or middle mouse anywhere), scroll to pan,
 * pinch or ctrl/cmd + scroll to zoom.
 */
export function Canvas({ view, setView, canvasRef, onBackgroundClick, children }: Props) {
  const pan = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    // React's onWheel is passive, so preventDefault (needed to stop browser zoom) requires a native listener.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        setView((v) => zoomAt(v, e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.01)));
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [canvasRef, setView]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const isBackground = e.target === e.currentTarget;
    if (!(e.button === 1 || (e.button === 0 && isBackground))) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pan.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pan.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) p.moved = true;
    pan.current = { x: e.clientX, y: e.clientY, moved: p.moved };
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const onPointerUp = () => {
    if (pan.current && !pan.current.moved) onBackgroundClick();
    pan.current = null;
  };

  return (
    <div
      ref={canvasRef}
      className="canvas-bg relative h-full w-full cursor-default overflow-hidden"
      style={{
        backgroundSize: `${20 * view.zoom}px ${20 * view.zoom}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className="pointer-events-none absolute top-0 left-0 origin-top-left"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      >
        <div className="pointer-events-auto">{children}</div>
      </div>
    </div>
  );
}
