/** TURN-002 — live dialogs for Workspace / project management (re-render with current props, unlike the static modal). */
import { useEffect, useRef, useState } from 'react';
import type { IndexEntry } from '../storage/localStore';
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

export function Overlay({ title, onClose, children, label }: { title: string; onClose: () => void; children: React.ReactNode; label?: string }) {
  const bg = useRef<HTMLDivElement>(null); const box = useRef<HTMLDivElement>(null);
  useDialogLayer(bg, box, onClose);
  return <div ref={bg} className="modal-bg" onClick={onClose}><div ref={box} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-label={label ?? title} onClick={(e) => e.stopPropagation()}>
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

/** Saved projects of the current workspace, inside the explorer Project tab. */
export function ProjectManager({ wsName, entries, openIds, onOpen, onRename, onDelete }: {
  wsName: string; entries: IndexEntry[]; openIds: Set<string>;
  onOpen: (id: string) => void; onRename: (id: string) => void; onDelete: (id: string) => void;
}) {
  return <div className="proj-inline">
    <div className="exlabel">저장된 프로젝트 ({wsName})</div>
    <p className="muted ex-note">현재 Workspace에 저장된 프로젝트만 보입니다. 새 프로젝트는 「저장」할 때 이 Workspace에 들어옵니다. 탭 닫기(×)는 저장 데이터를 지우지 않습니다.</p>
    {entries.length ? entries.map((e) => {
      const open = openIds.has(e.id);
      return <div key={e.id} data-project-id={e.id} className="saved-row">
        <div className="saved-main"><b>{e.name}</b>{open && <span className="badge">열림</span>}<div className="mono muted">{e.id}</div></div>
        <div className="muted saved-rev">rev {e.revision} · {new Date(e.savedAt).toLocaleString()}</div>
        <div className="ws-actions">
          <button type="button" className="small" onClick={() => onOpen(e.id)}>{open ? '탭으로 이동' : '열기'}</button>
          <button type="button" className="small" disabled={open} title={open ? '열린 프로젝트는 탭의 ✎로 이름을 바꾸세요 (저장 시 목록에 반영)' : undefined}
            aria-label={open ? `${e.name} 이름 변경 불가: 열린 프로젝트는 탭에서 변경` : `${e.name} 이름 변경`} onClick={() => onRename(e.id)}>이름 변경</button>
          <button type="button" className="small danger" disabled={open} title={open ? '열린 프로젝트는 삭제할 수 없습니다 — 먼저 탭을 닫으세요' : '영구 삭제'}
            aria-label={open ? `${e.name} 삭제 불가: 열린 프로젝트` : `${e.name} 영구 삭제`} onClick={() => onDelete(e.id)}>삭제</button>
        </div>
      </div>;
    }) : <div className="tempty">아직 저장한 프로젝트가 없습니다.</div>}
  </div>;
}
