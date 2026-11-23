// TURN-056 help dock. Not a modal: the rest of the screen stays usable.
// The shortcut sheet is TURN-053. This panel only opens it.
import { useEffect, useRef } from 'react';
import { GLOSSARY, GLOSSARY_ORDER } from './glossary';
import { manualLine, type HelpTopic } from './helpCopy';
import { TOUR_AGAIN } from './tour';
import { dialogOpen } from './WorkspacePanels';
import './help-panel.css';

export function HelpPanel({ topic, onClose, onTour, onShortcuts }: {
  topic: HelpTopic;
  onClose: () => void;
  onTour: (opener: HTMLElement) => void;
  onShortcuts: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => { panelRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (dialogOpen() || document.querySelector('.tour-pop')) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <aside
      ref={panelRef}
      className="help-panel"
      data-help-panel
      data-help-topic={topic.id}
      role="region"
      aria-label="도움말"
      tabIndex={-1}
    >
      <div className="help-head">
        <h2 id="help-title">{topic.title}</h2>
        <button type="button" className="btn-main secondary" data-help-close onClick={onClose}>닫기</button>
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
