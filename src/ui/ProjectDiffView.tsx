// TURN-081. Saved copy, another project, or a JSON file against the open model. Read only.
import { useMemo, useRef, useState } from 'react';
import type { Project } from '../model/types';
import {
  EMPTY_PROJECT_DIFF, SAME_AS_SAVED, diffProjects, diffSummaryText, groupDiff,
  type ProjectDiff,
} from '../model/projectDiff';
import { parseProjectFile, serializeProject } from '../storage/fileFormat';
import { loadDraft } from '../storage/drafts';
import { loadProject, readIndex, type KV } from '../storage/localStore';
import { Fold } from './Fold';
import { diffJump } from './projectDiffJump';
import type { ItemJump } from './wizard';
import './project-diff.css';

const NO_SAVED = '저장본이 없습니다';
const UNREADABLE = '저장본을 읽지 못했습니다';
const SAME_OTHER = '차이가 없습니다';
const CHANGE_WORD = { added: '추가', removed: '삭제', changed: '바뀜' } as const;

function storedShape(p: Project): Project {
  const parsed = parseProjectFile(serializeProject(p));
  return parsed.ok ? parsed.project : p;
}

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('read'));
    reader.readAsText(file);
  });
}

export function ProjectDiffList({ diff, project, onJump }: {
  diff: ProjectDiff;
  project?: Project;
  onJump?: (jump: ItemJump) => void;
}) {
  const groups = groupDiff(diff);
  if (!groups.length) return null;
  return <div data-diff-list="">
    {groups.map((group) => <Fold key={group.kind} className="project-diff-kind" summary={`${group.label} ${group.rows.length}`}>
      <ul className="project-diff-list">
        {group.rows.map((row) => {
          const jump = project && onJump ? diffJump(project, row) : null;
          return <li key={`${row.change}:${row.kind}:${row.id}:${row.field}`} className="project-diff-row" data-diff-change={row.change} data-diff-kind={row.kind} data-diff-id={row.id} data-diff-field={row.field}>
            <span className="project-diff-tag">{CHANGE_WORD[row.change]}</span>
            <span>{row.name}</span>
            {row.change === 'changed' && (row.orderText
              ? <span className="project-diff-values" data-diff-order="">{row.field} <span data-diff-after="">{row.orderText}</span></span>
              : <span className="project-diff-values">{row.field} <span data-diff-before="">{row.before}</span> → <span data-diff-after="">{row.after}</span></span>)}
            {jump && onJump && <button type="button" className="small" aria-label={`${row.name} 이동`} onClick={() => onJump(jump)}>이동</button>}
          </li>;
        })}
      </ul>
    </Fold>)}
  </div>;
}

export function ProjectDiffPanel({ project, savedRevision, kv, onJump }: {
  project: Project;
  savedRevision: number | null;
  kv: KV | null;
  onJump: (jump: ItemJump) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pick, setPick] = useState<{ kind: 'saved' } | { kind: 'project'; id: string; name: string; project: Project } | { kind: 'file'; name: string; project: Project }>({ kind: 'saved' });
  const [error, setError] = useState<string | null>(null);
  const [forId, setForId] = useState(project.id);
  if (forId !== project.id) {
    setForId(project.id);
    setPick({ kind: 'saved' });
    setError(null);
  }

  const saved = useMemo(() => {
    if (pick.kind !== 'saved') return null;
    if (savedRevision === null) return 'missing' as const;
    if (savedRevision === project.revision) return project;
    if (!kv) return 'unreadable' as const;
    const loaded = loadProject(kv, project.id);
    return loaded.ok ? loaded.project : 'unreadable' as const;
  }, [pick.kind, savedRevision, project, kv]);

  const others = useMemo(() => (kv ? readIndex(kv).filter((e) => e.id !== project.id) : []), [kv, project.id, savedRevision]);

  const diff = useMemo(() => {
    if (pick.kind === 'saved') {
      if (saved === 'missing' || saved === 'unreadable' || saved == null) return null;
      if (saved === project) return EMPTY_PROJECT_DIFF;
      return diffProjects(storedShape(saved), storedShape(project));
    }
    return diffProjects(storedShape(pick.project), storedShape(project));
  }, [pick, saved, project]);

  const lead = pick.kind === 'file'
    ? `파일 ${pick.name}과 지금. 읽기 전용입니다.`
    : pick.kind === 'project'
      ? `프로젝트 「${pick.name}」과 지금. 읽기 전용입니다.`
      : '저장본과 지금. 비교는 모델을 바꾸지 않습니다.';

  const chooseOther = (id: string) => {
    if (!id) { setPick({ kind: 'saved' }); setError(null); return; }
    if (!kv) { setError('저장소를 쓸 수 없습니다'); return; }
    const loaded = loadProject(kv, id);
    if (!loaded.ok) { setError(loaded.errors[0]?.message ?? UNREADABLE); return; }
    const name = others.find((e) => e.id === id)?.name ?? loaded.project.name;
    setError(null);
    setPick({ kind: 'project', id, name, project: loaded.project });
  };

  const chooseFile = async (file: File) => {
    let text = '';
    try { text = await readTextFile(file); } catch { setError('파일을 읽지 못했습니다'); return; }
    const parsed = parseProjectFile(text);
    if (!parsed.ok) { setError(parsed.errors[0]?.message ?? '파일을 열 수 없습니다'); return; }
    setError(null);
    setPick({ kind: 'file', name: file.name, project: parsed.project });
  };

  const total = diff ? diff.added + diff.removed + diff.changed : 0;
  const sameSaved = pick.kind === 'saved' && diff?.rows.length === 0;
  return <section className="sheet project-diff" data-project-diff="" data-diff-mode={pick.kind} data-diff-count={total}>
    <h2>바뀐 것{total ? ` ${total}` : ''}</h2>
    <p className="project-diff-lead">{lead}</p>
    <div className="project-diff-tools">
      <button type="button" data-diff-saved="" onClick={() => { setPick({ kind: 'saved' }); setError(null); }}>저장본</button>
      <label>다른 프로젝트
        <select data-diff-project="" value={pick.kind === 'project' ? pick.id : ''} onChange={(e) => chooseOther(e.target.value)}>
          <option value="">선택</option>
          {others.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </label>
      <button type="button" data-diff-file-open="" onClick={() => fileRef.current?.click()}>JSON 파일</button>
      <input ref={fileRef} className="project-diff-file" type="file" accept=".json,application/json" data-diff-file="" onChange={(e) => { const f = e.target.files?.[0]; if (f) void chooseFile(f); e.target.value = ''; }} />
    </div>
    {error && <p className="project-diff-error" data-diff-error="">{error}</p>}
    {pick.kind === 'saved' && saved === 'missing' && <p className="project-diff-same" data-diff-none="">{NO_SAVED}</p>}
    {pick.kind === 'saved' && saved === 'unreadable' && <p className="project-diff-error" data-diff-error="">{UNREADABLE}</p>}
    {diff && diff.rows.length > 0 && <p className="project-diff-summary" data-diff-summary="">{diffSummaryText(diff)}</p>}
    {sameSaved && <p className="project-diff-same" data-diff-same="">{SAME_AS_SAVED}</p>}
    {diff && diff.rows.length === 0 && !sameSaved && pick.kind !== 'saved' && <p className="project-diff-same" data-diff-same="">{SAME_OTHER}</p>}
    {diff && <ProjectDiffList diff={diff} project={project} onJump={onJump} />}
  </section>;
}

/** Recovery window. Shows the draft against the saved copy and does not open it. */
export function DraftDiffToggle({ kv, draftId, hasSaved }: { kv: KV | null; draftId: string; hasSaved: boolean }) {
  const [open, setOpen] = useState(false);
  const result = useMemo((): { error: string } | { diff: ProjectDiff } | null => {
    if (!open) return null;
    if (!kv) return { error: '저장소를 쓸 수 없습니다' };
    if (!hasSaved) return { error: NO_SAVED };
    const draft = loadDraft(kv, draftId);
    if (!draft.ok) return { error: '임시 저장을 읽지 못했습니다' };
    const base = loadProject(kv, draftId);
    if (!base.ok) return { error: UNREADABLE };
    return { diff: diffProjects(storedShape(base.project), storedShape(draft.project)) };
  }, [open, kv, draftId, hasSaved]);
  return <div className="project-diff-draft" data-draft-diff="">
    <button type="button" onClick={() => setOpen((v) => !v)}>차이 보기</button>
    {result && 'error' in result && <p className="project-diff-error" data-diff-error="">{result.error}</p>}
    {result && 'diff' in result && result.diff.rows.length === 0 && <p className="project-diff-same" data-diff-same="">{SAME_AS_SAVED}</p>}
    {result && 'diff' in result && result.diff.rows.length > 0 && <>
      <p className="project-diff-lead">앞은 저장본, 뒤는 임시 저장입니다.</p>
      <p className="project-diff-summary" data-diff-summary="">{diffSummaryText(result.diff)}</p>
      <div className="project-diff-scroll"><ProjectDiffList diff={result.diff} /></div>
    </>}
  </div>;
}
