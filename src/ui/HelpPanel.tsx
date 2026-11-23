// TURN-056 help dock. Not a modal: the rest of the screen stays usable.
// TURN-069: below 1440 the dock overlays. Drag the head to either edge, or fold it to the head line.
// The shortcut sheet is TURN-053. This panel only opens it.
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { GLOSSARY, GLOSSARY_ORDER } from './glossary';
import { manualLine, type HelpTopic } from './helpCopy';
import { TOUR_AGAIN } from './tour';
import { dialogOpen } from './WorkspacePanels';
import { IconLabel } from './Icon';
import './help-panel.css';

export function HelpPanel({ topic, layout, side, folded, onSide, onFold, onClose, onTour, onShortcuts }: {
  topic: HelpTopic;
  layout: 'beside' | 'overlay';
  side: 'left' | 'right';
  folded: boolean;
  onSide: (side: 'left' | 'right') => void;
  onFold: () => void;
  onClose: () => void;
  onTour: (opener: HTMLElement) => void;
  onShortcuts: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number } | null>(null);
  useEffect(() => { panelRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (dialogOpen() || document.querySelector('.tour-pop') || document.querySelector('[data-ctx-menu]')) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const overlay = layout === 'overlay';
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!overlay || (e.target as HTMLElement).closest('button')) return;
    drag.current = { x: e.clientX };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    drag.current = null;
    if (!start || !overlay) return;
    if (Math.abs(e.clientX - start.x) < 24) return;
    onSide(e.clientX < window.innerWidth / 2 ? 'left' : 'right');
  };
  return (
    <aside
      ref={panelRef}
      className={`help-panel${overlay && folded ? ' is-folded' : ''}`}
      data-help-panel
      data-help-topic={topic.id}
      data-help-layout={layout}
      data-help-side={side}
      data-help-folded={folded ? '1' : '0'}
      role="region"
      aria-label="도움말"
      tabIndex={-1}
    >
      <div className="help-head" data-help-drag onPointerDown={onDown} onPointerUp={onUp}>
        <h2 id="help-title">{topic.title}</h2>
        <div className="help-head-actions">
          {overlay && (
            <button type="button" className="btn-main secondary" data-help-fold aria-pressed={folded} onClick={onFold}>
              <IconLabel id={folded ? 'unfold' : 'fold'}>{folded ? '펼치기' : '접기'}</IconLabel>
            </button>
          )}
          <button type="button" className="btn-main secondary" data-help-close onClick={onClose}><IconLabel id="close">닫기</IconLabel></button>
        </div>
      </div>
      <section>
        <h3>이 화면에서 하는 일</h3>
        <p>{topic.does}</p>
      </section>
      <section>
        <h3>자주 하는 일</h3>
        <ol>{topic.tasks.map((line) => <li key={line}>{line}</li>)}</ol>
      </section>
      <section>
        <h3>막힐 때</h3>
        <ul>{topic.stuck.map((line) => <li key={line}>{line}</li>)}</ul>
      </section>
      <p className="help-manual" data-help-manual={manualLine(topic.manual)}>{manualLine(topic.manual)}</p>
      <div className="help-actions">
        <button type="button" className="btn-main secondary" data-help-tour onClick={(e) => onTour(e.currentTarget)}>{TOUR_AGAIN}</button>
        <button type="button" className="btn-main secondary" data-help-shortcuts onClick={onShortcuts}>단축키 목록</button>
      </div>
      <details className="help-gloss">
        <summary>용어</summary>
        <dl>
          {GLOSSARY_ORDER.map((id) => (
            <div key={id} data-gloss={id}>
              <dt>{GLOSSARY[id].label}</dt>
              <dd>{GLOSSARY[id].line}</dd>
            </div>
          ))}
        </dl>
      </details>
    </aside>
  );
}
