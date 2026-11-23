// TURN-053. Command palette and the shortcut sheet. Neither writes the model.
import { useEffect, useRef, useState } from 'react';
import { shortcutSheet, visibleCommands, type CommandState } from './commandModel';
import { useDialogLayer } from './WorkspacePanels';

export function CommandPaletteDialog({ state, mac, onRun, onClose }: {
  state: CommandState;
  mac: boolean;
  /** Called only for a command that can run. The parent closes the palette. */
  onRun: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const bg = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useDialogLayer(bg, box, onClose);
  const rows = visibleCommands(state, query, mac);
  const index = rows.length === 0 ? 0 : Math.min(active, rows.length - 1);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const indexRef = useRef(index);
  indexRef.current = index;
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
  }, [index, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const list = rowsRef.current;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!list.length) return;
        e.preventDefault();
        e.stopPropagation();
        const cur = indexRef.current;
        const next = e.key === 'ArrowDown' ? (cur + 1) % list.length : (cur - 1 + list.length) % list.length;
        setActive(next);
        return;
      }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      const row = list[indexRef.current];
      if (row?.ok) onRunRef.current(row.id);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div ref={bg} className="modal-bg cmd-bg" onMouseDown={onClose}>
      <div ref={box} tabIndex={-1} className="cmd-panel" role="dialog" aria-modal="true" aria-label="명령 찾기" onMouseDown={(e) => e.stopPropagation()}>
        <input
          aria-label="명령 검색"
          placeholder="명령 이름"
          value={query}
          autoFocus
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
        />
        <div ref={listRef} className="cmd-list" role="listbox" aria-label="명령">
          {rows.map((row, i) => (
            <button
              key={row.id}
              type="button"
              role="option"
              aria-selected={i === index}
              aria-disabled={!row.ok}
              data-command={row.id}
              className={`cmd-row${i === index ? ' is-active' : ''}${row.ok ? '' : ' is-dim'}`}
              onMouseMove={() => setActive(i)}
              onClick={() => { if (row.ok) onRun(row.id); }}
            >
              <span className="cmd-name">{row.name}</span>
              <span className="cmd-meta">
                <span className="cmd-group">{row.group}</span>
                {!row.ok && <span className="cmd-reason">{row.reason}</span>}
              </span>
              {row.shortcut ? <kbd className="cmd-kbd">{row.shortcut}</kbd> : <span className="cmd-kbd" />}
            </button>
          ))}
          {rows.length === 0 && <p className="cmd-empty">해당하는 명령이 없습니다</p>}
        </div>
        <p className="cmd-hint">↑↓ 이동 · Enter 실행 · Esc 닫기</p>
      </div>
    </div>
  );
}

export function ShortcutSheet({ state, mac, onClose }: { state: CommandState; mac: boolean; onClose: () => void }) {
  const bg = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useDialogLayer(bg, box, onClose);
  const groups = shortcutSheet(state, mac);
  return (
    <div ref={bg} className="modal-bg cmd-bg" onMouseDown={onClose}>
      <div ref={box} tabIndex={-1} className="cmd-sheet" role="dialog" aria-modal="true" aria-label="단축키 목록" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmd-sheet-head">
          <h3>단축키 목록</h3>
          <button type="button" className="btn-main secondary" onClick={onClose}>닫기</button>
        </div>
        {groups.map((g) => (
          <section key={g.group} data-shortcut-group={g.group}>
            <h4>{g.group}</h4>
            <table>
              <thead><tr><th>단축키</th><th>하는 일</th><th>어디서</th></tr></thead>
              <tbody>
                {g.rows.map((row) => (
                  <tr key={row.id} data-shortcut={row.id} data-shortcut-source={row.source}>
                    <td className="cmd-kbd">{row.keys}</td>
                    <td>{row.name}</td>
                    <td>{row.where}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </div>
  );
}
