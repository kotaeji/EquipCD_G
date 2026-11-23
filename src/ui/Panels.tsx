import { useState } from 'react';
import { ASSET_LIBRARY, exportLibraryAml } from '../assets/library';
import { AmlLoadStatus } from './Library';
import { applyCandidates, newCandidate, planCandidateApply } from '../model/candidates';
import * as C from '../model/commands';
import { buildExportPreview } from '../model/exportPreview';
import { GAP_KIND_LABEL, type Gap, type GapKind } from '../model/gaps';
import { parseStructuredSequence, type ParsedLine } from '../model/structuredText';
import { feedCountOf, type AssetKind, type Project } from '../model/types';
import { flowUsesSignal, hasFlow } from '../model/flow';
import { checkRunReadiness, validateProject, type Diagnostic } from '../model/validate';
import type { RuntimeState } from '../runtime/engine';
import { aggregateStepStatus, type AggregateStepStatus } from '../runtime/runSummary';
import type { QuarantineEntry } from '../storage/localStore';
import { type BlockerGuide } from './blockerTarget';
import { BlockerList } from './Problem';
import { EmptyState } from './EmptyState';
import { EMPTY, RUN_LOCK } from './problemCopy';
import type { ConfirmDelete, EditFn } from './Inspector';
import { stepDeleteDetail, stepUsage } from '../model/deleteImpact';
import { conditionsFormula } from '../model/conditionFormula';
import { Terms } from './Term';
import { devName, effectLabel, runStatusLabel, sigName, unitName } from './labels';
import { RunSummary } from './RunSummary';
import { SfcView } from './SfcView';
import { StatusMark } from './StatusMark';
import { exportStatusMark, gapJudgementMark, phaseShape } from './status';
import { Badge, QtyInput, TextInput } from './widgets';

const fmt = (msv: number) => `${String(Math.floor(msv / 60000)).padStart(2, '0')}:${(Math.floor(msv / 1000) % 60).toString().padStart(2, '0')}.${(msv % 1000).toString().padStart(3, '0')}`;

/** True when a branch or retry condition reads this read-action's result signal. */
function readResultUsed(p: Project, deviceId: string): boolean {
  const sig = p.signals.find((s) => s.deviceId === deviceId && s.role === 'result');
  return !!sig && hasFlow(p) && flowUsesSignal(p.sequence.flow ?? [], sig.id);
}
export { fmt as fmtTime };

function sequenceStatus(view: AggregateStepStatus) {
  const shape = phaseShape(view.phase);
  return <StatusMark status={shape.status} word={view.label} />;
}

// ---------------- F5 Sequence ----------------
export function SequencePanel({ p, rt, locked, edit, onSelect, confirmDelete }: { p: Project; rt: RuntimeState | null; locked: boolean; edit: EditFn; onSelect: (id: string) => void; confirmDelete?: ConfirmDelete }) {
  const [unitFilter, setUnitFilter] = useState('');
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedLine[] | null>(null);
  const [choice, setChoice] = useState<Record<number, string>>({});
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const acts = p.actions.filter((a) => !unitFilter || a.unitId === unitFilter);
  const dropAt = (e: React.DragEvent, index: number) => {
    e.preventDefault(); e.stopPropagation();
    const actId = e.dataTransfer.getData('application/x-ecd-action');
    if (actId) { edit(C.addStep(p, actId, index, 'dnd'), 'DnD 단계 추가'); return; }
    if (dragIdx !== null) { const to = Math.min(index > dragIdx ? index - 1 : index, p.sequence.steps.length - 1); if (to !== dragIdx) edit(C.moveStep(p, dragIdx, to), '단계 순서 변경'); setDragIdx(null); }
  };
  const addParsed = () => {
    if (!parsed) return;
    let cur = p; let n = 0;
    for (let i = 0; i < parsed.length; i++) {
      const l = parsed[i]; const id = l.status === 'matched' ? l.actionId : choice[i];
      if (!id) continue;
      const r = C.addStep(cur, id, undefined, 'structured-text', l.line); if (r.ok) { cur = r.project; n++; }
    }
    const unresolved = parsed.filter((l, i) => l.status !== 'matched' && !choice[i]).map((l) => `${l.status === 'ambiguous' ? '모호' : '찾을 수 없음'}: "${l.line}"`);
    if (n || unresolved.length) {
      const next = structuredClone(cur); next.sequence.unresolved = [...next.sequence.unresolved, ...unresolved];
      if (edit({ ok: true, project: n ? next : { ...next, revision: next.revision + 1 } }, `구조화 문장 ${n}단계 추가`)) { setParsed(null); setChoice({}); }
    }
  };
  return (
    <div className="cols">
      <div style={{ width: 230, borderRight: '1px solid var(--border)', paddingRight: 8, overflow: 'auto' }}>
        <div className="row"><b style={{ fontSize: 'var(--fs-sm)' }}>제공 Action</b><select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} style={{ width: 110 }}><option value="">모든 Unit</option>{p.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>오른쪽 시퀀스로 드래그 (DnD)</div>
        {acts.map((a) => <div key={a.id} className="draggable-action" draggable={!locked} onDragStart={(e) => e.dataTransfer.setData('application/x-ecd-action', a.id)} title={a.id}>{a.name}</div>)}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => dropAt(e, p.sequence.steps.length)}>
        <table className="grid">
          <thead><tr><th>#</th><th>단계</th><th><Terms text="Unit / Device" /></th><th><Terms text="완료 조건" /></th><th><Terms text="타임아웃" /></th><th>자재 변화</th><th>출처</th><th>상태</th><th></th></tr></thead>
          <tbody>
            {p.sequence.steps.map((s, i) => {
              const a = p.actions.find((x) => x.id === s.actionId);
              const view = aggregateStepStatus(rt?.steps.filter((r) => r.stepId === s.id) ?? []);
              const st = view.phase;
              return (
                <tr key={s.id} className={st === 'active' ? 'active' : st === 'error' ? 'err' : ''} draggable={!locked}
                  onDragStart={(e) => { setDragIdx(i); e.dataTransfer.setData('text/plain', s.id); }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => dropAt(e, i)}>
                  <td className="mono">{String(i + 1).padStart(2, '0')}</td>
                  <td><span style={{ cursor: 'pointer' }} onClick={() => a && onSelect(a.deviceId)}>{s.name}</span><div className="muted mono" style={{ fontSize: 'var(--fs-xs)' }}>{s.id}</div></td>
                  <td style={{ fontSize: 'var(--fs-xs)' }}>{a ? `${unitName(p, a.unitId)} / ${devName(p, a.deviceId)}` : <Badge kind="err">Action 없음</Badge>}</td>
                  <td style={{ fontSize: 'var(--fs-xs)' }}>{a?.completeSignalId ? `${sigName(p, a.completeSignalId)} = true` : <StatusMark status="undetermined" />}{a && (a.pre.length > 0 || s.entry.length > 0) && <div className="muted" data-step-cond="">{conditionsFormula(p, [...a.pre, ...s.entry])}</div>}</td>
                  <td>{a && <QtyInput q={s.timeoutOverride ?? a.timeout} disabled={locked} title="이 단계의 타임아웃 (Action 기본값 덮어쓰기)" onCommit={(v, as) => edit(C.setQuantity(p, { kind: 'stepTimeout', id: s.id }, v, as), '단계 타임아웃')} />}</td>
                  <td style={{ fontSize: 'var(--fs-xs)' }}>{a ? effectLabel(p, a.effect) : ''}</td>
                  <td style={{ fontSize: 'var(--fs-xs)' }} className="muted">{s.origin}{s.sourceText ? `: "${s.sourceText}"` : ''}</td>
                  <td>{sequenceStatus(view)}</td>
                  <td className="danger-row">
                    <button type="button" className="small" disabled={locked || i === 0} onClick={() => edit(C.moveStep(p, i, i - 1), '단계 위로')}>↑</button>
                    <button type="button" className="small" disabled={locked || i === p.sequence.steps.length - 1} onClick={() => edit(C.moveStep(p, i, i + 1), '단계 아래로')}>↓</button>
                    {stepUsage(p, s.id) && <span className="danger-note" data-delete-impact>{stepUsage(p, s.id)}</span>}
                    <button type="button" className="small danger" disabled={locked} onClick={() => { const detail = stepDeleteDetail(p, s.id); const run = () => edit(C.removeStep(p, s.id), '단계 삭제'); if (detail && confirmDelete) confirmDelete(`${s.name} 삭제`, detail, run); else run(); }}>삭제</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="dropzone" style={{ marginTop: 4 }}>여기로 Action을 드래그하면 끝에 추가 · 행을 드래그해 단계 목록 순서를 바꿉니다. 실행 순서는 위의 Station 흐름을 따릅니다.</div>
        {p.sequence.unresolved.length > 0 && <div className="notice warn" data-jump="sequence-unresolved">미해결/모호 목록(보존): {p.sequence.unresolved.join(' · ')}</div>}
      </div>
      <div style={{ width: 270, borderLeft: '1px solid var(--border)', paddingLeft: 8, overflow: 'auto' }}>
        <b style={{ fontSize: 'var(--fs-sm)' }}>구조화 문장 입력 (결정적 변환 · AI 미사용)</b>
        <textarea rows={4} style={{ width: '100%' }} value={text} disabled={locked} placeholder={'한 줄에 한 단계\n예) S1 푸셔 투입\n    S2 바코드 읽기'} onChange={(e) => setText(e.target.value)} />
        <button disabled={locked || !text.trim()} onClick={() => { setParsed(parseStructuredSequence(p, text)); setChoice({}); }}>변환 미리보기</button>
        {parsed && <div style={{ marginTop: 6 }}>
          {parsed.map((l, i) => <div key={i} style={{ fontSize: 'var(--fs-xs)', borderBottom: '1px solid var(--border)', padding: '2px 0' }}>
            “{l.line}” → {l.status === 'matched' ? <Badge kind="ok">{p.actions.find((a) => a.id === l.actionId)?.name}</Badge> : l.status === 'ambiguous' ?
              <><Badge kind="warn">선택 필요</Badge><select value={choice[i] ?? ''} onChange={(e) => setChoice({ ...choice, [i]: e.target.value })} style={{ width: '100%' }}><option value="">(사람이 선택 — 자동 확정 안 함)</option>{l.candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></> : <Badge kind="err">찾을 수 없음</Badge>}
          </div>)}
          <button className="primary" style={{ marginTop: 4 }} onClick={addParsed}>확정된 줄만 시퀀스에 추가</button>
          <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>자연어 Dictation·의미 추론(3등급 AI)은 미구현.</div>
        </div>}
      </div>
    </div>
  );
}

// ---------------- Runtime status / log ----------------
/** Read-fail injection. Shared by the 2D runtime panel and the 3D conditions column. */
export function ReadFailFaults({ p, locked, edit }: { p: Project; locked: boolean; edit: EditFn }) {
  const faults = p.simSettings.faults;
  return <>
    {p.actions.filter((a) => a.kind === 'read').map((act) => {
      const on = faults.readFailActionIds.includes(act.id);
      const n = faults.readFailFirstN?.[act.id];
      return <div key={act.id}>
        <label className="row" style={{ fontSize: 'var(--fs-sm)' }}><input type="checkbox" disabled={locked} checked={on} onChange={(e) => {
          const ids = e.target.checked ? [...new Set([...faults.readFailActionIds, act.id])] : faults.readFailActionIds.filter((id) => id !== act.id);
          const map = { ...(faults.readFailFirstN ?? {}) };
          if (!e.target.checked) delete map[act.id];
          edit(C.setFaults(p, { ...faults, readFailActionIds: ids, readFailFirstN: Object.keys(map).length ? map : undefined }), '읽기 실패 주입');
        }} />{act.name}: 결과 실패</label>
        <label className="row" style={{ fontSize: 'var(--fs-sm)' }}>처음 N회만<input aria-label={`${act.name} 실패 횟수`} type="number" min={1} disabled={locked || !on} placeholder="비우면 항상" value={n ?? ''} style={{ width: 72 }}
          onChange={(e) => {
            const map = { ...(faults.readFailFirstN ?? {}) };
            const raw = e.target.value.trim();
            if (!raw) delete map[act.id];
            else map[act.id] = Math.max(1, Math.round(Number(raw)));
            edit(C.setFaults(p, { ...faults, readFailActionIds: on ? faults.readFailActionIds : [...new Set([...faults.readFailActionIds, act.id])], readFailFirstN: Object.keys(map).length ? map : undefined }), '읽기 실패 횟수');
          }} /></label>
        {n != null && !readResultUsed(p, act.deviceId) && <p className="muted" data-read-fail-hint={act.id} style={{ fontSize: 'var(--fs-xs)', margin: '0 0 6px' }}>결과를 쓰는 분기 · 재시도가 없어 첫 실패에서 멈춥니다</p>}
      </div>;
    })}
  </>;
}

/** Complete-signal injection. Shared by the 2D runtime panel and the 3D conditions column. */
export function NeverTrueFaults({ p, locked, edit }: { p: Project; locked: boolean; edit: EditFn }) {
  const faults = p.simSettings.faults;
  const toggleNever = (sid: string, on: boolean) => edit(C.setFaults(p, { ...faults, neverTrueSignalIds: on ? [...new Set([...faults.neverTrueSignalIds, sid])] : faults.neverTrueSignalIds.filter((x) => x !== sid) }), '오류 주입 변경');
  const completeSigs = p.actions.filter((a) => a.completeSignalId).map((a) => ({ a, sid: a.completeSignalId! }));
  return <>
    <select disabled={locked} value="" onChange={(e) => e.target.value && toggleNever(e.target.value, true)} style={{ width: '100%' }}>
      <option value="">+ 완료 신호 미발생 주입 (타임아웃 검증)</option>
      {completeSigs.map(({ a, sid }) => <option key={sid} value={sid}>{a.name} — {sigName(p, sid)}</option>)}
    </select>
    {faults.neverTrueSignalIds.map((sid) => <div key={sid} className="row" style={{ fontSize: 'var(--fs-xs)' }}><Badge kind="warn">미발생</Badge>{sigName(p, sid)}<button className="small" disabled={locked} onClick={() => toggleNever(sid, false)}>해제</button></div>)}
  </>;
}

/** Live facts and the full log. The 실행 상태 tab places this under the summary. */
export function RunStatusExtras({ p, rt }: { p: Project; rt: RuntimeState | null }) {
  const onSignals = rt ? Object.entries(rt.signals).filter(([, v]) => v).map(([k]) => sigName(p, k)) : [];
  return (
    <div className="cols run-status-extra">
      <div style={{ width: 280, overflow: 'auto', borderRight: '1px solid var(--border)', paddingRight: 8 }}>
        <div className="row"><label>실행 상태</label><Badge kind={rt?.status === 'error' ? 'err' : rt?.status === 'completed' ? 'ok' : rt?.status === 'running' ? 'acc' : 'warn'}>{runStatusLabel(rt?.status)}</Badge></div>
        <div className="row"><label>가상 시간</label><span className="mono">{fmt(rt?.timeMs ?? 0)}</span></div>
        <div className="row"><label>현재 단계</label>{(() => {
          const ids = rt?.flowRun?.fibers.flatMap((f) => f.active ? [f.active.stepId] : []) ?? [];
          const names = (ids.length ? ids : rt?.active?.stepId ? [rt.active.stepId] : []).map((id) => p.sequence.steps.find((s) => s.id === id)?.name ?? (p.substationSequences ?? []).flatMap((q) => q.steps).find((s) => s.id === id)?.name ?? (rt?.active && !rt.active.stepId ? p.sequence.steps[rt.active.stepIndex]?.name : id));
          if (!names.length && rt?.active) return p.sequence.steps[rt.active.stepIndex]?.name ?? '-';
          return names.filter(Boolean).join(', ') || '-';
        })()}</div>
        <div className="row"><label>자재</label><span style={{ fontSize: 'var(--fs-sm)' }}>{rt?.material ? `${rt.material.instanceId} @ ${unitName(p, rt.material.location)} · ${rt.material.state}${rt.material.holder ? ` · 잡음 ${rt.material.holder}` : ''}` : '-'}</span></div>
        <div className="row"><label>자재 수</label>{rt?.material ? 1 : 0}개 (보존)</div>
        <div className="row"><label>오류</label>{rt?.error ? <span style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>{rt.error.code} @ {rt.error.stepId}</span> : '0'}</div>
        <div className="row"><label>ON 신호</label><span style={{ fontSize: 'var(--fs-xs)' }}>{onSignals.join(', ') || '-'}</span></div>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table className="grid"><thead><tr><th style={{ width: 90 }}>가상 시각</th><th style={{ width: 110 }}>코드</th><th>내용</th></tr></thead>
          <tbody>{(rt?.log ?? []).slice().reverse().map((l, i) => <tr key={i} className={l.level === 'error' ? 'err' : ''}><td className="mono">{fmt(l.t)}</td><td className="mono" style={{ fontSize: 'var(--fs-xs)' }}>{l.code}</td><td style={{ fontSize: 'var(--fs-sm)' }}>{l.message}</td></tr>)}
            {!rt?.log.length && <tr><td colSpan={3}><EmptyState symbol="○" line={EMPTY.log} actions={[{ label: '실행', attrs: { 'data-empty-action': 'run' } }]} /></td></tr>}</tbody></table>
      </div>
    </div>
  );
}

/** Readiness and the blocker list with move buttons. Shared by the run conditions column. */
export function RunReadiness({ p, onGoBlocker }: { p: Project; onGoBlocker?: (b: Diagnostic, g: BlockerGuide) => void }) {
  const readiness = checkRunReadiness(p);
  return (
    <section className="run-readiness" aria-label="준비 검사">
      <h3>준비 검사</h3>
      {readiness.ok
        ? <p data-readiness="ok">실행 가능</p>
        : <p data-readiness="blocked">차단 {readiness.blockers.length}건</p>}
      {readiness.warnings.filter((w) => w.code === 'INTERLOCK_NO_RULE' || w.code === 'INTERLOCK_UNDETERMINED').map((w) => (
        <p key={w.id} className="notice" data-interlock-notice={w.objectId}>{w.message}</p>
      ))}
      {readiness.warnings.filter((w) => w.code === 'WAIT_UNREACHABLE').map((w) => (
        <p key={w.id} className="notice" data-wait-notice={w.objectId}>{w.message}</p>
      ))}
      {!readiness.ok && <BlockerList p={p} blockers={readiness.blockers} onGuide={onGoBlocker} />}
    </section>
  );
}

/** Readiness, blocker moves, and fault injection. Kept for the older runtime panel. */
export function RunInspectPanel({ p, locked, edit, onGoBlocker }: { p: Project; locked: boolean; edit: EditFn; onGoBlocker?: (b: Diagnostic, g: BlockerGuide) => void }) {
  return (
    <div className="run-inspect">
      <RunReadiness p={p} onGoBlocker={onGoBlocker} />
      <h4 style={{ margin: '10px 0 4px', fontSize: 'var(--fs-sm)' }}>검증용 오류 주입 (시뮬 설정)</h4>
      <ReadFailFaults p={p} locked={locked} edit={edit} />
      <NeverTrueFaults p={p} locked={locked} edit={edit} />
    </div>
  );
}

/** Previous single panel. Kept so a direct render still shows the hint, summary, and log together. */
export function RuntimePanel({ p, rt, locked, edit, onGoBlocker }: { p: Project; rt: RuntimeState | null; locked: boolean; edit: EditFn; onGoBlocker?: (b: Diagnostic, g: BlockerGuide) => void }) {
  return (
    <div>
      <RunSummary p={p} rt={rt} />
      <RunStatusExtras p={p} rt={rt} />
      <RunInspectPanel p={p} locked={locked} edit={edit} onGoBlocker={onGoBlocker} />
    </div>
  );
}

// ---------------- F6 Gap ----------------
export function GapPanel({ p, gaps, analyzedRevision, onReanalyze, onGo, onReview }: { p: Project; gaps: Gap[]; analyzedRevision: number | null; onReanalyze: () => void; onGo: (g: Gap) => void; onReview: (id: string, status: 'hidden' | 'humanConfirmed' | 'open') => void }) {
  const [showResolved, setShowResolved] = useState(false);
  const review = p.gapReview;
  const resolved = Object.entries(review).filter(([, r]) => r.status === 'resolved');
  const vanishedSafety = Object.entries(review).filter(([id, r]) => !gaps.some((g) => g.id === id) && r.status === 'needsHuman');
  const kinds: GapKind[] = ['io', 'unit', 'axisSpec', 'interference', 'timing'];
  return (
    <div>
      <div className="row">
        <button className="primary" onClick={onReanalyze}>재분석</button>
        <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>기준 리비전 {analyzedRevision ?? '-'} / 현재 {p.revision}</span>
        {analyzedRevision !== null && analyzedRevision !== p.revision && <Badge kind="warn">모델 변경됨 — 재분석 필요</Badge>}
        <span className="grow" />
        {kinds.map((k) => <Badge key={k}>{GAP_KIND_LABEL[k]} {gaps.filter((g) => g.kind === k && review[g.id]?.status !== 'hidden').length}</Badge>)}
        <label style={{ fontSize: 'var(--fs-sm)' }}><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />해결 행 펼치기 ({resolved.length})</label>
      </div>
      <div className="notice">규칙 기반 경량 판정 (시제품 규칙, 임계값·심각도 미확정). 간섭 후보는 2D 도식 중첩/Interlock 후보일 뿐 정밀 물리·안전 검증이 아니며 자동 종료하지 않습니다.</div>
      <table className="grid">
        <thead><tr><th>종류</th><th>판정</th><th>항목</th><th>근거</th><th>공정 단계</th><th>수정 제안</th><th>상태</th><th></th></tr></thead>
        <tbody>
          {gaps.map((g) => { const r = review[g.id]; if (r?.status === 'hidden') return null; return (
            <tr key={g.id} data-jump={`gap:${g.id}`}>
              <td><Badge kind={g.safety ? 'warn' : 'acc'}>{GAP_KIND_LABEL[g.kind]}</Badge></td>
              <td><StatusMark status={gapJudgementMark(g.judgement).status} word={gapJudgementMark(g.judgement).word} /></td>
              <td style={{ fontSize: 'var(--fs-sm)' }}>{g.title}</td>
              <td style={{ fontSize: 'var(--fs-xs)' }}>{g.evidence}{g.assumptions.length > 0 && <div className="muted"><StatusMark status="assumption" /> {g.assumptions.join(' · ')}</div>}</td>
              <td className="mono" style={{ fontSize: 'var(--fs-xs)' }}>{g.stepIds.join(', ') || '-'}</td>
              <td style={{ fontSize: 'var(--fs-xs)' }}>{g.suggestion}</td>
              <td style={{ fontSize: 'var(--fs-xs)' }}>{r ? ({ open: '열림', needsHuman: '사람 확인 필요', humanConfirmed: '사람 확인됨', resolved: '해결', hidden: '숨김' } as const)[r.status] : '미분석'}</td>
              <td style={{ whiteSpace: 'nowrap' }}><button className="small" onClick={() => onGo(g)}>이동</button>
                {g.safety && <button className="small" onClick={() => onReview(g.id, 'humanConfirmed')}>사람 확인</button>}
                <button className="small" onClick={() => onReview(g.id, 'hidden')}>숨김</button></td>
            </tr>); })}
          {vanishedSafety.map(([id, r]) => <tr key={id}><td><Badge kind="warn">간섭 후보</Badge></td><td><Badge kind="warn">조건 변경</Badge></td><td className="mono" style={{ fontSize: 'var(--fs-xs)' }}>{id}</td><td style={{ fontSize: 'var(--fs-xs)' }}>{r.lastEvidence}</td><td /><td style={{ fontSize: 'var(--fs-xs)' }}>자동 종료 안 함 — 사람이 확인</td><td>사람 확인 필요</td><td><button className="small" onClick={() => onReview(id, 'humanConfirmed')}>사람 확인</button></td></tr>)}
          {showResolved && resolved.map(([id, r]) => <tr key={id} style={{ opacity: .6 }}><td colSpan={2}><Badge kind="ok">해결</Badge></td><td className="mono" style={{ fontSize: 'var(--fs-xs)' }}>{id}</td><td style={{ fontSize: 'var(--fs-xs)' }}>이전 근거: {r.lastEvidence}</td><td colSpan={3} style={{ fontSize: 'var(--fs-xs)' }}>rev {r.firstSeenRevision}에 발견 → rev {r.resolvedRevision}에 해결</td><td /></tr>)}
          {Object.entries(review).filter(([, r]) => r.status === 'hidden').map(([id]) => <tr key={id} style={{ opacity: .5 }}><td colSpan={7} className="mono" style={{ fontSize: 'var(--fs-xs)' }}>숨김: {id} (해결 아님)</td><td><button className="small" onClick={() => onReview(id, 'open')}>복원</button></td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

/** Finished-run rows. They are not part of the saved project and are not hidden by the static filters. */
export function RunGapSection({ gaps, ran, stale, onGo }: { gaps: Gap[]; ran: boolean; stale: boolean; onGo: (g: Gap) => void }) {
  return (
    <div className="run-gap-block" data-run-gaps={gaps.length} data-run-stale={stale ? '1' : '0'}>
      <h3>실행 결과</h3>
      {!ran && <p data-run-gap-empty="">실행하면 여기에 실행 결과 Gap 이 나옵니다</p>}
      {ran && stale && <p className="warn-note" data-run-gap-stale="">이전 rev 의 실행 결과</p>}
      {ran && gaps.length === 0 && <EmptyState symbol="✓" line="이 실행에서는 실행 결과 Gap 이 없습니다." />}
      {gaps.length > 0 && <table className="grid plain">
        <thead><tr><th>종류</th><th>항목</th><th>근거</th><th>수정 제안</th><th></th></tr></thead>
        <tbody>
          {gaps.map((g) => <tr key={g.id} data-run-gap={g.id} data-jump={`gap:${g.id}`}>
            <td><span className="badge acc">실행 결과</span> {GAP_KIND_LABEL[g.kind]}</td>
            <td>{g.title}</td>
            <td>{g.evidence}{g.assumptions.length > 0 && <div className="muted">{g.assumptions.join(' · ')}</div>}</td>
            <td>{g.suggestion}</td>
            <td style={{ whiteSpace: 'nowrap' }}><button type="button" className="small" aria-label={`${g.title} 이동`} onClick={() => onGo(g)}>이동</button></td>
          </tr>)}
        </tbody>
      </table>}
    </div>
  );
}

// ---------------- F4 Material & Flow ----------------
export function MaterialPanel({ p, locked, edit }: { p: Project; locked: boolean; edit: EditFn }) {
  const m = p.materials[0];
  const [addUnit, setAddUnit] = useState('');
  if (!m) return <EmptyState symbol="○" line={EMPTY.materials} actions={[{ label: '자재 추가', disabled: locked, reason: locked ? RUN_LOCK : undefined, onClick: () => edit(C.addMaterial(p), '자재 추가'), attrs: { 'data-jump': 'material-add' } }]} />;
  const route = m.route;
  const setRoute = (r: string[]) => edit(C.updateMaterial(p, m.id, { route: r }), '경로 변경');
  return (
    <div className="cols">
      <div style={{ width: 360, overflow: 'auto', borderRight: '1px solid var(--border)', paddingRight: 8 }}>
        <div className="row"><label>자재 이름</label><TextInput value={m.name} disabled={locked} onCommit={(v) => edit(C.renameObject(p, m.id, v), '자재 이름')} /><span className="mono muted">{m.id}</span></div>
        <div className="row"><label>종류</label><select disabled={locked} value={m.kind} onChange={(e) => edit(C.updateMaterial(p, m.id, { kind: e.target.value as 'individual' | 'carrier' }), '자재 종류')}><option value="individual">개별 자재</option><option value="carrier">캐리어</option></select><span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>캐리어-적재 관계 편집 미구현</span></div>
        <div className="row"><label>크기 W/L/H</label></div>
        {(['w', 'l', 'h'] as const).map((k) => <div key={k} className="row"><label style={{ textAlign: 'right' }}>{k.toUpperCase()}</label><QtyInput q={m.size[k]} disabled={locked} onCommit={(v, as) => edit(C.setQuantity(p, { kind: 'material', id: m.id, field: k }, v, as), '자재 크기')} /></div>)}
        <div className="row"><label>무게</label><QtyInput q={m.weight} disabled={locked} onCommit={(v, as) => edit(C.setQuantity(p, { kind: 'material', id: m.id, field: 'weight' }, v, as), '자재 무게')} /></div>
        <div className="row"><label>취급 조건</label><TextInput value={m.handling} disabled={locked} onCommit={(v) => edit(C.updateMaterial(p, m.id, { handling: v }), '취급 조건')} /></div>
        <div className="row"><label>투입 개수</label><input key={feedCountOf(m)} type="number" aria-label="자재 투입 개수" className="num" min={1} step={1} disabled={locked} defaultValue={feedCountOf(m)} onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n !== feedCountOf(m)) edit(C.setFeedCount(p, m.id, n), '투입 개수'); else e.target.value = String(feedCountOf(m)); }} /></div>
        <div className="row"><label>투입 간격</label><QtyInput q={m.feedInterval} disabled={locked} onCommit={(v, as) => edit(C.setQuantity(p, { kind: 'material', id: m.id, field: 'feedInterval' }, v, as), '투입 간격')} /></div>
        <div className="row"><label>상태집합</label><TextInput value={m.states.join(', ')} width={210} disabled={locked} onCommit={(v) => edit(C.updateMaterial(p, m.id, { states: v.split(',').map((x) => x.trim()).filter(Boolean) }), '상태집합')} /></div>
        <div className="row" data-jump="material-state"><label>초기 상태</label><select disabled={locked} value={m.initialState ?? ''} onChange={(e) => edit(C.updateMaterial(p, m.id, { initialState: e.target.value || null }), '초기 상태')}><option value="">(미정)</option>{m.states.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div className="row" data-jump="material-location"><label>초기 위치</label><select disabled={locked} value={m.initialLocation ?? ''} onChange={(e) => edit(C.updateMaterial(p, m.id, { initialLocation: e.target.value || null }), '초기 위치')}><option value="">(미정)</option>{p.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>자재 정의는 하나이고, 실행은 그 정의를 투입 개수만큼 이어서 넣습니다. 정의가 여러 종류이거나 캐리어에 싣는 것은 없습니다.</div>
      </div>
      <div style={{ width: 300, overflow: 'auto', borderRight: '1px solid var(--border)', paddingRight: 8 }}>
        <b style={{ fontSize: 'var(--fs-sm)' }} data-jump="material-route">Unit 경로 (순서)</b>
        {route.map((uid, i) => <div key={`${uid}-${i}`} className="row" style={{ minHeight: 24 }}><span className="mono">{i + 1}.</span><span style={{ flex: 1 }}>{unitName(p, uid)}</span>
          <button className="small" disabled={locked || i === 0} onClick={() => { const r = [...route]; [r[i - 1], r[i]] = [r[i], r[i - 1]]; setRoute(r); }}>↑</button>
          <button className="small" disabled={locked || i === route.length - 1} onClick={() => { const r = [...route]; [r[i + 1], r[i]] = [r[i], r[i + 1]]; setRoute(r); }}>↓</button>
          <button type="button" className="small danger" disabled={locked} onClick={() => setRoute(route.filter((_, j) => j !== i))}>삭제</button></div>)}
        <div className="row"><select value={addUnit} disabled={locked} onChange={(e) => setAddUnit(e.target.value)}><option value="">Unit 선택</option>{p.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select><button className="small" disabled={locked || !addUnit} onClick={() => { setRoute([...route, addUnit]); setAddUnit(''); }}>+ 경로 추가</button></div>
        <div className="muted" style={{ fontSize: 'var(--fs-xs)', marginTop: 6 }}>물류 연결선(캔버스)은 자재를 자동 이동시키지 않음. 이동은 Action 자재 변화로만.</div>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <b style={{ fontSize: 'var(--fs-sm)' }}>상태전이 ↔ Action/post 연결 (F4-03)</b>
        <table className="grid"><thead><tr><th><Terms text="Action" /></th><th>전제</th><th>자재 변화</th><th>post 검증</th></tr></thead>
          <tbody>{p.actions.filter((a) => a.effect.moveTo || a.effect.setState || a.effect.holder !== undefined).map((a) => <tr key={a.id}><td style={{ fontSize: 'var(--fs-sm)' }}>{a.name}</td><td style={{ fontSize: 'var(--fs-xs)' }}>{conditionsFormula(p, a.pre) || '-'}</td><td style={{ fontSize: 'var(--fs-xs)' }}>{effectLabel(p, a.effect)}</td><td style={{ fontSize: 'var(--fs-xs)' }}>{conditionsFormula(p, a.post) || '-'}</td></tr>)}</tbody></table>
        <b style={{ fontSize: 'var(--fs-sm)', display: 'block', marginTop: 'var(--sp-2)' }}>Unit 수용 능력</b>
        <table className="grid"><thead><tr><th><Terms text="Unit" /></th><th>수용 개수</th><th>허용 무게</th></tr></thead>
          <tbody>{p.units.map((u) => <tr key={u.id}><td>{u.name}</td><td>{u.capacity.maxMaterials.value ?? <StatusMark status="undetermined" />}{u.capacity.maxMaterials.assumption ? <> <StatusMark status="assumption" /></> : null}</td><td>{u.capacity.maxWeight.value ?? <StatusMark status="undetermined" />} kg{u.capacity.maxWeight.assumption ? <> <StatusMark status="assumption" /></> : null}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}

// ---------------- F1 Input Hub ----------------
export function InputHubPanel({ p, locked, edit }: { p: Project; locked: boolean; edit: EditFn }) {
  const [targetKind, setTargetKind] = useState<'unit' | 'device'>('device');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AssetKind>('sensor');
  const [unitId, setUnitId] = useState('');
  const [level, setLevel] = useState<'direct' | 'low' | 'medium' | 'high'>('direct');
  const [preview, setPreview] = useState(false);
  const setCand = (id: string, patch: Partial<Project['candidates'][number]>) => {
    const n = structuredClone(p); const c = n.candidates.find((x) => x.id === id)!; Object.assign(c, patch); n.revision += 1;
    edit({ ok: true, project: n }, '후보 변경');
  };
  const plan = planCandidateApply(p);
  return (
    <div className="cols">
      <div style={{ width: 300, borderRight: '1px solid var(--border)', paddingRight: 8, overflow: 'auto' }}>
        <div className="row"><Badge kind="ok">경로 A 직접 입력</Badge><Badge>경로 B 문서(PDF/DWG/XLSX) 미구현</Badge></div>
        <div className="row"><Badge>경로 C VC/USD 미구현</Badge><Badge>유사 장비 템플릿: 5공정 예제만</Badge></div>
        <div className="row"><label>대상</label><select value={targetKind} onChange={(e) => setTargetKind(e.target.value as 'unit' | 'device')}><option value="device">Device</option><option value="unit">Unit</option></select></div>
        <div className="row"><label>이름</label><input data-jump="candidate-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="예) SEN-02" /></div>
        {targetKind === 'device' && <>
          <div className="row"><label>종류</label><select value={kind} onChange={(e) => setKind(e.target.value as AssetKind)}>{ASSET_LIBRARY.filter((a) => !a.template).map((a) => <option key={a.kind} value={a.kind}>{a.name}</option>)}</select></div>
          <div className="row"><label>소속 Unit</label><select value={unitId} onChange={(e) => setUnitId(e.target.value)}><option value="">(미배정)</option>{p.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        </>}
        <div className="row"><label>신뢰도</label><select value={level} onChange={(e) => setLevel(e.target.value as typeof level)}><option value="direct">직접 지정</option><option value="high">높음</option><option value="medium">중간</option><option value="low">낮음</option></select></div>
        <button disabled={locked || !name.trim()} onClick={() => { const c = newCandidate(targetKind, name.trim(), targetKind === 'device' ? kind : null, targetKind === 'device' ? unitId || null : null, level); const n = structuredClone(p); n.candidates.push(c); n.revision += 1; if (edit({ ok: true, project: n }, '후보 추가')) setName(''); }}>+ 후보표에 추가</button>
        <div className="muted" style={{ fontSize: 'var(--fs-xs)', marginTop: 6 }}>후보는 사람이 확인하기 전 모델에 반영되지 않습니다.</div>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table className="grid"><thead><tr><th>후보 ID</th><th>대상</th><th>이름</th><th>종류</th><th><Terms text="소속 Unit" /></th><th>출처</th><th>신뢰 근거</th><th>확인</th><th>반영 ID</th></tr></thead>
          <tbody>{p.candidates.map((c) => <tr key={c.id} data-jump={`candidate:${c.id}`}>
            <td className="mono" style={{ fontSize: 'var(--fs-xs)' }}>{c.id}</td><td>{c.targetKind}</td><td>{c.name}</td><td>{c.deviceKind ?? '-'}</td>
            <td>{c.targetKind === 'device' ? <select disabled={locked || !!c.appliedObjectId} value={c.assignedUnitId ?? ''} onChange={(e) => setCand(c.id, { assignedUnitId: e.target.value || null })}><option value="">(미배정)</option>{p.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select> : '-'}</td>
            <td style={{ fontSize: 'var(--fs-xs)' }}>{c.sourceRefs.map((s) => s.note ?? s.method).join(', ')}</td>
            <td style={{ fontSize: 'var(--fs-xs)' }}>{c.confidence.level} · {c.confidence.basis}</td>
            <td style={{ whiteSpace: 'nowrap' }}><Badge kind={c.confirmation === 'confirmed' ? 'ok' : c.confirmation === 'rejected' ? 'err' : 'warn'}>{c.confirmation}</Badge>
              {!c.appliedObjectId && <><button className="small" disabled={locked} onClick={() => setCand(c.id, { confirmation: 'confirmed' })}>확인</button><button className="small" disabled={locked} onClick={() => setCand(c.id, { confirmation: 'rejected' })}>거절</button></>}</td>
            <td className="mono" style={{ fontSize: 'var(--fs-xs)' }}>{c.appliedObjectId ?? '-'}</td></tr>)}
            {p.candidates.length === 0 && <tr><td colSpan={9}><EmptyState symbol="○" line={EMPTY.candidates} actions={[{ label: '후보 추가', disabled: locked, reason: locked ? RUN_LOCK : '이름을 입력하면 후보표에 넣습니다.', onClick: () => { const input = document.querySelector<HTMLInputElement>('[data-jump="candidate-name"]'); input?.focus(); } }]} /></td></tr>}</tbody></table>
        <div className="row" style={{ marginTop: 6 }}><button disabled={locked || plan.length === 0} onClick={() => setPreview(true)}>반영 미리보기</button></div>
        {preview && <div className="notice">
          {plan.map((it) => <div key={it.candidateId}>{it.apply ? <Badge kind="ok">반영</Badge> : <Badge kind="warn">제외</Badge>} {it.name} — {it.reason}</div>)}
          <div className="row"><button className="primary" disabled={locked || !plan.some((x) => x.apply)} onClick={() => { const r = applyCandidates(p); r.project.revision += 1; if (edit({ ok: true, project: r.project }, `후보 ${r.applied.length}건 반영`)) setPreview(false); }}>확인된 항목 Canvas에 반영</button><button onClick={() => setPreview(false)}>취소 (모델 불변)</button></div>
        </div>}
      </div>
    </div>
  );
}

// ---------------- SFC preview ----------------
export function SfcPanel({ p, rt }: { p: Project; rt: RuntimeState | null }) {
  return (
    <div>
      <div className="notice">Station 흐름의 SFC 미리보기입니다. 분기는 갈래 조건 글자, 병렬은 이중 가로선, 반복은 되돌림과 횟수, 재시도는 되돌림과 최대 횟수, 신호 기다림은 조건이 적힌 둥근 칸, Substation 단계는 시퀀스 이름이 든 병렬로 보입니다.</div>
      <SfcView p={p} rt={rt} />
    </div>
  );
}

// ---------------- F8 preview ----------------
export function ExportPanel({ p }: { p: Project }) {
  const rows = buildExportPreview(p);
  return (
    <div>
      <div className="notice err">F8 매핑 <b>미리보기</b>. 대상 칸은 초안 형식의 자리 이름입니다. Aurora Core 스키마·버전은 확인되지 않아 Core 전송, SignalMap 생성, 실측 역매핑은 구현하지 않았습니다. 검증된 실제 연동이 아닙니다.</div>
      <p><button type="button" disabled title="미구현: Core 주소·스키마·역매핑이 확정되지 않았습니다">Core로 보내기</button> <span className="muted">버튼은 눌리지 않습니다. 아래 표는 이 프로젝트의 미리보기이며 전송 결과가 아닙니다.</span></p>
      <table className="grid"><thead><tr><th>분류</th><th>원본 ID</th><th>이름</th><th>목적지(후보)</th><th>상태</th><th><Terms text="비고/가정" /></th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><td>{r.category}</td><td className="mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.sourceId}</td><td style={{ fontSize: 'var(--fs-sm)' }}>{r.name}</td><td style={{ fontSize: 'var(--fs-xs)' }}>{r.target}</td>
          <td><StatusMark status={exportStatusMark(r.status).status} word={exportStatusMark(r.status).word} /></td><td style={{ fontSize: 'var(--fs-xs)' }}>{r.note}</td></tr>)}</tbody></table>
    </div>
  );
}

export function LabPanel() {
  return <div className="notice warn" data-screen-note="S53" style={{ fontSize: 'var(--fs-md)' }}>
    <b>F7 Evolution Lab — 미구현</b>
    <p>변형 공간, 후보 생성, 평가, Pareto, 세대 점수, 예산, 외부 전송은 없습니다. 예시 점수를 분석 결과처럼 보여 주지 않습니다.</p>
    <p>지금 쓸 수 있는 것은 Gap 목록의 가정 시간 합계뿐입니다. 평가 방법과 예산이 정해지기 전에는 실행하지 않습니다.</p>
    <button type="button" disabled title="미구현: 평가 방법·예산·외부 전송이 정해지지 않았습니다">평가 실행</button>
  </div>;
}

/** S14 — document intake that this product does not perform. */
export function ExtractPanel() {
  return <div className="notice" data-screen-note="S14">
    <b>자료 입력 — 미구현</b>
    <p>PDF, DWG, XLSX, USD에서 장비·수치를 뽑는 기능은 없습니다. 파일을 올려도 모델은 바뀌지 않으며, 예시 표를 추출 성공으로 보여 주지 않습니다.</p>
    <p>지금 넣을 수 있는 것은 입력 후보표의 직접 입력과 AML 라이브러리 파일입니다.</p>
    <button type="button" disabled title="미구현: 문서 추출을 하지 않습니다">문서에서 가져오기</button>
  </div>;
}

/** S44 — editors that the manual says are not in the product. */
export function ExtendPanel() {
  return <div className="notice" data-screen-note="S44">
    <b>누락 편집 확장 — 미구현</b>
    <p>분기 · 병렬 · 반복 · 재시도 · Substation 단계는 4단계 Station 시퀀스에서 묶습니다. 이 화면은 자재 여러 개, 캐리어, 갈래 사이 동기점, 조건으로 도는 무한 반복, 세 갈래 이상 분기를 만들지 않습니다.</p>
    <p>Station 시퀀스 단계의 시간 제한은 4단계 Station 시퀀스에서 편집합니다. Substation 시퀀스 안은 순서대로만 돕니다.</p>
    <button type="button" disabled title="이 화면에서는 만들지 않습니다. 4단계 Station 시퀀스에서 묶으세요">분기 단계 추가</button>
  </div>;
}

// ---------------- Diagnostics / storage / AML ----------------
export function DiagPanel({ p, storageReason, quarantineList, onDownload }: { p: Project; storageReason: string | null; quarantineList: QuarantineEntry[]; onDownload: (name: string, text: string, mime?: string) => void }) {
  const diags = validateProject(p);
  return (
    <div className="cols">
      <div style={{ flex: 1, overflow: 'auto' }}>
        <b style={{ fontSize: 'var(--fs-sm)' }}>참조 무결성 진단 (D04)</b>
        {diags.length === 0 ? <div className="row"><Badge kind="ok">오류 없음</Badge></div> : diags.map((d) => <div key={d.id} style={{ fontSize: 'var(--fs-xs)', color: d.severity === 'error' ? 'var(--danger)' : 'var(--warning)' }}>[{d.code}] {d.objectId}: {d.message}</div>)}
        <b style={{ fontSize: 'var(--fs-sm)', display: 'block', marginTop: 8 }}>저장소</b>
        <div style={{ fontSize: 'var(--fs-sm)' }}>{storageReason ? <span style={{ color: 'var(--warning)' }}>{storageReason} → 메모리 전용. JSON 내보내기로 보관하세요.</span> : 'Browser localStorage 사용 가능 (이 브라우저·이 파일 위치 기준). 다른 PC/브라우저와 공유되지 않음.'}</div>
        <b style={{ fontSize: 'var(--fs-sm)', display: 'block', marginTop: 8 }}>가정 메모</b>
        {p.assumptionsNote.map((n, i) => <div key={i} style={{ fontSize: 'var(--fs-xs)' }}>• {n}</div>)}
      </div>
      <div style={{ width: 300, overflow: 'auto', borderLeft: '1px solid var(--border)', paddingLeft: 8 }}>
        <b style={{ fontSize: 'var(--fs-sm)' }}>격리 보관함 (거부된 가져오기 원본)</b>
        {quarantineList.length === 0 && <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>없음</div>}
        {quarantineList.map((q, i) => <div key={i} style={{ fontSize: 'var(--fs-xs)', borderBottom: '1px solid var(--border)', padding: '3px 0' }}>{q.at} · {q.label}<div style={{ color: 'var(--danger)' }}>{q.errors.slice(0, 2).join(' / ')}</div><button className="small" onClick={() => onDownload(`quarantine-${i}-${q.label}`, q.raw, 'application/octet-stream')}>원본 그대로 다운로드</button></div>)}
        <b style={{ fontSize: 'var(--fs-sm)', display: 'block', marginTop: 8 }}>에셋 AML 라이브러리 ({ASSET_LIBRARY.length}종)</b>
        <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>라이브러리는 AML 파일에서 읽음 (앱 상수 목록 없음). 내보내기 = 현재 로드된 정의 전체를 CAEX 3.0 한 파일로 직렬화.</div>
        <button className="small" onClick={() => onDownload('ecd-library-export.aml', exportLibraryAml(), 'application/xml')}>AML 라이브러리 내보내기</button>
        <AmlLoadStatus libVersion={ASSET_LIBRARY.length} />
      </div>
    </div>
  );
}
