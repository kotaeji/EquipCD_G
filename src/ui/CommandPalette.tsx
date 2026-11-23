// TURN-053 command palette and shortcut sheet. TURN-066 also finds named objects.
// Neither writes the model.
import { useEffect, useMemo, useRef, useState } from 'react';
import { shortcutSheet, visibleCommands, type CommandRow, type CommandState } from './commandModel';
import { IconLabel } from './Icon';
import { OBJECT_ICON } from './icons';
import {
  indexObjects,
  parseFindQuery,
  searchObjects,
  type ObjectEntry,
  type ObjectKind,
} from './objectFind';
import { useDialogLayer } from './WorkspacePanels';
import './CommandPalette.css';

export const PALETTE_LABEL = '명령 · 대상 찾기';

type PaletteItem =
  | { type: 'command'; row: CommandRow }
  | { type: 'object'; entry: ObjectEntry }
  | { type: 'more'; kind: ObjectKind; count: number };

export function CommandPaletteDialog({ state, mac, onRun, onJump, onClose }: {
  state: CommandState;
  mac: boolean;
  /** Called only for a command that can run. The parent closes the palette. */
  onRun: (id: string) => void;
  /** Enter moves. Shift+Enter only selects. The parent closes the palette. */
  onJump: (entry: ObjectEntry, stay: boolean) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [openKinds, setOpenKinds] = useState<ObjectKind[]>([]);
  const bg = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useDialogLayer(bg, box, onClose);

  const parsed = parseFindQuery(query);
  const showObjects = parsed.scope === 'objects' || (parsed.scope === 'all' && parsed.text.trim() !== '');
  const commands = parsed.scope === 'objects' ? [] : visibleCommands(state, parsed.text, mac);
  const entries = useMemo(() => indexObjects(state.project), [state.project]);
  const groups = showObjects ? searchObjects(entries, parsed.text, new Set(openKinds)) : [];

  const items: PaletteItem[] = [];
  for (const row of commands) items.push({ type: 'command', row });
  for (const group of groups) {
    for (const entry of group.shown) items.push({ type: 'object', entry });
    if (group.more > 0) items.push({ type: 'more', kind: group.kind, count: group.more });
  }
  const index = items.length === 0 ? 0 : Math.min(active, items.length - 1);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const indexRef = useRef(index);
  indexRef.current = index;
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const onJumpRef = useRef(onJump);
  onJumpRef.current = onJump;

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
  }, [index, query, openKinds]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const list = itemsRef.current;
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
      const item = list[indexRef.current];
      if (!item) return;
      if (item.type === 'command') {
        if (item.row.ok) onRunRef.current(item.row.id);
        return;
      }
      if (item.type === 'more') {
        const kind = item.kind;
        setOpenKinds((cur) => (cur.includes(kind) ? cur : [...cur, kind]));
        return;
      }
      onJumpRef.current(item.entry, e.shiftKey);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const choose = (item: PaletteItem, stay: boolean) => {
    if (item.type === 'command') {
      if (item.row.ok) onRun(item.row.id);
      return;
    }
    if (item.type === 'more') {
      setOpenKinds((cur) => (cur.includes(item.kind) ? cur : [...cur, item.kind]));
      return;
    }
    onJump(item.entry, stay);
  };

  let cursor = 0;
  const commandNodes = commands.map((row) => {
    const i = cursor++;
    return (
      <button
        key={row.id}
        type="button"
        role="option"
        aria-selected={i === index}
        aria-disabled={!row.ok}
        data-command={row.id}
        className={`cmd-row${i === index ? ' is-active' : ''}${row.ok ? '' : ' is-dim'}`}
        onMouseMove={() => setActive(i)}
        onClick={() => choose({ type: 'command', row }, false)}
      >
        <span className="cmd-name"><IconLabel id={row.id}>{row.name}</IconLabel></span>
        <span className="cmd-meta">
          <span className="cmd-group">{row.group}</span>
          {!row.ok && <span className="cmd-reason">{row.reason}</span>}
        </span>
        {row.shortcut ? <kbd className="cmd-kbd">{row.shortcut}</kbd> : <span className="cmd-kbd" />}
      </button>
    );
  });

  const objectNodes = groups.map((group) => {
    const rows = group.shown.map((entry) => {
      const i = cursor++;
      return (
        <button
          key={`${entry.kind}:${entry.id}`}
          type="button"
          role="option"
          aria-selected={i === index}
          data-object={entry.id}
          data-object-kind={entry.kind}
          className={`cmd-row is-object${i === index ? ' is-active' : ''}`}
          onMouseMove={() => setActive(i)}
          onClick={(e) => choose({ type: 'object', entry }, e.shiftKey)}
        >
          <span className="cmd-name"><IconLabel id={OBJECT_ICON[entry.kind]}>{entry.name}</IconLabel></span>
          <span className="cmd-meta">
            <span className="cmd-group">{group.label}</span>
            {entry.where && <span className="cmd-where">{entry.where}</span>}
          </span>
          <span className="cmd-code">{entry.code}</span>
        </button>
      );
    });
    const more = group.more > 0 ? (() => {
      const i = cursor++;
      return (
        <button
          key={`${group.kind}:more`}
          type="button"
          role="option"
          aria-selected={i === index}
          data-find-more={group.kind}
          data-find-more-count={group.more}
          className={`cmd-row cmd-more${i === index ? ' is-active' : ''}`}
          onMouseMove={() => setActive(i)}
          onClick={() => choose({ type: 'more', kind: group.kind, count: group.more }, false)}
        >
          <span className="cmd-name"><IconLabel id="object-more">{group.more}개 더</IconLabel></span>
        </button>
      );
    })() : null;
    return (
      <div key={group.kind} data-find-kind={group.kind}>
        <p className="cmd-kind">{group.label}</p>
        {rows}
        {more}
      </div>
    );
  });

  const empty = parsed.scope === 'objects'
    ? '해당하는 대상이 없습니다'
    : showObjects
      ? '해당하는 명령·대상이 없습니다'
      : '해당하는 명령이 없습니다';

  return (
    <div ref={bg} className="modal-bg cmd-bg" onMouseDown={onClose}>
      <div ref={box} tabIndex={-1} className="cmd-panel cmd-find" role="dialog" aria-modal="true" aria-label={PALETTE_LABEL} onMouseDown={(e) => e.stopPropagation()}>
        <input
          aria-label="명령 검색"
          placeholder="명령 · 대상 이름"
          value={query}
          autoFocus
          onChange={(e) => { setQuery(e.target.value); setActive(0); setOpenKinds([]); }}
        />
        <div ref={listRef} className="cmd-list" role="listbox" aria-label="명령 · 대상">
          {commands.length > 0 && showObjects && <p className="cmd-section" data-find-section="commands">명령</p>}
          {commandNodes}
          {groups.length > 0 && <p className="cmd-section" data-find-section="objects">대상</p>}
          {objectNodes}
          {items.length === 0 && <p className="cmd-empty">{empty}</p>}
        </div>
        <div className="cmd-hints">
          <p className="cmd-hint">↑↓ 이동 · Enter 실행·이동 · Shift+Enter 고르기 · Esc 닫기</p>
          <p className="cmd-hint" data-find-hint="">&gt; 명령만 · @ 대상만</p>
        </div>
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
          <button type="button" className="btn-main secondary" onClick={onClose}><IconLabel id="close">닫기</IconLabel></button>
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
