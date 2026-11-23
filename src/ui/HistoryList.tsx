// TURN-067. The edit list for one project tab. It does not save history.
import { useEffect, useRef } from 'react';
import { UNDO_BLOCKED, historyRows, type History } from '../model/history';
import { IconLabel } from './Icon';
import './history-list.css';

export function HistoryMenu({ history, locked, open, onOpenChange, onJump, overflowHidden = false }: {
  history: History;
  locked: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJump: (index: number) => void;
  /** TURN-069: the header folds this control into 「더 보기」. The list itself stays usable. */
  overflowHidden?: boolean;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const rows = historyRows(history);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onOpenChange(false);
    };
    const onDown = (e: MouseEvent) => {
      if (anchor.current?.contains(e.target as Node)) return;
      onOpenChange(false);
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, onOpenChange]);

  return (
    <div className="hist-anchor" ref={anchor}>
      <button
        type="button"
        className={overflowHidden ? 'hist-open header-overflow' : 'hist-open'}
        data-overflow="undo-history"
        aria-label="실행 취소 이력"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => onOpenChange(!open)}
      >
        <IconLabel id="undo-history">이력</IconLabel>
      </button>
      {open && (
        <div className="hist-pop" role="dialog" aria-label="실행 취소 이력">
          <div className="hist-head">실행 취소 이력</div>
          {locked && <p className="hist-lock" role="status">{UNDO_BLOCKED}</p>}
          <ul className="hist-list">
            {rows.map((row) => (
              <li key={row.index}>
                <button
                  type="button"
                  className={`hist-row${row.place === 'future' ? ' is-future' : ''}${row.place === 'current' ? ' is-current' : ''}`}
                  aria-current={row.place === 'current' ? 'true' : undefined}
                  disabled={locked}
                  data-history-index={row.index}
                  data-history-label={row.label}
                  data-history-rev={row.revision}
                  data-history-place={row.place}
                  onClick={() => onJump(row.index)}
                >
                  <span className="hist-name">{row.label}</span>
                  <span className="hist-rev">rev {row.revision}</span>
                  {row.place === 'current' && <span className="hist-now">지금</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
