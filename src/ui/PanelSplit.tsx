import type { PointerEvent as ReactPointerEvent } from 'react';
import { clampPanel, panelLimit, type PanelKey, type WidthTier } from './viewSettings';

const HOST: Record<PanelKey, string> = { explorer: '.app', library: '.libws', canvas: '.ws-canvas', run: '.ws-run' };

function hostWidth(el: HTMLElement, kind: PanelKey): number {
  const host = el.closest(HOST[kind]) as HTMLElement | null;
  return host?.clientWidth ?? 0;
}

/** Vertical splitter. `start` grows the panel when the pointer moves right (explorer). `end` shrinks it (right panels). */
export function PanelSplit({ kind, value, onChange, label, tier }: { kind: PanelKey; value: number; onChange: (n: number) => void; label: string; tier?: WidthTier }) {
  const edge = kind === 'explorer' ? 'start' : 'end';
  const lim = panelLimit(kind, tier);
  const apply = (el: HTMLElement, raw: number) => onChange(clampPanel(kind, raw, hostWidth(el, kind), tier));
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const startX = e.clientX;
    const start = value;
    try { el.setPointerCapture(e.pointerId); } catch { /* jsdom has no capture */ }
    el.dataset.dragging = 'true';
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      apply(el, edge === 'start' ? start + dx : start - dx);
    };
    const up = () => {
      el.dataset.dragging = 'false';
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const delta = (edge === 'start' ? dir : -dir) * 16;
    apply(e.currentTarget, value + delta);
  };
  return (
    <div
      className="vsplit"
      data-split={kind}
      data-edge={edge}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={lim.min}
      aria-valuemax={lim.max}
      aria-valuetext={`${value}픽셀`}
      aria-label={label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={(e) => { e.preventDefault(); apply(e.currentTarget, lim.def); }}
    />
  );
}
