import { useMemo, useRef, useState } from 'react';
import './bundle-screen.css';
import type { KV } from '../storage/localStore';
import {
  applyWorkspaceBundle, exportWorkspaceBundle, parseWorkspaceBundle, previewWorkspaceBundle, summaryLine,
  type BundleApplyResult, type BundleMode, type BundlePreview, type ConflictChoice, type WorkspaceBundle,
} from '../storage/workspaceBundle';
import type { WorkspaceRegistry } from '../storage/workspaces';
import { Overlay } from './WorkspacePanels';
import { Problem } from './Problem';
import { bundleRejectProblem, type ProblemCopy } from './problemCopy';

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('read'));
    reader.readAsText(file);
  });
}

export function BundleSheet({ kv, reg, dirtyNames, openIds, storageReason, onDownload, onCommitted, onSwitch }: {
  kv: KV | null;
  reg: WorkspaceRegistry;
  dirtyNames: string[];
  openIds: string[];
  storageReason: string | null;
  onDownload: (name: string, text: string) => void;
  onCommitted: (result: BundleApplyResult) => void;
  onSwitch: (workspaceId: string) => void;
}) {
  const ws = reg.workspaces.find((w) => w.id === reg.activeId) ?? reg.workspaces[0];
  const locked = !kv || !!storageReason;
  const lockReason = storageReason ?? (!kv ? '저장소를 쓸 수 없습니다' : null);
  const built = useMemo(() => {
    if (!kv) return null;
    const current = reg.workspaces.find((w) => w.id === reg.activeId) ?? reg.workspaces[0];
    if (!current) return null;
    return exportWorkspaceBundle(kv, reg, current.id, new Date());
  }, [kv, reg]);
  const exported = built && !('ok' in built) ? built : null;
  const exportError = built && 'ok' in built ? built.reason : null;
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<BundleMode>('new');
  const [preview, setPreview] = useState<BundlePreview | null>(null);
  const [bundle, setBundle] = useState<WorkspaceBundle | null>(null);
  const [choices, setChoices] = useState<Record<number, ConflictChoice>>({});
  const [problem, setProblem] = useState<ProblemCopy | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [reopen, setReopen] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [confirmExport, setConfirmExport] = useState(false);
  const [switchTo, setSwitchTo] = useState<{ id: string; name: string } | null>(null);

  const conflicts = preview?.rows.filter((r) => r.verdict === 'conflict') ?? [];
  const choiceOf = (index: number): ConflictChoice => choices[index] ?? 'copy';

  const runExport = () => {
    if (!kv || !ws || locked) return;
    const fresh = exportWorkspaceBundle(kv, reg, ws.id, new Date());
    if ('ok' in fresh) { setProblem({ tone: 'error', what: '내보내지 않았습니다', why: fresh.reason, how: '저장소 상태를 확인한 뒤 다시 내보내세요.' }); return; }
    onDownload(fresh.fileName, fresh.text);
    setConfirmExport(false);
  };
  const askExport = () => {
    if (locked || !exported) return;
    if (dirtyNames.length) setConfirmExport(true);
    else runExport();
  };
  const onFile = async (file: File) => {
    setSummary(null);
    setReopen(false);
    setSwitchTo(null);
    setChoices({});
    let text = '';
    try { text = await readTextFile(file); } catch { setBundle(null); setPreview(null); setProblem(bundleRejectProblem('파일을 읽지 못했습니다.')); return; }
    const parsed = parseWorkspaceBundle(text);
    if (!parsed.ok) { setBundle(null); setPreview(null); setProblem(bundleRejectProblem(parsed.why)); return; }
    if (!kv) { setProblem(bundleRejectProblem(lockReason ?? '저장소를 쓸 수 없습니다.')); return; }
    setProblem(null);
    setBundle(parsed.bundle);
    setPreview(previewWorkspaceBundle(kv, reg, parsed.bundle));
  };
  const apply = (overwriteConfirmed: boolean) => {
    if (!kv || !bundle || locked) return;
    const needsOverwrite = preview?.rows.some((r) => r.verdict === 'conflict' && choiceOf(r.index) === 'overwrite');
    if (needsOverwrite && !overwriteConfirmed) { setConfirmOverwrite(true); return; }
    const before = previewWorkspaceBundle(kv, reg, bundle);
    const result = applyWorkspaceBundle(kv, reg, bundle, mode, choices);
    if (!result.ok) {
      setProblem({ tone: 'error', what: '가져오지 않았습니다', why: result.reason, how: '저장소는 가져오기 전 그대로입니다.' });
      setConfirmOverwrite(false);
      return;
    }
    setProblem(null);
    setConfirmOverwrite(false);
    setSummary(summaryLine(result.summary));
    const opened = result.overwrittenIds.filter((id) => openIds.includes(id));
    setReopen(opened.length > 0);
    onCommitted(result);
    if (result.newWorkspace) setSwitchTo(result.newWorkspace);
    setPreview(before);
  };
  const setAll = (choice: ConflictChoice) => {
    const next: Record<number, ConflictChoice> = {};
    for (const row of conflicts) next[row.index] = choice;
    setChoices(next);
  };
  const verdictLabel = { new: '새로 들어옴', conflict: '같은 ID 있음', unreadable: '읽을 수 없음' } as const;

  return <div className="bundle-screen" data-bundle-screen="">
    <h1 className="stage-title">Workspace 파일 묶음</h1>
    <p className="bundle-lead">저장된 프로젝트만 파일 하나에 넣습니다. 저장 안 된 변경, 임시 저장, 보기 설정, 격리 보관함, 실행 기록은 넣지 않습니다.</p>
    {lockReason && <p className="bundle-lock" data-bundle-locked="">{lockReason} 메모리 전용이라 묶음 파일을 내보내고 가져올 수 없습니다.</p>}
    {dirtyNames.length > 0 && <p className="bundle-note" data-bundle-dirty="">저장 안 된 변경은 빠집니다. {dirtyNames.join(', ')}</p>}
    <div className="sparse-split">
      <section className="sheet">
        <h2>내보낼 프로젝트</h2>
        <p className="field-ro">{ws?.name ?? ''}</p>
        <table className="grid plain"><thead><tr><th>이름</th><th>rev</th><th>저장 시각</th></tr></thead>
          <tbody>
            {exported && exported.projects.map((p) => <tr key={p.id} data-export-project={p.id}><td>{p.name}</td><td>{p.revision}</td><td>{p.savedAt ? new Date(p.savedAt).toLocaleString() : ''}</td></tr>)}
            {exported && exported.projects.length === 0 && <tr><td colSpan={3}>저장된 프로젝트가 없습니다.</td></tr>}
            {exportError && <tr><td colSpan={3}>{exportError}</td></tr>}
          </tbody></table>
        {exported && exported.omitted.length > 0 && <p className="bundle-note">읽지 못한 저장본 {exported.omitted.length}개는 넣지 않았습니다.</p>}
        <p className="bundle-bytes" data-bundle-bytes={exported ? String(exported.bytes) : ''}>{exported ? `${exported.bytes}바이트` : ''}</p>
        <button type="button" data-bundle-export="" disabled={locked || !exported} title={lockReason ?? '이 Workspace의 저장된 프로젝트를 파일로 받습니다'} onClick={askExport}>묶음 내보내기</button>
      </section>
      <aside className="sheet">
        <h2>가져오기</h2>
        <input ref={fileRef} type="file" accept=".json,application/json,.aurora-workspace.json" data-bundle-file="" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
        <button type="button" data-bundle-pick="" disabled={locked} title={lockReason ?? '묶음 파일을 고르면 미리보기가 나옵니다'} onClick={() => fileRef.current?.click()}>묶음 파일 고르기</button>
        {problem && <Problem copy={problem} />}
        {preview && <>
          <p className="bundle-note">Workspace {preview.workspaceName}</p>
          <div className="bundle-choice" role="radiogroup" aria-label="받는 방법">
            <label><input type="radio" name="bundle-mode" checked={mode === 'new'} onChange={() => setMode('new')} />새 Workspace 로</label>
            <label><input type="radio" name="bundle-mode" checked={mode === 'add'} onChange={() => setMode('add')} />지금 Workspace 에 더하기</label>
          </div>
        </>}
      </aside>
    </div>
    {preview && <section className="sheet wide">
      <h2>미리보기</h2>
      <table className="grid plain"><thead><tr><th>이름</th><th>rev</th><th>판정</th><th>선택</th></tr></thead>
        <tbody>{preview.rows.map((r) => <tr key={r.index} data-bundle-row={r.index} data-verdict={r.verdict}>
          <td>{r.name}</td>
          <td>{r.revision ?? '—'}</td>
          <td>{verdictLabel[r.verdict]}{r.reason && r.verdict === 'unreadable' ? ` · ${r.reason}` : ''}</td>
          <td>{r.verdict === 'conflict'
            ? <select aria-label={`${r.name} 받는 방법`} value={choiceOf(r.index)} onChange={(e) => setChoices((c) => ({ ...c, [r.index]: e.target.value as ConflictChoice }))}>
              <option value="copy">사본으로 넣기</option>
              <option value="skip">건너뛰기</option>
              <option value="overwrite">덮어쓰기</option>
            </select>
            : '—'}</td>
        </tr>)}</tbody></table>
      {conflicts.length > 0 && <div className="tool-pills">
        <button type="button" onClick={() => setAll('copy')}>모두 사본</button>
        <button type="button" onClick={() => setAll('skip')}>모두 건너뛰기</button>
        <button type="button" onClick={() => setAll('overwrite')}>모두 덮어쓰기</button>
      </div>}
      <button type="button" data-bundle-import="" disabled={locked} onClick={() => apply(false)}>가져오기</button>
      {summary && <p className="bundle-summary" data-bundle-summary="">{summary}</p>}
      {reopen && <p className="bundle-note" data-bundle-reopen="">저장본이 바뀌었습니다 — 다시 열어 주세요</p>}
    </section>}
    {confirmExport && <Overlay title="저장 안 된 변경은 빠집니다" onClose={() => setConfirmExport(false)}>
      <p>열린 프로젝트의 저장 안 된 변경은 파일에 들어가지 않습니다. {dirtyNames.join(', ')}</p>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
        <button type="button" autoFocus onClick={() => setConfirmExport(false)}>취소</button>
        <button type="button" className="primary" onClick={runExport}>그래도 내보내기</button>
      </div>
    </Overlay>}
    {confirmOverwrite && <Overlay title="저장본을 덮어쓸까요?" onClose={() => setConfirmOverwrite(false)}>
      <p>같은 ID의 저장본을 이 파일의 내용으로 바꿉니다. 열린 탭의 내용은 바꾸지 않습니다.</p>
      <ul>{conflicts.filter((r) => choiceOf(r.index) === 'overwrite').map((r) => <li key={r.index}>{r.name}</li>)}</ul>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
        <button type="button" autoFocus data-overwrite-cancel="" onClick={() => setConfirmOverwrite(false)}>취소</button>
        <button type="button" className="danger" data-overwrite-confirm="" onClick={() => apply(true)}>덮어쓰기</button>
      </div>
    </Overlay>}
    {switchTo && <Overlay title="새 Workspace로 바꿀까요?" onClose={() => setSwitchTo(null)}>
      <p>「{switchTo.name}」(으)로 바꿀까요?</p>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
        <button type="button" autoFocus onClick={() => setSwitchTo(null)}>나중에</button>
        <button type="button" className="primary" data-bundle-switch="" onClick={() => { const id = switchTo.id; setSwitchTo(null); onSwitch(id); }}>바꾸기</button>
      </div>
    </Overlay>}
  </div>;
}
