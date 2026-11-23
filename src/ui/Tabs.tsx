import { useRef } from 'react';
import { IconLabel } from './Icon';
import { Terms } from './Term';

/** One tab in the shared underline tab list. TURN-009 reuses this for the layout board and the diagram. */
export interface TabSpec<T extends string> {
  id: T;
  label: string;
  /** Icon id from the meaning table. The label text stays. */
  icon?: string;
  panel: React.ReactNode;
}

/**
 * Underline tabs: tablist, tab, tabpanel.
 * ←/→ move and wrap. Home and End jump to the first and last tab.
 * Only the selected panel is shown (`hidden` on the others). The hidden panels stay mounted.
 */
export function Tabs<T extends string>({ label, tabs, value, onChange, idBase = 'tabs' }: {
  label: string;
  tabs: TabSpec<T>[];
  value: T;
  onChange: (id: T) => void;
  idBase?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    const i = tabs.findIndex((t) => t.id === value);
    if (i < 0 || tabs.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const nextI = e.key === 'Home' ? 0
      : e.key === 'End' ? tabs.length - 1
        : e.key === 'ArrowRight' ? (i + 1) % tabs.length
          : (i - 1 + tabs.length) % tabs.length;
    const next = tabs[nextI];
    onChange(next.id);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-tab-id="${next.id}"]`)?.focus();
  };
  return (
    <div className="ui-tabs-root">
      <div ref={listRef} className="ui-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {tabs.map((t) => {
          const selected = t.id === value;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${idBase}-tab-${t.id}`}
              data-tab-id={t.id}
              aria-selected={selected}
              aria-controls={`${idBase}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.id)}
            >{t.icon ? <IconLabel id={t.icon}><Terms text={t.label} /></IconLabel> : <Terms text={t.label} />}</button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${idBase}-panel-${t.id}`}
          aria-labelledby={`${idBase}-tab-${t.id}`}
          hidden={t.id !== value}
          className="ui-tabs-panel"
        >{t.panel}</div>
      ))}
    </div>
  );
}
