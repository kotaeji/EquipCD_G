import { useState } from 'react';
import { ASSET_LIBRARY, exportLibraryAml } from '../assets/library';
import { AmlLoadStatus } from './Library';
import { applyCandidates, newCandidate, planCandidateApply } from '../model/candidates';
import * as C from '../model/commands';
import { buildExportPreview } from '../model/exportPreview';
import { GAP_KIND_LABEL, type Gap, type GapKind } from '../model/gaps';
import { parseStructuredSequence, type ParsedLine } from '../model/structuredText';
import type { AssetKind, Project } from '../model/types';
import { checkRunReadiness, validateProject } from '../model/validate';
import type { RuntimeState } from '../runtime/engine';
import type { QuarantineEntry } from '../storage/localStore';
import type { EditFn } from './Inspector';
import { condLabel, devName, effectLabel, sigName, unitName } from './labels';
import { Badge, QtyInput, TextInput } from './widgets';

const fmt = (msv: number) => `${String(Math.floor(msv / 60000)).padStart(2, '0')}:${(Math.floor(msv / 1000) % 60).toString().padStart(2, '0')}.${(msv % 1000).toString().padStart(3, '0')}`;
export { fmt as fmtTime };

// ---------------- F5 Sequence ----------------
export function SequencePanel({ p, rt, locked, edit, onSelect }: { p: Project; rt: RuntimeState | null; locked: boolean; edit: EditFn; onSelect: (id: string) => void }) {
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
        <div className="row"><b style={{ fontSize: 12 }}>제공 Action</b><select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} style={{ width: 110 }}><option value="">모든 Unit</option>{p.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div className="muted" style={{ fontSize: 11 }}>오른쪽 시퀀스로 드래그 (DnD)</div>
        {acts.map((a) => <div key={a.id} className="draggable-action" draggable={!locked} onDragStart={(e) => e.dataTransfer.setData('application/x-ecd-action', a.id)} title={a.id}>{a.name}</div>)}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => dropAt(e, p.sequence.steps.length)}>
        <table className="grid">
          <thead><tr><th>#</th><th>단계</th><th>Unit / Device</th><th>완료 조건</th><th>타임아웃</th><th>자재 변화</th><th>출처</th><th>상태</th><th></th></tr></thead>
          <tbody>
            {p.sequence.steps.map((s, i) => {
              const a = p.actions.find((x) => x.id === s.actionId);
              const rec = rt?.steps.find((r) => r.stepId === s.id);
              const st = rec?.status ?? 'pending';
              return (
                <tr key={s.id} className={st === 'active' ? 'active' : st === 'error' ? 'err' : ''} draggable={!locked}
                  onDragStart={(e) => { setDragIdx(i); e.dataTransfer.setData('text/plain', s.id); }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => dropAt(e, i)}>
                  <td className="mono">{String(i + 1).padStart(2, '0')}</td>
                  <td><span style={{ cursor: 'pointer' }} onClick={() => a && onSelect(a.deviceId)}>{s.name}</span><div className="muted mono" style={{ fontSize: 10 }}>{s.id}</div></td>
                  <td style={{ fontSize: 11 }}>{a ? `${unitName(p, a.unitId)} / ${devName(p, a.deviceId)}` : <Badge kind="err">Action 없음</Badge>}</td>
                  <td style={{ fontSize: 11 }}>{a?.completeSignalId ? `${sigName(p, a.completeSignalId)} = true` : <Badge kind="warn">미정</Badge>}{a && a.pre.length > 0 && <div className="muted">진입: {a.pre.map((c) => condLabel(p, c)).join('; ')}</div>}</td>
                  <td>{a && <QtyInput q={s.timeoutOverride ?? a.timeout} disabled={locked} title="이 단계의 타임아웃 (Action 기본값 덮어쓰기)" onCommit={(v, as) => edit(C.setQuantity(p, { kind: 'stepTimeout', id: s.id }, v, as), '단계 타임아웃')} />}</td>
                  <td style={{ fontSize: 11 }}>{a ? effectLabel(p, a.effect) : ''}</td>
                  <td style={{ fontSize: 10 }} className="muted">{s.origin}{s.sourceText ? `: "${s.sourceText}"` : ''}</td>
                  <td>{st === 'done' ? <Badge kind="ok">완료</Badge> : st === 'active' ? <Badge kind="acc">실행 중</Badge> : st === 'error' ? <Badge kind="err">오류</Badge> : <span className="muted">대기</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="small" disabled={locked || i === 0} onClick={() => edit(C.moveStep(p, i, i - 1), '단계 위로')}>↑</button>
                    <button className="small" disabled={locked || i === p.sequence.steps.length - 1} onClick={() => edit(C.moveStep(p, i, i + 1), '단계 아래로')}>↓</button>
                    <button className="small danger" disabled={locked} onClick={() => edit(C.removeStep(p, s.id), '단계 삭제')}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="dropzone" style={{ marginTop: 4 }}>여기로 Action을 드래그하면 끝에 추가 · 행을 드래그해 순서 변경 · 순차 실행만 지원(분기/병렬 미지원)</div>
        {p.sequence.unresolved.length > 0 && <div className="notice warn">미해결/모호 목록(보존): {p.sequence.unresolved.join(' · ')}</div>}
      </div>
      <div style={{ width: 270, borderLeft: '1px solid var(--border)', paddingLeft: 8, overflow: 'auto' }}>
        <b style={{ fontSize: 12 }}>구조화 문장 입력 (결정적 변환 · AI 미사용)</b>
        <textarea rows={4} style={{ width: '100%' }} value={text} disabled={locked} placeholder={'한 줄에 한 단계\n예) S1 푸셔 투입\n    S2 바코드 읽기'} onChange={(e) => setText(e.target.value)} />
        <button disabled={locked || !text.trim()} onClick={() => { setParsed(parseStructuredSequence(p, text)); setChoice({}); }}>변환 미리보기</button>
        {parsed && <div style={{ marginTop: 6 }}>
          {parsed.map((l, i) => <div key={i} style={{ fontSize: 11, borderBottom: '1px solid var(--border)', padding: '2px 0' }}>
            “{l.line}” → {l.status === 'matched' ? <Badge kind="ok">{p.actions.find((a) => a.id === l.actionId)?.name}</Badge> : l.status === 'ambiguous' ?
              <><Badge kind="warn">선택 필요</Badge><select value={choice[i] ?? ''} onChange={(e) => setChoice({ ...choice, [i]: e.target.value })} style={{ width: '100%' }}><option value="">(사람이 선택 — 자동 확정 안 함)</option>{l.candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></> : <Badge kind="err">찾을 수 없음</Badge>}
          </div>)}
          <button className="primary" style={{ marginTop: 4 }} onClick={addParsed}>확정된 줄만 시퀀스에 추가</button>
          <div className="muted" style={{ fontSize: 10 }}>자연어 Dictation·의미 추론(3등급 AI)은 미구현.</div>
        </div>}
      </div>
    </div>
  );
}

// ---------------- Runtime status / log ----------------
export function RuntimePanel({ p, rt, locked, edit }: { p: Project; rt: RuntimeState | null; locked: boolean; edit: EditFn }) {
  const readiness = checkRunReadiness(p);
  const faults = p.simSettings.faults;
  const bcrAct = p.actions.find((a) => a.kind === 'read');
  const toggleNever = (sid: string, on: boolean) => edit(C.setFaults(p, { ...faults, neverTrueSignalIds: on ? [...new Set([...faults.neverTrueSignalIds, sid])] : faults.neverTrueSignalIds.filter((x) => x !== sid) }), '오류 주입 변경');
  const completeSigs = p.actions.filter((a) => a.completeSignalId).map((a) => ({ a, sid: a.completeSignalId! }));
  const onSignals = rt ? Object.entries(rt.signals).filter(([, v]) => v).map(([k]) => sigName(p, k)) : [];
  return (
    <div className="cols">
      <div style={{ width: 280, overflow: 'auto', borderRight: '1px solid var(--border)', paddingRight: 8 }}>
        <div className="row"><label>실행 상태</label><Badge kind={rt?.status === 'error' ? 'err' : rt?.status === 'completed' ? 'ok' : rt?.status === 'running' ? 'acc' : 'warn'}>{rt?.status ?? 'idle'}</Badge></div>
        <div className="row"><label>가상 시간</label><span className="mono">{fmt(rt?.timeMs ?? 0)}</span></div>
        <div className="row"><label>현재 단계</label>{rt?.active ? p.sequence.steps[rt.active.stepIndex]?.name : '-'}</div>
        <div className="row"><label>자재</label><span style={{ fontSize: 12 }}>{rt?.material ? `${rt.material.instanceId} @ ${unitName(p, rt.material.location)} · ${rt.material.state}${rt.material.holder ? ` · 잡음 ${rt.material.holder}` : ''}` : '-'}</span></div>
        <div className="row"><label>자재 수</label>{rt?.material ? 1 : 0}개 (보존)</div>
        <div className="row"><label>오류</label>{rt?.error ? <span style={{ color: 'var(--danger)', fontSize: 12 }}>{rt.error.code} @ {rt.error.stepId}</span> : '0'}</div>
        <div className="row"><label>ON 신호</label><span style={{ fontSize: 11 }}>{onSignals.join(', ') || '-'}</span></div>
        <div className="row"><label>준비 검사</label>{readiness.ok ? <Badge kind="ok">실행 가능</Badge> : <Badge kind="err">차단 {readiness.blockers.length}</Badge>}</div>
        {!readiness.ok && readiness.blockers.slice(0, 6).map((b) => <div key={b.id} style={{ fontSize: 11, color: 'var(--danger)' }}>• {b.message}</div>)}
        <h4 style={{ margin: '10px 0 4px', fontSize: 12 }}>검증용 오류 주입 (시뮬 설정)</h4>
        {bcrAct && <label className="row" style={{ fontSize: 12 }}><input type="checkbox" disabled={locked} checked={faults.readFailActionIds.includes(bcrAct.id)} onChange={(e) => edit(C.setFaults(p, { ...faults, readFailActionIds: e.target.checked ? [bcrAct.id] : [] }), '읽기 실패 주입')} />{bcrAct.name}: 결과 실패</label>}
        <select disabled={locked} value="" onChange={(e) => e.target.value && toggleNever(e.target.value, true)} style={{ width: '100%' }}>
          <option value="">+ 완료 신호 미발생 주입 (타임아웃 검증)</option>
          {completeSigs.map(({ a, sid }) => <option key={sid} value={sid}>{a.name} — {sigName(p, sid)}</option>)}
        </select>
        {faults.neverTrueSignalIds.map((sid) => <div key={sid} className="row" style={{ fontSize: 11 }}><Badge kind="warn">미발생</Badge>{sigName(p, sid)}<button className="small" disabled={locked} onClick={() => toggleNever(sid, false)}>해제</button></div>)}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table className="grid"><thead><tr><th style={{ width: 90 }}>가상 시각</th><th style={{ width: 110 }}>코드</th><th>내용</th></tr></thead>
          <tbody>{(rt?.log ?? []).slice().reverse().map((l, i) => <tr key={i} className={l.level === 'error' ? 'err' : ''}><td className="mono">{fmt(l.t)}</td><td className="mono" style={{ fontSize: 11 }}>{l.code}</td><td style={{ fontSize: 12 }}>{l.message}</td></tr>)}
            {!rt?.log.length && <tr><td colSpan={3} className="muted">로그 없음 — 툴바의 ▶ 실행을 누르세요</td></tr>}</tbody></table>
      </div>
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
        <span className="muted" style={{ fontSize: 12 }}>기준 리비전 {analyzedRevision ?? '-'} / 현재 {p.revision}</span>
        {analyzedRevision !== null && analyzedRevision !== p.revision && <Badge kind="warn">모델 변경됨 — 재분석 필요</Badge>}
        <span className="grow" />
        {kinds.map((k) => <Badge key={k}>{GAP_KIND_LABEL[k]} {gaps.filter((g) => g.kind === k && review[g.id]?.status !== 'hidden').length}</Badge>)}
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />해결 행 펼치기 ({resolved.length})</label>
      </div>
      <div className="notice">규칙 기반 경량 판정 (시제품 규칙, 임계값·심각도 미확정). 간섭 후보는 2D 도식 중첩/Interlock 후보일 뿐 정밀 물리·안전 검증이 아니며 자동 종료하지 않습니다.</div>
      <table className="grid">
        <thead><tr><th>종류</th><th>판정</th><th>항목</th><th>근거</th><th>공정 단계</th><th>수정 제안</th><th>상태</th><th></th></tr></thead>
        <tbody>
          {gaps.map((g) => { const r = review[g.id]; if (r?.status === 'hidden') return null; return (
            <tr key={g.id}>
              <td><Badge kind={g.safety ? 'warn' : 'acc'}>{GAP_KIND_LABEL[g.kind]}</Badge></td>
              <td>{g.judgement === 'shortfall' ? <Badge kind="err">부족</Badge> : g.judgement === 'undetermined' ? <Badge kind="warn">미정/비교 불가</Badge> : <Badge kind="warn">사람 확인 후보</Badge>}</td>
              <td style={{ fontSize: 12 }}>{g.title}</td>
              <td style={{ fontSize: 11 }}>{g.evidence}{g.assumptions.length > 0 && <div className="muted">가정: {g.assumptions.join(' · ')}</div>}</td>
              <td className="mono" style={{ fontSize: 10 }}>{g.stepIds.join(', ') || '-'}</td>
              <td style={{ fontSize: 11 }}>{g.suggestion}</td>
              <td style={{ fontSize: 11 }}>{r ? ({ open: '열림', needsHuman: '사람 확인 필요', humanConfirmed: '사람 확인됨', resolved: '해결', hidden: '숨김' } as const)[r.status] : '미분석'}</td>
              <td style={{ whiteSpace: 'nowrap' }}><button className="small" onClick={() => onGo(g)}>이동</button>
                {g.safety && <button className="small" onClick={() => onReview(g.id, 'humanConfirmed')}>사람 확인</button>}
                <button className="small" onClick={() => onReview(g.id, 'hidden')}>숨김</button></td>
            </tr>); })}
          {vanishedSafety.map(([id, r]) => <tr key={id}><td><Badge kind="warn">간섭 후보</Badge></td><td><Badge kind="warn">조건 변경</Badge></td><td className="mono" style={{ fontSize: 11 }}>{id}</td><td style={{ fontSize: 11 }}>{r.lastEvidence}</td><td /><td style={{ fontSize: 11 }}>자동 종료 안 함 — 사람이 확인</td><td>사람 확인 필요</td><td><button className="small" onClick={() => onReview(id, 'humanConfirmed')}>사람 확인</button></td></tr>)}
          {showResolved && resolved.map(([id, r]) => <tr key={id} style={{ opacity: .6 }}><td colSpan={2}><Badge kind="ok">해결</Badge></td><td className="mono" style={{ fontSize: 11 }}>{id}</td><td style={{ fontSize: 11 }}>이전 근거: {r.lastEvidence}</td><td colSpan={3} style={{ fontSize: 11 }}>rev {r.firstSeenRevision}에 발견 → rev {r.resolvedRevision}에 해결</td><td /></tr>)}
          {Object.entries(review).filter(([, r]) => r.status === 'hidden').map(([id]) => <tr key={id} style={{ opacity: .5 }}><td colSpan={7} className="mono" style={{ fontSize: 11 }}>숨김: {id} (해결 아님)</td><td><button className="small" onClick={() => onReview(id, 'open')}>복원</button></td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- F4 Material & Flow ----------------
export function MaterialPanel({ p, locked, edit }: { p: Project; locked: boolean; edit: EditFn }) {
  const m = p.materials[0];
  const [addUnit, setAddUnit] = useState('');
  if (!m) return <div><div className="muted">자재 정의 없음</div><button disabled={locked} onClick={() => edit(C.addMaterial(p), '자재 추가')}>+ 자재 정의</button></div>;
  const route = m.route;
  const setRoute = (r: string[]) => edit(C.updateMaterial(p, m.id, { route: r }), '경로 변경');
  return (
    <div className="cols">
      <div style={{ width: 360, overflow: 'auto', borderRight: '1px solid var(--border)', paddingRight: 8 }}>
        <div className="row"><label>자재 이름</label><TextInput value={m.name} disabled={locked} onCommit={(v) => edit(C.renameObject(p, m.id, v), '자재 이름')} /><span className="mono muted">{m.id}</span></div>
        <div className="row"><label>종류</label><select disabled={locked} value={m.kind} onChange={(e) => edit(C.updateMaterial(p, m.id, { kind: e.target.value as 'individual' | 'carrier' }), '자재 종류')}><option value="individual">개별 자재</option><option value="carrier">캐리어</option></select><span className="muted" style={{ fontSize: 11 }}>캐리어-적재 관계 편집 미구현</span></div>
        <div className="row"><label>크기 W/L/H</label></div>
        {(['w', 'l', 'h'] as const).map((k) => <div key={k} className="row"><label style={{ textAlign: 'right' }}>{k.toUpperCase()}</label><QtyInput q={m.size[k]} disabled={locked} onCommit={(v, as) => edit(C.setQuantity(p, { kind: 'material', id: m.id, field: k }, v, as), '자재 크기')} /></div>)}
        <div className="row"><label>무게</label><QtyInput q={m.weight} disabled={locked} onCommit={(v, as) => edit(C.setQuantity(p, { kind: 'material', id: m.id, field: 'weight' }, v, as), '자재 무게')} /></div>
        <div className="row"><label>취급 조건</label><TextInput value={m.handling} disabled={locked} onCommit={(v) => edit(C.updateMaterial(p, m.id, { handling: v }), '취급 조건')} /></div>
        <div className="row"><label>투입 간격</label><QtyInput q={m.feedInterval} disabled={locked} onCommit={(v, as) => edit(C.setQuantity(p, { kind: 'material', id: m.id, field: 'feedInterval' }, v, as), '투입 간격')} /></div>
        <div className="row"><label>상태집합</label><TextInput value={m.states.join(', ')} width={210} disabled={locked} onCommit={(v) => edit(C.updateMaterial(p, m.id, { states: v.split(',').map((x) => x.trim()).filter(Boolean) }), '상태집합')} /></div>
        <div className="row"><label>초기 상태</label><select disabled={locked} value={m.initialState ?? ''} onChange={(e) => edit(C.updateMaterial(p, m.id, { initialState: e.target.value || null }), '초기 상태')}><option value="">(미정)</option>{m.states.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div className="row"><label>초기 위치</label><select disabled={locked} value={m.initialLocation ?? ''} onChange={(e) => edit(C.updateMaterial(p, m.id, { initialLocation: e.target.value || null }), '초기 위치')}><option value="">(미정)</option>{p.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div className="muted" style={{ fontSize: 11 }}>설계 정의(Material)와 실행 중 개체(M#1)는 분리됩니다. 이번 시제품 실행은 자재 1개만 지원.</div>
      </div>
      <div style={{ width: 300, overflow: 'auto', borderRight: '1px solid var(--border)', paddingRight: 8 }}>
        <b style={{ fontSize: 12 }}>Unit 경로 (순서)</b>
        {route.map((uid, i) => <div key={`${uid}-${i}`} className="row" style={{ minHeight: 24 }}><span className="mono">{i + 1}.</span><span style={{ flex: 1 }}>{unitName(p, uid)}</span>
          <button className="small" disabled={locked || i === 0} onClick={() => { const r = [...route]; [r[i - 1], r[i]] = [r[i], r[i - 1]]; setRoute(r); }}>↑</button>
          <button className="small" disabled={locked || i === route.length - 1} onClick={() => { const r = [...route]; [r[i + 1], r[i]] = [r[i], r[i + 1]]; setRoute(r); }}>↓</button>
          <button className="small danger" disabled={locked} onClick={() => setRoute(route.filter((_, j) => j !== i))}>×</button></div>)}
        <div className="row"><select value={addUnit} disabled={locked} onChange={(e) => setAddUnit(e.target.value)}><option value="">Unit 선택</option>{p.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select><button className="small" disabled={locked || !addUnit} onClick={() => { setRoute([...route, addUnit]); setAddUnit(''); }}>+ 경로 추가</button></div>
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>물류 연결선(캔버스)은 자재를 자동 이동시키지 않음. 이동은 Action 자재 변화로만.</div>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <b style={{ fontSize: 12 }}>상태전이 ↔ Action/post 연결 (F4-03)</b>
        <table className="grid"><thead><tr><th>Action</th><th>전제</th><th>자재 변화</th><th>post 검증</th></tr></thead>
          <tbody>{p.actions.filter((a) => a.effect.moveTo || a.effect.setState || a.effect.holder !== undefined).map((a) => <tr key={a.id}><td style={{ fontSize: 12 }}>{a.name}</td><td style={{ fontSize: 11 }}>{a.pre.map((c) => condLabel(p, c)).join('; ') || '-'}</td><td style={{ fontSize: 11 }}>{effectLabel(p, a.effect)}</td><td style={{ fontSize: 11 }}>{a.post.map((c) => condLabel(p, c)).join('; ') || '-'}</td></tr>)}</tbody></table>
        <b style={{ fontSize: 12, display: 'block', marginTop: 8 }}>Unit 수용 능력</b>
        <table className="grid"><thead><tr><th>Unit</th><th>수용 개수</th><th>허용 무게</th></tr></thead>
          <tbody>{p.units.map((u) => <tr key={u.id}><td>{u.name}</td><td>{u.capacity.maxMaterials.value ?? <Badge kind="warn">미정</Badge>}{u.capacity.maxMaterials.assumption ? ' (가정)' : ''}</td><td>{u.capacity.maxWeight.value ?? <Badge kind="warn">미정</Badge>} kg{u.capacity.maxWeight.assumption ? ' (가정)' : ''}</td></tr>)}</tbody></table>
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
        <div className="row"><label>이름</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="예) SEN-02" /></div>
        {targetKind === 'device' && <>
          <div className="row"><label>종류</label><select value={kind} onChange={(e) => setKind(e.target.value as AssetKind)}>{ASSET_LIBRARY.filter((a) => !a.template).map((a) => <option key={a.kind} value={a.kind}>{a.name}</option>)}</select></div>
          <div className="row"><label>소속 Unit</label><select value={unitId} onChange={(e) => setUnitId(e.target.value)}><option value="">(미배정)</option>{p.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        </>}
        <div className="row"><label>신뢰도</label><select value={level} onChange={(e) => setLevel(e.target.value as typeof level)}><option value="direct">직접 지정</option><option value="high">높음</option><option value="medium">중간</option><option value="low">낮음</option></select></div>
        <button disabled={locked || !name.trim()} onClick={() => { const c = newCandidate(targetKind, name.trim(), targetKind === 'device' ? kind : null, targetKind === 'device' ? unitId || null : null, level); const n = structuredClone(p); n.candidates.push(c); n.revision += 1; if (edit({ ok: true, project: n }, '후보 추가')) setName(''); }}>+ 후보표에 추가</button>
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>후보는 사람이 확인하기 전 모델에 반영되지 않습니다.</div>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table className="grid"><thead><tr><th>후보 ID</th><th>대상</th><th>이름</th><th>종류</th><th>소속 Unit</th><th>출처</th><th>신뢰 근거</th><th>확인</th><th>반영 ID</th></tr></thead>
          <tbody>{p.candidates.map((c) => <tr key={c.id}>
            <td className="mono" style={{ fontSize: 10 }}>{c.id}</td><td>{c.targetKind}</td><td>{c.name}</td><td>{c.deviceKind ?? '-'}</td>
            <td>{c.targetKind === 'device' ? <select disabled={locked || !!c.appliedObjectId} value={c.assignedUnitId ?? ''} onChange={(e) => setCand(c.id, { assignedUnitId: e.target.value || null })}><option value="">(미배정)</option>{p.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select> : '-'}</td>
            <td style={{ fontSize: 11 }}>{c.sourceRefs.map((s) => s.note ?? s.method).join(', ')}</td>
            <td style={{ fontSize: 11 }}>{c.confidence.level} · {c.confidence.basis}</td>
            <td style={{ whiteSpace: 'nowrap' }}><Badge kind={c.confirmation === 'confirmed' ? 'ok' : c.confirmation === 'rejected' ? 'err' : 'warn'}>{c.confirmation}</Badge>
              {!c.appliedObjectId && <><button className="small" disabled={locked} onClick={() => setCand(c.id, { confirmation: 'confirmed' })}>확인</button><button className="small" disabled={locked} onClick={() => setCand(c.id, { confirmation: 'rejected' })}>거절</button></>}</td>
            <td className="mono" style={{ fontSize: 10 }}>{c.appliedObjectId ?? '-'}</td></tr>)}
            {p.candidates.length === 0 && <tr><td colSpan={9} className="muted">후보 없음</td></tr>}</tbody></table>
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
  const steps = p.sequence.steps; const H = 46;
  return (
    <div>
      <div className="notice">SequenceDraft의 순차 SFC 미리보기 (단계 = 사각형, 전이 = 가로선: 완료 조건). SFC 세부 표현·분기/병렬 의미·SequenceDesigner 매핑은 미정 — 표시 전용.</div>
      <svg width={760} height={steps.length * H + 60}>
        <rect x={20} y={6} width={160} height={24} fill="none" stroke="var(--text)" strokeWidth={2} /><rect x={23} y={9} width={154} height={18} fill="none" stroke="var(--text)" /><text x={100} y={22} fontSize={11} textAnchor="middle" fill="var(--text)">초기 단계</text>
        {steps.map((s, i) => { const a = p.actions.find((x) => x.id === s.actionId); const y = 30 + i * H; const st = rt?.steps.find((r) => r.stepId === s.id)?.status;
          return <g key={s.id}>
            <line x1={100} y1={y} x2={100} y2={y + 18} stroke="var(--text)" />
            <line x1={88} y1={y + 9} x2={112} y2={y + 9} stroke="var(--text)" strokeWidth={2} />
            <text x={120} y={y + 13} fontSize={10} fill="var(--muted)">{i === 0 ? '실행 시작' : `${sigName(p, p.actions.find((x) => x.id === steps[i - 1].actionId)?.completeSignalId)} = true`}{a && a.pre.length ? ` ∧ ${a.pre.map((c) => condLabel(p, c)).join(' ∧ ')}` : ''}</text>
            <rect x={20} y={y + 18} width={160} height={24} fill={st === 'active' ? 'var(--selected)' : st === 'done' ? 'var(--grid)' : 'var(--panel)'} stroke={st === 'error' ? 'var(--danger)' : 'var(--text)'} />
            <text x={26} y={y + 34} fontSize={11} fill="var(--text)">{String(i + 1).padStart(2, '0')} {s.name.slice(0, 20)}</text>
          </g>; })}
        <line x1={100} y1={30 + steps.length * H} x2={100} y2={44 + steps.length * H} stroke="var(--text)" />
        <text x={110} y={48 + steps.length * H} fontSize={10} fill="var(--muted)">종료 (마지막 완료 조건)</text>
      </svg>
    </div>
  );
}

// ---------------- F8 preview ----------------
export function ExportPanel({ p }: { p: Project }) {
  const rows = buildExportPreview(p);
  return (
    <div>
      <div className="notice err">F8 매핑 <b>미리보기 전용</b>. 실제 Aurora Core 스키마·버전이 확인되지 않아 실제 Export, SignalMap 생성, 역매핑(실측 교체)은 구현하지 않았습니다. “검증된 실제 연동”이 아닙니다.</div>
      <table className="grid"><thead><tr><th>분류</th><th>원본 ID</th><th>이름</th><th>목적지(후보)</th><th>상태</th><th>비고/가정</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><td>{r.category}</td><td className="mono" style={{ fontSize: 10 }}>{r.sourceId}</td><td style={{ fontSize: 12 }}>{r.name}</td><td style={{ fontSize: 11 }}>{r.target}</td>
          <td>{r.status === 'ready' ? <Badge kind="ok">준비</Badge> : r.status === 'assumption' ? <Badge kind="warn">가정 포함</Badge> : r.status === 'notInTarget' ? <Badge>대상 없음·보관</Badge> : <Badge kind="warn">미정</Badge>}</td><td style={{ fontSize: 11 }}>{r.note}</td></tr>)}</tbody></table>
    </div>
  );
}

export function LabPanel() {
  return <div className="notice warn" style={{ fontSize: 13 }}>
    <b>F7 Evolution Lab — 이번 시제품에서 미구현</b><br />
    변형 공간 정의, 후보 세대 생성·평가, Pareto/세대 최고점수, 명시 적용은 구현하지 않았습니다. AI 최적화·VC 평가도 없습니다.
    현재는 Gap 탭의 경량 타이밍 판정(가정 시간 합계)만 있습니다. 세대 알고리즘·후보 수·가중치·비용 상한 결정(Q13) 후 착수가 필요합니다.
  </div>;
}

// ---------------- Diagnostics / storage / AML ----------------
export function DiagPanel({ p, storageReason, quarantineList, onDownload }: { p: Project; storageReason: string | null; quarantineList: QuarantineEntry[]; onDownload: (name: string, text: string, mime?: string) => void }) {
  const diags = validateProject(p);
  return (
    <div className="cols">
      <div style={{ flex: 1, overflow: 'auto' }}>
        <b style={{ fontSize: 12 }}>참조 무결성 진단 (D04)</b>
        {diags.length === 0 ? <div className="row"><Badge kind="ok">오류 없음</Badge></div> : diags.map((d) => <div key={d.id} style={{ fontSize: 11, color: d.severity === 'error' ? 'var(--danger)' : 'var(--warning)' }}>[{d.code}] {d.objectId}: {d.message}</div>)}
        <b style={{ fontSize: 12, display: 'block', marginTop: 8 }}>저장소</b>
        <div style={{ fontSize: 12 }}>{storageReason ? <span style={{ color: 'var(--warning)' }}>{storageReason} → 메모리 전용. JSON 내보내기로 보관하세요.</span> : 'Browser localStorage 사용 가능 (이 브라우저·이 파일 위치 기준). 다른 PC/브라우저와 공유되지 않음.'}</div>
        <b style={{ fontSize: 12, display: 'block', marginTop: 8 }}>가정 메모</b>
        {p.assumptionsNote.map((n, i) => <div key={i} style={{ fontSize: 11 }}>• {n}</div>)}
      </div>
      <div style={{ width: 300, overflow: 'auto', borderLeft: '1px solid var(--border)', paddingLeft: 8 }}>
        <b style={{ fontSize: 12 }}>격리 보관함 (거부된 가져오기 원본)</b>
        {quarantineList.length === 0 && <div className="muted" style={{ fontSize: 11 }}>없음</div>}
        {quarantineList.map((q, i) => <div key={i} style={{ fontSize: 11, borderBottom: '1px solid var(--border)', padding: '3px 0' }}>{q.at} · {q.label}<div style={{ color: 'var(--danger)' }}>{q.errors.slice(0, 2).join(' / ')}</div><button className="small" onClick={() => onDownload(`quarantine-${i}-${q.label}`, q.raw, 'application/octet-stream')}>원본 그대로 다운로드</button></div>)}
        <b style={{ fontSize: 12, display: 'block', marginTop: 8 }}>에셋 AML 라이브러리 ({ASSET_LIBRARY.length}종)</b>
        <div className="muted" style={{ fontSize: 10 }}>라이브러리는 AML 파일에서 읽음 (앱 상수 목록 없음). 내보내기 = 현재 로드된 정의 전체를 CAEX 3.0 한 파일로 직렬화.</div>
        <button className="small" onClick={() => onDownload('ecd-library-export.aml', exportLibraryAml(), 'application/xml')}>AML 라이브러리 내보내기</button>
        <AmlLoadStatus libVersion={ASSET_LIBRARY.length} />
      </div>
    </div>
  );
}
