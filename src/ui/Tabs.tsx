import { useRef } from 'react';

/** One tab in the shared underline tab list. TURN-009 reuses this for the layout board and the diagram. */
export interface TabSpec<T extends string> {
  id: T;
  label: string;
  panel: React.ReactNode;
}

/**
 * Underline tabs: tablist, tab, tabpanel, and ←/→ to move the selection.
 * Only the selected panel is shown (`hidden` on the others).
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
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = tabs.findIndex((t) => t.id === value);
    if (i < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(i + dir + tabs.length) % tabs.length];
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
            >{t.label}</button>
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
