// TURN-094. Named save points under 「바뀐 것」. Creating one does not edit the model.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../model/types';
import { diffProjects, diffSummaryText, type ProjectDiff } from '../model/projectDiff';
import { parseProjectFile, serializeProject } from '../storage/fileFormat';
import type { KV } from '../storage/localStore';
import {
  SAVE_POINT_LIMIT, SAVE_POINT_NAME_MAX, SAVE_POINT_NOTE_MAX,
  createSavePoint, deleteSavePoint, loadSavePoint, readSavePointRecords, renameSavePoint, restoredProject,
  validateSavePointName, validateSavePointNote, type SavePointRecord,
} from '../storage/savePoints';
import { formatLocalClock } from './localClock';
import { ProjectDiffList } from './ProjectDiffView';
import { Overlay } from './WorkspacePanels';
import type { ItemJump } from './wizard';
import './save-points.css';

function storedShape(p: Project): Project {
  const parsed = parseProjectFile(serializeProject(p));
  return parsed.ok ? parsed.project : p;
}

type FormState =
  | { kind: 'create'; name: string; note: string }
  | { kind: 'rename'; id: string; name: string; note: string };

export function SavePoints({ project, kv, locked, storageReason, createOpen, onCreateOpenChange, onRestore, onOpenCopy, onJump }: {
  project: Project;
  kv: KV | null;
  locked: boolean;
  storageReason: string | null;
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  onRestore: (next: Project) => boolean;
  onOpenCopy: (snapshot: Project) => void;
  onJump: (jump: ItemJump) => void;
}) {
  const [tick, setTick] = useState(0);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drop, setDrop] = useState<SavePointRecord | null>(null);
  const [removing, setRemoving] = useState<SavePointRecord | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [diffId, setDiffId] = useState<string | null>(null);
  const projectId = useRef(project.id);

  useEffect(() => {
    if (!createOpen) return;
    setForm({ kind: 'create', name: '', note: '' });
    setDrop(null);
    setError(null);
  }, [createOpen]);

  useEffect(() => {
    if (projectId.current === project.id) return;
    projectId.current = project.id;
    setForm(null);
    setError(null);
    setDrop(null);
    setRemoving(null);
    setRestoringId(null);
    setDiffId(null);
    onCreateOpenChange(false);
  }, [project.id, onCreateOpenChange]);

  const listed = useMemo(() => {
    if (!kv) return { ok: false as const, reason: storageReason ?? '저장소를 쓸 수 없습니다' };
    return readSavePointRecords(kv, project.id);
  }, [kv, project.id, storageReason, tick]);

  const points = listed.ok ? listed.points : [];
  const closeCreate = () => { setForm(null); setDrop(null); onCreateOpenChange(false); };

  const submitCreate = (dropOldest: boolean) => {
    if (!kv || !form || form.kind !== 'create') return;
    const nameError = validateSavePointName(form.name);
    const noteError = validateSavePointNote(form.note);
    if (nameError || noteError) { setError(nameError ?? noteError); return; }
    if (points.length >= SAVE_POINT_LIMIT && !dropOldest) {
      setDrop(points[points.length - 1] ?? null);
      return;
    }
    const written = createSavePoint(kv, project, form.name, form.note, new Date(), { dropOldest });
    if (!written.ok) { setError(written.reason); setDrop(null); return; }
    setError(null);
    setTick((n) => n + 1);
    closeCreate();
  };

  const submitRename = () => {
    if (!kv || !form || form.kind !== 'rename') return;
    const nameError = validateSavePointName(form.name);
    const noteError = validateSavePointNote(form.note);
    if (nameError || noteError) { setError(nameError ?? noteError); return; }
    const written = renameSavePoint(kv, project.id, form.id, form.name, form.note);
    if (!written.ok) { setError(written.reason); return; }
    setError(null);
    setForm(null);
    setTick((n) => n + 1);
  };

  const confirmDelete = () => {
    if (!kv || !removing) return;
    const written = deleteSavePoint(kv, project.id, removing.id);
    if (!written.ok) { setError(written.reason); setRemoving(null); return; }
    if (diffId === removing.id) setDiffId(null);
    if (restoringId === removing.id) setRestoringId(null);
    setRemoving(null);
    setError(null);
    setTick((n) => n + 1);
  };

  const loadedDiff = useMemo(() => {
    if (!diffId || !kv) return null;
    return loadSavePoint(kv, project.id, diffId);
  }, [diffId, kv, project.id, tick]);

  const diffView = useMemo(() => {
    if (!loadedDiff || !loadedDiff.ok) return null;
    const diff = diffProjects(storedShape(loadedDiff.project), storedShape(project));
    return { name: loadedDiff.record.name, diff };
  }, [loadedDiff, project]);

  const restoring = useMemo(() => {
    if (!restoringId || !kv) return null;
    return loadSavePoint(kv, project.id, restoringId);
  }, [restoringId, kv, project.id, tick]);

  const restoreDiff: ProjectDiff | null = restoring && restoring.ok
    ? diffProjects(storedShape(restoring.project), storedShape(project))
    : null;
  const restoreTotal = restoreDiff ? restoreDiff.added + restoreDiff.removed + restoreDiff.changed : 0;

  const confirmRestore = () => {
    if (!restoring || !restoring.ok || locked) return;
    const ok = onRestore(restoredProject(project, restoring.project));
    if (!ok) return;
    setRestoringId(null);
    setDiffId(null);
  };

  const openCopy = (id: string) => {
    if (!kv) return;
    const loaded = loadSavePoint(kv, project.id, id);
    if (!loaded.ok) { setError(loaded.reason); return; }
    onOpenCopy(loaded.project);
  };

  const nameError = form ? validateSavePointName(form.name) : null;
  const noteError = form ? validateSavePointNote(form.note) : null;
  const formError = nameError ?? noteError;

  return <section className="sheet save-points" data-save-points="" data-save-point-count={points.length}>
    <h2>저장 지점{points.length ? ` ${points.length}` : ''}</h2>
    <p className="save-points-lead">이 브라우저에 이름을 붙여 남겨 둡니다. 프로젝트마다 {SAVE_POINT_LIMIT}개까지. 만들기는 모델, rev, 실행 취소를 바꾸지 않습니다.</p>
    <button type="button" data-save-point-create="" disabled={!kv || !listed.ok} onClick={() => onCreateOpenChange(true)}>저장 지점 만들기</button>
    {!listed.ok && <p className="save-points-error" data-save-point-error="">{listed.reason}</p>}
    {listed.ok && error && !form && <p className="save-points-error" data-save-point-error="">{error}</p>}
    {listed.ok && points.length === 0 && <p className="save-points-empty" data-save-point-empty="">저장 지점이 없습니다.</p>}
    {points.length > 0 && <ul className="save-point-list">
      {points.map((point) => <li key={point.id} className="save-point-row" data-save-point={point.id}>
        <div className="save-point-main">
          <span className="save-point-name" data-save-point-name="">{point.name}</span>
          <time className="save-point-meta" dateTime={point.savedAt} title={point.savedAt}>{formatLocalClock(point.savedAt)}</time>
          <span className="save-point-meta" data-save-point-rev="">rev {point.revision}</span>
          {point.note && <span className="save-point-note" data-save-point-note="">{point.note}</span>}
        </div>
        <div className="save-point-actions">
          <button type="button" className="small" aria-label={`${point.name} 차이 보기`} onClick={() => setDiffId((cur) => cur === point.id ? null : point.id)}>차이 보기</button>
          <button type="button" className="small" aria-label={`${point.name} 사본으로 열기`} onClick={() => openCopy(point.id)}>사본으로 열기</button>
          <button type="button" className="small" aria-label={`${point.name} 이 지점으로 되돌리기`} disabled={locked} title={locked ? '실행 중에는 되돌릴 수 없습니다' : undefined} onClick={() => setRestoringId(point.id)}>이 지점으로 되돌리기</button>
          <button type="button" className="small" aria-label={`${point.name} 이름 바꾸기`} onClick={() => { setError(null); setForm({ kind: 'rename', id: point.id, name: point.name, note: point.note }); }}>이름 바꾸기</button>
          <button type="button" className="small danger" aria-label={`${point.name} 저장 지점 삭제`} onClick={() => setRemoving(point)}>삭제</button>
        </div>
      </li>)}
    </ul>}
    {diffView && <div className="save-point-diff" data-save-point-diff="">
      <p className="project-diff-lead">앞은 저장 지점 「{diffView.name}」, 뒤는 지금입니다. 비교는 모델을 바꾸지 않습니다.</p>
      {diffView.diff.rows.length === 0
        ? <p className="project-diff-same" data-diff-same="">저장 지점과 같습니다</p>
        : <>
          <p className="project-diff-summary" data-diff-summary="">{diffSummaryText(diffView.diff)}</p>
          <ProjectDiffList diff={diffView.diff} project={project} onJump={onJump} />
        </>}
    </div>}
    {loadedDiff && !loadedDiff.ok && <p className="save-points-error" data-save-point-error="">{loadedDiff.reason}</p>}

    {form && <Overlay title={form.kind === 'create' ? '저장 지점 만들기' : '저장 지점 이름 바꾸기'} onClose={form.kind === 'create' ? closeCreate : () => setForm(null)}>
      <div className="save-point-form">
        <p className="save-points-lead">이름은 {SAVE_POINT_NAME_MAX}자까지입니다. 메모는 선택이며 {SAVE_POINT_NOTE_MAX}자까지입니다.</p>
        <label>이름
          <input autoFocus aria-label="저장 지점 이름" maxLength={SAVE_POINT_NAME_MAX} value={form.name} aria-invalid={!!nameError}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (form.kind === 'create') submitCreate(false); else submitRename(); } }} />
        </label>
        <label>메모
          <textarea aria-label="저장 지점 메모" maxLength={SAVE_POINT_NOTE_MAX} rows={3} value={form.note} aria-invalid={!!noteError}
            onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </label>
        <div className={`name-note ${formError ? 'err-text' : 'muted'}`} role={formError ? 'alert' : undefined}>{formError ?? '앞뒤 공백은 지워집니다.'}</div>
        {error && !formError && <p className="save-points-error" data-save-point-error="">{error}</p>}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
          <button type="button" onClick={form.kind === 'create' ? closeCreate : () => setForm(null)}>취소</button>
          <button type="button" className="primary" data-save-point-submit="" disabled={!!formError} onClick={() => { if (form.kind === 'create') submitCreate(false); else submitRename(); }}>{form.kind === 'create' ? '만들기' : '이름 바꾸기'}</button>
        </div>
      </div>
    </Overlay>}

    {drop && <Overlay title="가장 오래된 저장 지점을 지울까요?" onClose={() => setDrop(null)}>
      <p data-save-point-drop="">저장 지점은 {SAVE_POINT_LIMIT}개까지입니다. 가장 오래된 「{drop.name}」(<time dateTime={drop.savedAt} title={drop.savedAt}>{formatLocalClock(drop.savedAt)}</time>)을 지우고 만들까요?</p>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
        <button type="button" autoFocus data-save-point-drop-cancel="" onClick={() => setDrop(null)}>취소</button>
        <button type="button" className="danger" data-save-point-drop-confirm="" onClick={() => submitCreate(true)}>지우고 만들기</button>
      </div>
    </Overlay>}

    {removing && <Overlay title="저장 지점을 지울까요?" onClose={() => setRemoving(null)}>
      <p>「{removing.name}」을 지웁니다. 모델, rev, 실행 취소는 그대로입니다.</p>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
        <button type="button" autoFocus onClick={() => setRemoving(null)}>취소</button>
        <button type="button" className="danger" data-save-point-delete="" onClick={confirmDelete}>삭제</button>
      </div>
    </Overlay>}

    {restoring && restoring.ok && restoreDiff && <Overlay title="이 지점으로 되돌릴까요?" onClose={() => setRestoringId(null)}>
      <p data-save-point-restore="" data-change-count={restoreTotal}>「{restoring.record.name}」(으)로 되돌립니다. 바뀌는 항목 {restoreTotal}개. {diffSummaryText(restoreDiff)}. 앞은 이 지점, 뒤는 지금입니다. rev 는 {project.revision + 1}이 되고, 실행 취소 한 번으로 돌아옵니다.</p>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
        <button type="button" autoFocus data-save-point-restore-cancel="" onClick={() => setRestoringId(null)}>취소</button>
        <button type="button" className="primary" data-save-point-restore-confirm="" disabled={locked} onClick={confirmRestore}>이 지점으로 되돌리기</button>
      </div>
    </Overlay>}
    {restoring && !restoring.ok && <Overlay title="저장 지점을 읽지 못했습니다" onClose={() => setRestoringId(null)}>
      <p className="save-points-error" data-save-point-error="">{restoring.reason}</p>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" autoFocus onClick={() => setRestoringId(null)}>닫기</button></div>
    </Overlay>}
  </section>;
}
