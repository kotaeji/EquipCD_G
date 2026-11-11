/** TURN-002 — live dialogs for Workspace / project management (re-render with current props, unlike the static modal). */
import { useEffect, useRef, useState } from 'react';
import { NAME_MAX, normalizeName, type Workspace } from '../storage/workspaces';

/** true while any dialog layer (management overlay or static confirm) is open — background shortcuts must not act */
export const dialogOpen = () => typeof document !== 'undefined' && document.querySelector('.modal-bg') !== null;

/**
 * Shared dialog-layer behaviour (rev 3/4): focus moves into the dialog, Esc closes only the TOP-most layer (= cancel,
 * no action runs), and on close focus returns to where it was — unless another dialog already took focus.
 */
export function useDialogLayer(bg: React.RefObject<HTMLDivElement | null>, box: React.RefObject<HTMLDivElement | null>, onEsc: () => void) {
  const esc = useRef(onEsc); esc.current = onEsc;
  // remember the opener during the FIRST render — before autoFocus inside the dialog moves focus
  const opener = useRef<HTMLElement | null | undefined>(undefined);
  if (opener.current === undefined) opener.current = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  useEffect(() => {
    const prev = opener.current ?? null;
    if (box.current && !box.current.contains(document.activeElement)) box.current.focus();
    const h = (e: KeyboardEvent) => {
      const layers = document.querySelectorAll('.modal-bg');
      if (layers[layers.length - 1] !== bg.current) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); esc.current(); return; }
      if (e.key !== 'Tab') return;
      const root = box.current; if (!root) return;
      const focusable = [...root.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')]
        .filter((el) => !el.hasAttribute('disabled') && el.tabIndex >= 0 && el.getAttribute('aria-hidden') !== 'true');
      if (focusable.length === 0) { e.preventDefault(); root.focus(); return; }
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) { if (!active || !root.contains(active) || active === first) { e.preventDefault(); last.focus(); } }
      else if (!active || !root.contains(active) || active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', h, true);
    return () => {
      window.removeEventListener('keydown', h, true);
      const a = document.activeElement;
      const lost = !a || a === document.body || !a.isConnected || (bg.current?.contains(a) ?? false);
      if (lost && prev && prev.isConnected && prev !== document.body) prev.focus();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

export function Overlay({ title, onClose, children, label, className }: { title: string; onClose: () => void; children: React.ReactNode; label?: string; className?: string }) {
  const bg = useRef<HTMLDivElement>(null); const box = useRef<HTMLDivElement>(null);
  useDialogLayer(bg, box, onClose);
  return <div ref={bg} className="modal-bg" onClick={onClose}><div ref={box} tabIndex={-1} className={`modal${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={label ?? title} onClick={(e) => e.stopPropagation()}>
    <h3>{title}</h3>{children}</div></div>;
}

/** frame for the App's static confirm/info modal: Esc / backdrop = close without running any action (same as 취소) */
export function StaticModalFrame({ title, onCancel, style, children }: { title: string; onCancel: () => void; style?: React.CSSProperties; children: React.ReactNode }) {
  const bg = useRef<HTMLDivElement>(null); const box = useRef<HTMLDivElement>(null);
  useDialogLayer(bg, box, onCancel);
  return <div ref={bg} className="modal-bg" style={style} onClick={onCancel}><div ref={box} tabIndex={-1} className="modal" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
    <h3>{title}</h3>{children}</div></div>;
}

/** name input with live validation; submit disabled while invalid. Esc / 취소 closes without change. */
export function NameDialog({ title, initial, hint, validate, submitLabel, onSubmit, onCancel }: {
  title: string; initial: string; hint?: string; validate: (name: string) => string | null; submitLabel: string; onSubmit: (name: string) => void; onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const err = validate(v);
  const unchanged = normalizeName(v) === normalizeName(initial) && initial !== '';
  const submit = () => { if (!err && !unchanged) onSubmit(normalizeName(v)); };
  return <Overlay title={title} onClose={onCancel}>
    {hint && <p className="muted" style={{ marginTop: 0 }}>{hint}</p>}
    <label className="namefield">이름
      <input autoFocus value={v} maxLength={NAME_MAX + 20} aria-invalid={!!err} aria-describedby="name-err"
        onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} /></label>
    <div id="name-err" className={`name-note ${err ? 'err-text' : 'muted'}`} role={err ? 'alert' : undefined}>
      {err ?? (unchanged ? '이름이 바뀌지 않았습니다' : `앞뒤 공백은 지워집니다 · ${NAME_MAX}자 이하 · 같은 범위에서 중복 금지(대소문자 무시)`)}</div>
    <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12, gap: 6 }}>
      <button onClick={onCancel}>취소</button>
      <button className="primary" disabled={!!err || unchanged} onClick={submit}>{submitLabel}</button></div>
  </Overlay>;
}

/** Workspace list inside the explorer Workspace tab. Same rules as the old management dialog, without a separate window. */
export function WorkspaceManager({ workspaces, activeId, counts, deleteBlock, onSwitch, onCreate, onRename, onDelete, onBundle, onSearch, onHome, disabled }: {
  workspaces: Workspace[]; activeId: string; counts: Record<string, number>; deleteBlock: (id: string) => string | null;
  onSwitch: (id: string) => void; onCreate: () => void; onRename: (id: string) => void; onDelete: (id: string) => void;
  onBundle: () => void; onSearch: () => void; onHome: () => void; disabled?: boolean;
}) {
  return <div className="ws-inline">
    <p className="muted ex-note">이 브라우저의 작업 묶음. 다른 PC와 자동 공유되지 않습니다.</p>
    <div className="ws-cards">
      {workspaces.map((w) => {
        const block = deleteBlock(w.id); const cur = w.id === activeId;
        return <div key={w.id} data-ws-id={w.id} className={`ws-card ${cur ? 'on' : ''}`}>
          <div><b className="ws-name">{w.name}</b>{cur && <span className="badge ok">현재</span>}</div>
          <div className="muted">프로젝트 {counts[w.id] ?? 0}개</div>
          <div className="mono muted ws-id">{w.id}</div>
          <div className="ws-actions">
            <button type="button" className="small" disabled={disabled || cur} onClick={() => onSwitch(w.id)} aria-label={`${w.name}(으)로 전환`} title={disabled ? '브라우저 저장소 사용 불가' : '전환 시 열린 탭이 닫힙니다 (저장 안 된 편집이 있으면 막음)'}>전환</button>
            <button type="button" className="small" disabled={disabled} onClick={() => onRename(w.id)} aria-label={`${w.name} 이름 변경`}>이름 변경</button>
            <button type="button" className="small danger" disabled={disabled || !!block} title={block ?? '빈 Workspace 삭제'} aria-label={block ? `${w.name} 삭제 불가: ${block}` : `${w.name} 삭제`} onClick={() => onDelete(w.id)}>삭제</button>
          </div>
        </div>;
      })}
    </div>
    <button type="button" className="small" onClick={onCreate} disabled={disabled}>+ 새 Workspace</button>
    <div className="exbtns">
      <button type="button" className="small" onClick={onBundle}>파일 묶음</button>
      <button type="button" className="small" onClick={onSearch}>공통 탐색</button>
      <button type="button" className="small" onClick={onHome}>작업 시작 화면</button>
    </div>
    <p className="muted ex-note">Workspace는 <b>이 브라우저 저장소 안의 프로젝트 묶음</b>입니다. 파일 폴더가 아니며 다른 PC·브라우저와 공유되지 않습니다(옮기려면 프로젝트별 JSON 내보내기). 공유 에셋·파일 묶음·협업은 지원하지 않습니다.</p>
    <p className="muted ex-note">삭제는 저장 프로젝트가 없는 Workspace만 가능합니다(마지막·현재 Workspace 제외). 프로젝트를 함께 지우지 않습니다.</p>
    <div className="notice" data-screen-note="S04">
      <b>Workspace 파일 묶음 — 미구현</b>
      <p>작업 공간 공통 라이브러리와 묶음 파일 입출력은 없습니다. 프로젝트는 이 브라우저에 개별 JSON으로만 저장되며 다른 PC와 자동으로 공유되지 않습니다.</p>
      <button type="button" className="small" disabled title="미구현: 작업 공간 묶음 파일을 만들 수 없습니다">묶음 내보내기</button>
    </div>
  </div>;
}

/** One row in the Project tab: an open tab, a saved project, or both merged by id. */
export interface ProjectListRow {
  id: string;
  name: string;
  tabKey: string | null;
  /** the tab being edited */
  current: boolean;
  /** open in some tab */
  open: boolean;
  /** open and the model revision is ahead of the last save */
  dirty: boolean;
  /** null when this browser has never saved it */
  savedRevision: number | null;
  savedAt: string | null;
}

const presenceLabel = (row: ProjectListRow) => (row.current ? '편집 중' : row.open ? '열림' : '닫힘');

function saveStatus(row: ProjectListRow, kv: boolean): string {
  if (!kv) return '브라우저 저장소 사용 불가';
  if (row.savedRevision === null) return '아직 저장한 적 없음';
  if (row.dirty) return '저장 안 됨';
  const when = row.savedAt ? new Date(row.savedAt).toLocaleString() : '';
  return `저장됨 rev ${row.savedRevision}${when ? ` · ${when}` : ''}`;
}

/**
 * Compact project list for the explorer Project tab (TURN-010).
 * Open tabs come first, then saved projects of this workspace that are not already open.
 * `+` creates or imports. `…` opens the detail popup. The list itself scrolls after six rows.
 */
export function ProjectList({ rows, kv, wsName, onActivate, onCreate, onImport, onFiles, onSwitch, onOpen, onRenameOpen, onRenameSaved, onClose, onDelete }: {
  rows: ProjectListRow[];
  kv: boolean;
  wsName: string;
  onActivate: (row: ProjectListRow) => void;
  onCreate: (kind: 'blank' | 'sample' | 'parallel') => void;
  onImport: () => void;
  onFiles: () => void;
  onSwitch: (tabKey: string) => void;
  onOpen: (id: string) => void;
  onRenameOpen: (tabKey: string) => void;
  onRenameSaved: (id: string) => void;
  onClose: (tabKey: string) => void;
  onDelete: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = detailId ? rows.find((r) => r.id === detailId) ?? null : null;
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setMenu(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || dialogOpen()) return;
      e.preventDefault(); e.stopPropagation(); setMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey, true); };
  }, [menu]);
  const pick = (fn: () => void) => { setMenu(false); fn(); };
  const openDetail = (id: string, opener: HTMLElement) => { opener.focus(); setMenu(false); setDetailId(id); };
  return <div className="proj-sec" ref={box}>
    <div className="proj-head">
      <div className="exlabel">프로젝트 ({rows.length})</div>
      <button type="button" className="proj-add" aria-label="프로젝트 추가" aria-haspopup="menu" aria-expanded={menu} title="새 프로젝트, 가져오기" onClick={() => setMenu((v) => !v)}>+</button>
    </div>
    {menu && <div className="proj-menu" role="menu" aria-label="프로젝트 추가">
      <button type="button" role="menuitem" title="빈 프로젝트로 시작" onClick={() => pick(() => onCreate('blank'))}>빈 프로젝트</button>
      <button type="button" role="menuitem" title="기본 5공정 Station 예제 사본" onClick={() => pick(() => onCreate('sample'))}>5공정 예제</button>
      <button type="button" role="menuitem" title="Substation 하나에 병렬 시퀀스 2개가 있는 예제" onClick={() => pick(() => onCreate('parallel'))}>병렬 예제</button>
      <button type="button" role="menuitem" onClick={() => pick(onImport)}>JSON 가져오기</button>
      <button type="button" role="menuitem" onClick={() => pick(onFiles)}>프로젝트 파일</button>
    </div>}
    <div className="proj-list" role="listbox" aria-label="프로젝트">
      {rows.map((row) => <div key={row.id} role="option" tabIndex={0} data-project-id={row.id} data-open={row.open ? 'true' : 'false'} data-current={row.current ? 'true' : 'false'} data-dirty={row.dirty ? 'true' : 'false'}
        aria-selected={row.current} className={`exitem ${row.current ? 'on' : ''}`} title={row.id}
        onClick={() => onActivate(row)} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onActivate(row); }}>
        <span className="nm">{row.name}</span>
        {row.open && !row.current && <span className="open-dot" role="img" aria-label="열림" title="열림" />}
        {row.dirty && <span className="dirty" title="미저장" aria-label="미저장">●</span>}
        <button type="button" className="x" aria-label={`${row.name} 프로젝트 상세`} title="프로젝트 상세" onClick={(e) => { e.stopPropagation(); openDetail(row.id, e.currentTarget); }}>…</button>
      </div>)}
    </div>
    {detail && <Overlay className="proj-pop" title={`프로젝트 — ${detail.name}`} onClose={() => setDetailId(null)}>
      <dl className="proj-detail">
        <div><dt>이름</dt><dd>{detail.name}</dd></div>
        <div><dt>ID</dt><dd className="mono">{detail.id}</dd></div>
        <div><dt>상태</dt><dd>{presenceLabel(detail)}</dd></div>
        <div><dt>저장 상태</dt><dd>{saveStatus(detail, kv)}</dd></div>
        <div><dt>소속 Workspace</dt><dd>{wsName}</dd></div>
      </dl>
      <div className="proj-actions">
        <button type="button" disabled={detail.current} title={detail.current ? '이미 편집 중인 프로젝트입니다' : undefined}
          onClick={() => { if (detail.tabKey) onSwitch(detail.tabKey); else onOpen(detail.id); }}>{detail.open ? '이 프로젝트로 전환' : '열기'}</button>
        <button type="button" aria-label={`${detail.name} 이름 변경`} title={detail.open ? '이름 변경 (Undo 가능, 저장 시 목록 반영)' : '닫힌 저장본의 이름을 바꿉니다 (rev +1, Undo 대상 아님)'}
          onClick={() => { if (detail.tabKey) onRenameOpen(detail.tabKey); else onRenameSaved(detail.id); }}>이름 변경</button>
        <button type="button" disabled={!detail.open} title={detail.open ? '탭 닫기 (저장 데이터는 지우지 않음)' : '닫힌 프로젝트에는 닫을 탭이 없습니다'}
          aria-label={detail.open ? `${detail.name} 닫기` : `${detail.name} 탭 닫기 불가: 닫힌 프로젝트`}
          onClick={() => { if (detail.tabKey) onClose(detail.tabKey); }}>탭 닫기</button>
        <button type="button" className="danger" disabled={detail.open} title={detail.open ? '열린 프로젝트는 삭제할 수 없습니다 — 먼저 탭을 닫으세요' : '영구 삭제'}
          aria-label={detail.open ? `${detail.name} 삭제 불가: 열린 프로젝트` : `${detail.name} 영구 삭제`}
          onClick={() => onDelete(detail.id)}>삭제</button>
        <button type="button" onClick={() => setDetailId(null)}>닫기</button>
      </div>
      <p className="muted ex-note">탭 닫기는 저장 데이터를 지우지 않습니다. 새 프로젝트는 저장할 때 이 Workspace에 들어옵니다.</p>
    </Overlay>}
  </div>;
}
