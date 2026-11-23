import { useRef, useState } from 'react';
import { ViewportPortal, useReactFlow, useViewport } from '@xyflow/react';
import type { DiagramBackground as DiagramBackgroundModel } from '../model/types';
import './diagram-background.css';

interface Props {
  bg: DiagramBackgroundModel;
  /** Run lock. Separate from the background's own lock. */
  editLocked: boolean;
  picking: boolean;
  onMove: (x: number, y: number) => void;
  onPoint: (px: number, py: number) => void;
}

/** Stage-2 picture. It lives in the viewport, not as a node, so fit, minimap, and overlap ignore it. */
export function DiagramBackground({ bg, editLocked, picking, onMove, onPoint }: Props) {
  const { screenToFlowPosition } = useReactFlow();
  const { zoom } = useViewport();
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const pass = bg.locked || editLocked;
  const w = bg.width * bg.scale;
  const h = bg.height * bg.scale;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || pass) return;
    e.stopPropagation();
    e.preventDefault();
    if (picking) {
      const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const px = (flow.x - bg.x) / bg.scale;
      const py = (flow.y - bg.y) / bg.scale;
      if (px < 0 || py < 0 || px > bg.width || py > bg.height) return;
      onPoint(px, py);
      return;
    }
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: bg.x, oy: bg.y };
    setDrag({ dx: 0, dy: 0 });
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* jsdom */ }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const z = zoom || 1;
    setDrag({ dx: (e.clientX - d.sx) / z, dy: (e.clientY - d.sy) / z });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setDrag(null);
    const z = zoom || 1;
    const x = Math.round(d.ox + (e.clientX - d.sx) / z);
    const y = Math.round(d.oy + (e.clientY - d.sy) / z);
    if (x !== d.ox || y !== d.oy) onMove(x, y);
  };

  return (
    <ViewportPortal>
      <div
        className="diagram-bg"
        data-diagram-bg=""
        data-bg-locked={pass ? '1' : '0'}
        style={{
          left: bg.x + (drag?.dx ?? 0),
          top: bg.y + (drag?.dy ?? 0),
          width: w,
          height: h,
          opacity: bg.opacity / 100,
          pointerEvents: pass ? 'none' : 'auto',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <img src={bg.dataUrl} alt="" draggable={false} width={w} height={h} />
      </div>
    </ViewportPortal>
  );
}
