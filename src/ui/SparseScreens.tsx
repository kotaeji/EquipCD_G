// Design-shaped centers. Values come from the live project. Unimplemented screens stay disabled and do not invent example rows.
import { useMemo, useRef, useState } from 'react';
import { ASSET_LIBRARY, LOADED_LIBRARIES } from '../assets/library';
import { NotReadyBanner } from './NotReadyBanner';
import './sparse-extra.css';
import { AURORA_EXPORT_DRAFT_NOTICE, auroraExportFileName, buildAuroraExport, collectExportFlags, compareAuroraExport, parseAuroraExport, serializeAuroraExport, type ExportChange, type RoundTripReport } from '../model/auroraExport';
import { buildExportPreview } from '../model/exportPreview';
import type { Gap } from '../model/gaps';
import type { Project } from '../model/types';
import { checkRunReadiness, validateProject, type Diagnostic } from '../model/validate';
import type { QuarantineEntry } from '../storage/localStore';
import { xsdStatus, AmlLoadStatus } from './Library';
import { Fold } from './Fold';
import { type BlockerGuide } from './blockerTarget';
import { EmptyState } from './EmptyState';
import { BlockerCards, BlockerList, Problem } from './Problem';
import { EMPTY, SCREEN, exportBlockedProblem } from './problemCopy';
import { checkConditions, type ConditionFinding } from '../model/conditionCheck';
import { devName, sigName, unitName } from './labels';
import { StatusMark } from './StatusMark';

export function AmlResultSheet({ onCandidates }: { onCandidates: () => void }) {
  const lib = LOADED_LIBRARIES[0];
  const errors = lib?.result.diags.filter((d) => d.severity === 'error').length ?? 0;
  const warnings = lib?.result.diags.filter((d) => d.severity === 'warning').length ?? 0;
  const sample = ASSET_LIBRARY.find((d) => d.amlSource.origin === 'bundled');
  const xsd = sample ? xsdStatus(sample) : { kind: 'warn' as const, text: '검사할 번들 정의가 없습니다' };
  const rows: [string, string, string][] = [
    ['XML 문법', lib ? '읽음' : '파일 없음', lib ? lib.file : '로드된 라이브러리 없음'],
    ['CAEX 구조', lib?.result.meta.schemaVersion ? `스키마 ${lib.result.meta.schemaVersion}` : '확인 안 됨', lib?.result.meta.superiorStandard.join(', ') || '표준 표기 없음'],
    ['앱 부분집합', errors ? `오류 ${errors}` : `경고 ${warnings}`, '지원 범위 밖 속성은 보존만 합니다'],
    ['공식 XSD', xsd.kind === 'ok' ? '구조 검사 기록 있음' : '미실시 또는 불일치', '건너뛴 검사를 통과로 세지 않습니다'],
  ];
  return <section className="sheet wide">
    <h2>AML 검사 결과 · 검사 수준을 합치지 않습니다</h2>
    <p className="field-ro">{lib ? lib.file : '대상 파일 없음'}</p>
    <table className="grid plain"><thead><tr><th>검사 수준</th><th>상태</th><th>근거</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody></table>
    <div className="tool-pills">
      <button type="button" onClick={onCandidates}>후보 확인으로 이동</button>
      <button type="button" disabled title="대기 중인 AML 가져오기가 없습니다">AML 취소</button>
    </div>
    <p className="warn-note">원본은 격리 보관합니다. 검사 실패를 빈 목록이나 성공으로 바꾸지 않습니다.</p>
    <Fold className="fold-panel" summary={<><span className="fold-closed">검사 상세 보기</span><span className="fold-open">검사 상세</span></>}><AmlLoadStatus libVersion={LOADED_LIBRARIES.length} /></Fold>
  </section>;
}

export function ExtractSheet({ onInstead }: { onInstead?: () => void } = {}) {
  return <div className="sparse-stack">
    <NotReadyBanner hint="입력 후보표의 직접 입력과 AML 라이브러리를 쓰세요" purpose={SCREEN.extract.purpose} instead={SCREEN.extract.instead} onInstead={onInstead} />
    <div className="sparse-split">
    <section className="sheet">
      <h2>자료 접수 · 후속 설계</h2>
      <table className="grid plain"><thead><tr><th>형식</th><th>지원 상태</th></tr></thead><tbody>
        {['PDF', 'DWG', 'XLSX', 'USD'].map((f) => <tr key={f}><td>{f}</td><td>추출 미구현</td></tr>)}
      </tbody></table>
      <button type="button" disabled title="문서에서 장비나 수치를 뽑지 않습니다">자료 선택 예시</button>
      <p className="warn-note">업로드와 외부 전송은 하지 않습니다. 예시 표를 추출 성공으로 보여 주지 않습니다.</p>
    </section>
    <aside className="sheet">
      <h2>원문 대조와 후보</h2>
      <label>원문 위치<input disabled placeholder="추출기가 없습니다" /></label>
      <label>후보와 근거<input disabled placeholder="후보를 만들지 않습니다" /></label>
      <button type="button" disabled>후보표 검토</button>
      <button type="button" disabled>자료 제거 확인</button>
      <p className="muted">지금 넣을 수 있는 것은 입력 후보표의 직접 입력과 AML 라이브러리 파일입니다.</p>
    </aside>
    </div>
  </div>;
}

export function BundleSheet({ wsName, projectCount, assetCount, assumptionCount, onInstead }: { wsName: string; projectCount: number; assetCount: number; assumptionCount: number; onInstead?: () => void }) {
  return <div className="sparse-page">
    <NotReadyBanner hint="프로젝트별 JSON 내보내기를 쓰세요" purpose={SCREEN.bundle.purpose} instead={SCREEN.bundle.instead} onInstead={onInstead} />
    <h1 className="stage-title">Workspace 파일 묶음</h1>
    <p className="muted">묶음 가져오기와 내보내기는 미구현입니다. 아래 수는 이 브라우저의 현재 Workspace이며, 묶음 파일 내용이 아닙니다.</p>
    <div className="sparse-split">
      <section className="sheet">
        <h2>묶음 구성</h2>
        <p className="field-ro">{wsName}</p>
        <table className="grid plain"><thead><tr><th>포함 항목</th><th>수</th><th>선택</th></tr></thead><tbody>
          <tr><td>프로젝트</td><td>{projectCount}</td><td>포함 예정 · 파일 없음</td></tr>
          <tr><td>공통 에셋 정의</td><td>{assetCount}</td><td>포함 예정 · 파일 없음</td></tr>
          <tr><td>출처와 가정</td><td>{assumptionCount}</td><td>포함 예정 · 파일 없음</td></tr>
        </tbody></table>
        <button type="button" disabled title="묶음 파일을 검사하지 않습니다">묶음 검사</button>
      </section>
      <aside className="sheet">
        <h2>가져오기 충돌 정책</h2>
        <p>같은 ID, 다른 Workspace로 이동, 원본 삭제는 동작하지 않습니다.</p>
        <button type="button" disabled>묶음 가져오기 미리보기</button>
        <button type="button" disabled>묶음 내보내기</button>
        <p className="warn-note">미구현입니다. 파일 생성과 공유를 하지 않습니다.</p>
      </aside>
    </div>
  </div>;
}

export function FilesSheet({ entries, onImport, onExport, onOpen, onNew, onSample }: { entries: { id: string; name: string; revision: number }[]; onImport: () => void; onExport: () => void; onOpen: (id: string) => void; onNew?: () => void; onSample?: () => void }) {
  return <div className="sparse-page">
    <h1 className="stage-title">프로젝트 파일</h1>
    <p className="muted">JSON 가져오기는 원본을 덮어쓰지 않고 새 탭으로 엽니다. 거부된 원본은 격리합니다.</p>
    <section className="sheet wide">
      <h2>이 Workspace에 저장된 파일</h2>
      <table className="grid plain"><thead><tr><th>이름</th><th>rev</th><th></th></tr></thead>
        <tbody>{entries.map((e) => <tr key={e.id}><td>{e.name}</td><td>{e.revision}</td><td><button type="button" onClick={() => onOpen(e.id)}>열기</button></td></tr>)}
          {entries.length === 0 && <tr><td colSpan={3}><EmptyState symbol="○" line={EMPTY.projects} actions={[
            { label: '새 프로젝트', onClick: onNew },
            { label: '예제', onClick: onSample },
          ]} /></td></tr>}</tbody></table>
      <div className="tool-pills">
        <button type="button" className="on" onClick={onImport}>JSON 가져오기</button>
        <button type="button" onClick={onExport}>현재 탭 JSON 내보내기</button>
      </div>
      <p className="muted">옛 형식과 깨진 JSON은 열지 않습니다. 실패를 빈 프로젝트로 바꾸지 않습니다.</p>
    </section>
  </div>;
}

type SearchNode = { id: string; label: string; depth: number };

/** Name match is case-insensitive and ignores surrounding spaces. Ancestors stay as context; children of a hit do not. */
function filterSearchTree(tree: SearchNode[], raw: string): { active: boolean; nodes: SearchNode[]; count: number } {
  const query = raw.trim().toLowerCase();
  if (!query) return { active: false, nodes: tree, count: 0 };
  const keep = new Set<number>();
  const stack: number[] = [];
  let count = 0;
  tree.forEach((n, i) => {
    while (stack.length > 0 && tree[stack[stack.length - 1]].depth >= n.depth) stack.pop();
    if (n.label.toLowerCase().includes(query)) {
      count += 1;
      keep.add(i);
      for (const a of stack) keep.add(a);
    }
    stack.push(i);
  });
  return { active: true, nodes: tree.filter((_, i) => keep.has(i)), count };
}

export function SearchSheet({ tabs, tree, onTab, onPick, onFold, onCanvas }: {
  tabs: { key: string; name: string; active: boolean }[];
  tree: { id: string; label: string; depth: number }[];
  onTab: (key: string) => void; onPick: (id: string) => void; onFold: () => void; onCanvas: () => void;
}) {
  const [query, setQuery] = useState('');
  const found = filterSearchTree(tree, query);
  return <div className="sparse-page">
    <h1 className="stage-title">공통 탐색</h1>
    <p className="muted">열린 탭과 현재 프로젝트의 트리입니다. 접기는 모델과 선택을 바꾸지 않습니다.</p>
    <div className="sparse-split">
      <section className="sheet">
        <h2>여러 프로젝트와 접기 트리</h2>
        <div className="tool-pills">{tabs.map((t) => <button key={t.key} type="button" className={t.active ? 'on' : ''} onClick={() => onTab(t.key)}>{t.name}</button>)}</div>
        <label className="search-find">이름으로 찾기
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {found.active && <p className="search-count">{found.count}개 찾음</p>}
        {found.active && found.count === 0 && <EmptyState symbol="?" line={EMPTY.search} actions={[{ label: '지우기', onClick: () => setQuery('') }]} />}
        <div className="tree-list">{found.nodes.map((n) => <button key={n.id} type="button" className="tree-link" style={{ paddingLeft: 12 + n.depth * 16 }} onClick={() => onPick(n.id)}>{n.label}</button>)}</div>
        <div className="tool-pills"><button type="button" onClick={onFold}>트리 접힘 예시</button></div>
      </section>
      <aside className="sheet">
        <h2>선택과 키보드 규칙</h2>
        <table className="grid plain"><thead><tr><th>행동</th><th>모델 영향</th></tr></thead><tbody>
          <tr><td>트리 접기</td><td>없음 · 선택 유지</td></tr>
          <tr><td>탭 전환</td><td>각 프로젝트 문맥 유지</td></tr>
          <tr><td>선택 이동</td><td>편집 대상만 변경</td></tr>
          <tr><td>삭제 키</td><td>확인 후 별도 처리</td></tr>
        </tbody></table>
        <button type="button" onClick={onCanvas}>장비 편집 복귀</button>
      </aside>
    </div>
  </div>;
}

export function LabSheet({ revision, onInstead }: { revision: number; onInstead?: () => void }) {
  return <div className="sparse-stack">
    <NotReadyBanner hint="Gap 목록의 가정 시간 합계를 쓰세요" purpose={SCREEN.lab.purpose} instead={SCREEN.lab.instead} onInstead={onInstead} />
    <div className="sparse-split">
    <section className="sheet">
      <h2>F7 변형 범위와 안전 한도</h2>
      <label>원본 기준<input disabled value={`현재 모델 rev ${revision} · 변형하지 않음`} readOnly /></label>
      <label>변형 허용 범위<input disabled value="미구현" readOnly /></label>
      <label>평가 방식과 상한<input disabled value="미구현" readOnly /></label>
      <p className="warn-note">외부 전송, 예산, 자동 결제는 없습니다. 실제 탐색을 실행하지 않습니다.</p>
      <button type="button" disabled title="평가 방법과 예산이 정해지지 않았습니다">변형 차이 검토 예시</button>
    </section>
    <aside className="sheet">
      <h2>세대와 후보</h2>
      <table className="grid plain"><thead><tr><th>후보</th><th>평가</th><th>선택</th></tr></thead>
        <tbody><tr><td colSpan={3}>후보 없음. 예시 점수를 만들지 않습니다.</td></tr></tbody></table>
      <button type="button" disabled>선택 후보 명시 적용</button>
      <button type="button" disabled>원본 유지 취소</button>
    </aside>
    </div>
  </div>;
}

export function ExtendSheet() {
  return <div className="sparse-stack">
    <NotReadyBanner hint="Station 단계 시간은 4단계 Station 시퀀스에서 편집하세요" />
    <div className="sparse-split">
    <section className="sheet">
      <h2>후속 단계 편집 · 미구현</h2>
      <label>Substation 단계<input disabled value="편집기 없음" readOnly /></label>
      <label>진입 조건<input disabled value="편집기 없음" readOnly /></label>
      <label>단계 시간 덮어쓰기<input disabled value="편집기 없음" readOnly /></label>
      <p className="muted">정의의 값과 단계별 덮어쓰기 출처를 분리할 화면이 없습니다. Station 단계 시간은 4단계 Station 시퀀스에서 편집합니다.</p>
      <button type="button" disabled title="분기·루프·병렬 편집기가 없습니다">편집 반영 미리보기</button>
    </section>
    <aside className="sheet">
      <h2>다중 자재 확장 · 미구현</h2>
      <table className="grid plain"><thead><tr><th>자재</th><th>캐리어</th><th>초기 위치</th></tr></thead>
        <tbody><tr><td colSpan={3}>추가 자재 없음. 실행은 자재 하나만 지원합니다.</td></tr></tbody></table>
      <p className="warn-note">다중 자재, 캐리어, 버퍼, 자재 삭제는 후속입니다.</p>
      <button type="button" className="danger" disabled>자재 삭제 확인</button>
      <button type="button" disabled>현행 자재 화면</button>
    </aside>
    </div>
  </div>;
}

const CHANGE_LABEL: Record<ExportChange, string> = { added: '추가', removed: '삭제', changed: '변경' };

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('read'));
    reader.readAsText(file);
  });
}

function ExportReport({ report }: { report: RoundTripReport }) {
  const diffs = [...report.missing, ...report.removed, ...report.changed];
  return <div>
    <p data-roundtrip-summary>빠진 것 {report.missing.length} · 다른 것 {report.changed.length}</p>
    <p className="muted">삭제 {report.removed.length}. 빠진 것은 모델에만 있고, 삭제는 파일에만 있습니다. 모델을 바꾸지 않습니다.</p>
    <table className="grid plain"><thead><tr><th>종류</th><th>모델</th><th>파일</th></tr></thead>
      <tbody>{report.counts.map((c) => <tr key={c.kind} data-count-kind={c.kind}><td>{c.label}</td><td>{c.model}</td><td>{c.file}</td></tr>)}</tbody></table>
    {diffs.length > 0 && <table className="grid export-diff"><thead><tr><th>차이</th><th>종류</th><th>ID</th><th>이름</th><th>항목</th><th>파일 값</th><th>모델 값</th></tr></thead>
      <tbody>{diffs.map((d, i) => <tr key={`${d.change}:${d.kind}:${d.id}:${d.field}:${i}`} data-diff={d.change} data-diff-kind={d.kind} data-diff-id={d.id} data-diff-field={d.field}>
        <td>{CHANGE_LABEL[d.change]}</td><td>{d.kindLabel}</td><td className="mono">{d.id}</td><td>{d.name}</td><td>{d.field || '—'}</td><td>{d.fileValue || '—'}</td><td>{d.modelValue || '—'}</td>
      </tr>)}</tbody></table>}
  </div>;
}

export function ExportSheet({ p, onDownload, onGuide }: {
  p: Project;
  onDownload: (name: string, text: string) => void;
  onGuide: (b: Diagnostic, g: BlockerGuide) => void;
}) {
  const rows = buildExportPreview(p);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const doc = useMemo(() => buildAuroraExport(p), [p]);
  const flags = useMemo(() => collectExportFlags(doc), [doc]);
  const ready = useMemo(() => checkRunReadiness(p), [p]);
  const flagSig = `${ready.ok}:${flags.undetermined.length}:${flags.assumption.length}`;
  const [ackFor, setAckFor] = useState<string | null>(null);
  const [createdText, setCreatedText] = useState<string | null>(null);
  const [inspect, setInspect] = useState<RoundTripReport | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const needsAck = flags.undetermined.length + flags.assumption.length > 0;
  const acked = ackFor === flagSig;
  const createDisabled = !ready.ok || (needsAck && !acked);
  const createdFile = useMemo(() => {
    if (!createdText) return null;
    const parsed = parseAuroraExport(createdText);
    return parsed.ok ? parsed.file : null;
  }, [createdText]);
  const createdReport = useMemo(() => (createdFile ? compareAuroraExport(doc, createdFile) : null), [createdFile, doc]);

  const createFile = () => {
    if (createDisabled) return;
    const text = serializeAuroraExport(doc);
    onDownload(auroraExportFileName(p.name), text);
    setCreatedText(text);
  };
  const inspectFile = async (file: File) => {
    let text = '';
    try { text = await readTextFile(file); } catch { setInspect(null); setInspectError('파일을 읽지 못했습니다'); return; }
    const parsed = parseAuroraExport(text);
    if (!parsed.ok) { setInspect(null); setInspectError(parsed.reason); return; }
    setInspectError(null);
    setInspect(compareAuroraExport(doc, parsed.file));
  };

  return <div className="sparse-split">
    <section className="sheet" data-model-rev={p.revision}>
      <h2>초안 형식 파일</h2>
      <p className="notice warn" data-export-draft>{AURORA_EXPORT_DRAFT_NOTICE}</p>
      {!ready.ok && <div data-export-blocked>
        <Problem copy={exportBlockedProblem(ready.blockers.length)} />
        <BlockerCards p={p} blockers={ready.blockers} onGuide={onGuide} />
      </div>}
      {ready.ok && needsAck && <div data-export-flags data-export-undetermined={flags.undetermined.length} data-export-assumption={flags.assumption.length}>
        <p><StatusMark status="undetermined" /> {flags.undetermined.length} · <StatusMark status="assumption" /> {flags.assumption.length}. 값은 파일에 그대로 적히고, 미정은 null 입니다.</p>
        <ul className="export-flags">
          {flags.undetermined.map((f) => <li key={`u:${f.place}:${f.id}:${f.label}`} data-flag="undetermined"><StatusMark status="undetermined" /> {f.label}</li>)}
          {flags.assumption.map((f) => <li key={`a:${f.place}:${f.id}:${f.label}`} data-flag="assumption"><StatusMark status="assumption" /> {f.label}</li>)}
        </ul>
        <label className="export-ack">
          <input type="checkbox" checked={acked} onChange={(e) => setAckFor(e.target.checked ? flagSig : null)} />
          <span>미정 {flags.undetermined.length} · 가정 {flags.assumption.length} 을 표시한 채 내보내기</span>
        </label>
      </div>}
      {ready.ok && !needsAck && <p>미정 0 · 가정 0. 확인 없이 파일을 만들 수 있습니다.</p>}
      <div className="export-actions">
        <button type="button" className="btn-main primary" data-export-create disabled={createDisabled} onClick={createFile}>Export 파일 만들기</button>
        <button type="button" onClick={() => fileRef.current?.click()}>Export 파일 검사</button>
        <input ref={fileRef} type="file" accept=".json,application/json" data-export-inspect style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void inspectFile(f); e.target.value = ''; }} />
      </div>
      {createdReport && <div data-export-created>
        <h2>만든 파일과 지금 모델</h2>
        <p className="muted">{auroraExportFileName(p.name)} · 파일 rev {createdFile?.revision ?? ''} · 모델 rev {p.revision}</p>
        <ExportReport report={createdReport} />
      </div>}
      {inspectError && <p className="warn-note" data-export-error>{inspectError}</p>}
      {inspect && <div data-export-inspect-result>
        <h2>고른 파일과 지금 모델</h2>
        <ExportReport report={inspect} />
      </div>}
      <h2>현재 · 읽기 전용 미리보기</h2>
      <table className="grid plain"><thead><tr><th>내보낼 의미</th><th>상태</th></tr></thead>
        <tbody>{[...counts.entries()].map(([k, n]) => <tr key={k}><td>{k}</td><td>{n}행 · 전송 아님</td></tr>)}</tbody></table>
      <p className="warn-note">실제 Core 전송과 실행 가능한 패키지 생성은 미구현입니다.</p>
      <button type="button" disabled title="Core 주소와 스키마가 확정되지 않았습니다">Core 전송</button>
    </section>
    <aside className="sheet">
      <h2>F8 왕복 계약 · 미구현</h2>
      <label>대상 계약<input disabled value="Core 스키마 미확정" readOnly /></label>
      <label>왕복 매핑<input disabled value="설계 ID와 실제 주소는 연결하지 않음" readOnly /></label>
      <button type="button" disabled>왕복 차이 검토 예시</button>
      <button type="button" disabled>전송 취소</button>
      <p className="muted">이 화면의 전송은 실제 데이터 교환이 아닙니다.</p>
    </aside>
  </div>;
}

const COND_WORD = { error: '오류', undetermined: '미정', info: '안내' } as const;

export function DiagSheet({ p, storageReason, quarantineList, onDownload, onAml, onJumpCondition }: {
  p: Project; storageReason: string | null; quarantineList: QuarantineEntry[]; onDownload: (name: string, text: string) => void; onAml: () => void;
  onJumpCondition: (f: ConditionFinding) => void;
}) {
  const diags = validateProject(p);
  const conditions = checkConditions(p);
  return <div className="sparse-split">
    <section className="sheet">
      <h2>조건</h2>
      <table className="grid plain cond-table" aria-label="조건">
        <thead><tr><th>수준</th><th>어디</th><th>식</th><th>까닭</th><th></th></tr></thead>
        <tbody>
          {conditions.map((f) => <tr key={f.id} data-cond-finding={f.kind} data-cond-level={f.level}>
            <td><StatusMark status={f.level === 'error' ? 'error' : f.level === 'undetermined' ? 'undetermined' : 'assumption'} word={COND_WORD[f.level]} /></td>
            <td>{f.where}</td>
            <td className="cond-formula" data-cond-formula="">{f.formula}</td>
            <td>{f.reason}</td>
            <td><button type="button" className="small" onClick={() => onJumpCondition(f)}>이동</button></td>
          </tr>)}
          {conditions.length === 0 && <tr><td colSpan={5}>조건 오류 없음</td></tr>}
        </tbody>
      </table>
      <h2>진단 내역</h2>
      <table className="grid plain"><thead><tr><th>진단</th><th>상태</th><th>수정 위치</th></tr></thead>
        <tbody>{diags.slice(0, 8).map((d) => <tr key={d.id}><td>{d.message}</td><td>{d.severity === 'error' ? '차단' : '경고'}</td><td>{d.objectId}</td></tr>)}
          {diags.length === 0 && <tr><td>참조 오류 없음</td><td>정보</td><td>현재 모델</td></tr>}</tbody></table>
      <button type="button" className="btn-main primary" onClick={onAml}>AML 검사 결과</button>
    </section>
    <aside className="sheet">
      <h2>저장과 거부 원본</h2>
      <label>마지막 저장 결과<input disabled value={storageReason ? `저장소 사용 불가 · ${storageReason}` : '이 브라우저 저장소 사용 가능'} readOnly /></label>
      <p className="muted">거부한 입력은 모델과 격리합니다. 원본 다운로드는 실패를 성공으로 표시하지 않습니다.</p>
      {quarantineList.length === 0 && <p>격리 보관함 비어 있음</p>}
      {quarantineList.map((q, i) => <button key={i} type="button" onClick={() => onDownload(`quarantine-${i}-${q.label}`, q.raw)}>거부 원본 보관 {q.label}</button>)}
    </aside>
  </div>;
}

export function BlockerSheet({ p, title, timeLabel, blockers, onGuide, onRecheck }: {
  p: Project; title: string; timeLabel: string; blockers: Diagnostic[]; onGuide: (b: Diagnostic, g: BlockerGuide) => void; onRecheck: () => void;
}) {
  return <section className="sheet wide">
    <h2>{title}</h2>
    <p className="warn-note">실행 전 검사 · 차단 {blockers.length}건 · 가상 시간 {timeLabel}</p>
    <BlockerList p={p} blockers={blockers} onGuide={onGuide} />
    <button type="button" onClick={onRecheck}>다시 검사</button>
  </section>;
}

export function gapVisible(g: Gap, filter: 'all' | 'shortfall' | 'human' | 'hidden', hidden: boolean): boolean {
  if (filter === 'hidden') return hidden;
  if (hidden) return false;
  if (filter === 'shortfall') return g.judgement === 'shortfall';
  if (filter === 'human') return g.safety || g.judgement === 'candidate';
  return true;
}

export function materialSize(p: Project): string {
  const m = p.materials[0];
  if (!m) return '자재 없음';
  const n = (q: { value: number | null; unit: string; assumption: boolean }) => `${q.value ?? '미정'}${q.unit}${q.assumption ? ' · 가정' : ''}`;
  return `${n(m.size.w)} × ${n(m.size.l)} × ${n(m.size.h)}`;
}

export function routeText(p: Project): string {
  const m = p.materials[0];
  if (!m || m.route.length === 0) return '경로 미정';
  return m.route.map((id) => unitName(p, id)).join(' → ');
}

export function signalRole(role: string): string {
  return { command: '명령', complete: '완료', sensor: '센서', result: '결과' }[role] ?? role;
}

export function deviceCaption(p: Project, id: string): string {
  return devName(p, id);
}

export function signalCaption(p: Project, id: string | null): string {
  return id ? sigName(p, id) : '미정';
}
