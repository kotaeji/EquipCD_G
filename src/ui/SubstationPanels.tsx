// v0.3 Substation (= Unit) multi-sequence editor and group run panel (N02). Group runtime rules are 설계 제안.
import { useState } from 'react';
import * as C from '../model/commands';
import type { Project } from '../model/types';
import { GROUP_RULES_VERSION } from '../model/types';
import { checkGroupReadiness, type GroupState } from '../runtime/group';
import type { EditFn } from './Inspector';
import { devName, sigName } from './labels';
import { fmtTime } from './Panels';
import { Badge, TextInput } from './widgets';

export const STATION = 'Station';
export const SUBSTATION = 'Substation';
export const stationLabel = (p: Project) => `${p.equipment.name} (${STATION})`;
export const subLabel = (name: string) => `${name}`;

export function SubstationSelect({ p, value, onChange }: { p: Project; value: string; onChange: (id: string) => void }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Substation 선택">
    {p.units.length === 0 && <option value="">(Substation 없음)</option>}
    {p.units.map((u) => <option key={u.id} value={u.id}>{u.name} · 시퀀스 {(p.substationSequences ?? []).filter((q) => q.unitId === u.id).length}</option>)}
  </select>;
}

const LANE_BADGE: Record<string, ['ok' | 'warn' | 'err' | 'acc' | undefined, string]> = {
  pending: [undefined, '대기'], active: ['acc', '진행 중'], done: ['ok', '완료'], error: ['err', '오류'], stopped: ['warn', '그룹 정지'],
};

export function SubSequencePanel({ p, unitId, setUnitId, locked, edit, gs }: { p: Project; unitId: string; setUnitId: (id: string) => void; locked: boolean; edit: EditFn; gs: GroupState | null }) {
  const unit = p.units.find((u) => u.id === unitId);
  const seqs = (p.substationSequences ?? []).filter((q) => q.unitId === unitId);
  const acts = p.actions.filter((a) => p.devices.find((d) => d.id === a.deviceId)?.unitId === unitId);
  const [pick, setPick] = useState<Record<string, string>>({});
  const ready = unit ? checkGroupReadiness(p, unitId) : null;
  if (!unit) return <div className="empty"><b>Substation이 없습니다</b><div className="muted">1 라이브러리에서 유닛 템플릿을 추가하거나 2 배치에서 빈 Unit(Substation)을 놓은 뒤 여기서 시퀀스를 만드세요.</div></div>;
  return <div className="subseq">
    <div className="row wrap" style={{ gap: 8 }}>
      <b>{SUBSTATION}</b><SubstationSelect p={p} value={unitId} onChange={setUnitId} />
      <button className="primary" disabled={locked} onClick={() => edit(C.addSubSequence(p, unitId), 'Substation 시퀀스 추가')}>+ 시퀀스 추가</button>
      <span className="muted small-text">이 Substation 안의 시퀀스들은 6 실행 단계에서 함께 Play / Pause / Resume / Reset 됩니다 (그룹 실행, 설계 제안). Station 시퀀스(기존 단일 시퀀스)와 별개입니다.</span>
    </div>
    {locked && <div className="notice warn">실행 중 — 조회만 가능, 시퀀스 편집 차단</div>}
    {ready && <div className={`notice ${ready.ok ? '' : 'err'}`} role="status">
      그룹 실행 전 검사: {ready.ok ? <b>통과</b> : <b>차단 {ready.blockers.length}건</b>} <span className="muted">(규칙 {GROUP_RULES_VERSION})</span>
      {!ready.ok && <ul className="diaglist">{ready.blockers.slice(0, 8).map((b) => <li key={b.id}><span className="mono">[{b.code}]</span> {b.message}</li>)}</ul>}
    </div>}
    {seqs.length === 0 && <div className="empty"><b>{unit.name}에 Substation 시퀀스가 없습니다</b><div className="muted">“+ 시퀀스 추가”로 만들고, 이 Substation 소속 Device의 Action을 단계로 넣으세요.</div></div>}
    <div className="seqgrid">
      {seqs.map((q) => {
        const lane = gs?.lanes.find((l) => l.seqId === q.id);
        return <section key={q.id} className="seqcard" aria-label={q.name}>
          <header className="row" style={{ gap: 6 }}>
            <TextInput value={q.name} disabled={locked} width={220} onCommit={(v) => edit(C.renameSubSequence(p, q.id, v), '시퀀스 이름')} />
            {lane && <Badge kind={LANE_BADGE[lane.status][0]}>{LANE_BADGE[lane.status][1]}</Badge>}
            <span className="grow" />
            <span className="mono muted" style={{ fontSize: 10 }}>{q.id}</span>
            <button className="small danger" disabled={locked} onClick={() => edit(C.deleteSubSequence(p, q.id), '시퀀스 삭제')} aria-label={`${q.name} 삭제`}>삭제</button>
          </header>
          <table className="grid"><thead><tr><th>#</th><th>단계</th><th>Device</th><th>완료 Signal</th><th>시간</th><th></th></tr></thead><tbody>
            {q.steps.map((s, i) => { const a = p.actions.find((x) => x.id === s.actionId); const rec = lane?.steps[i]; return (
              <tr key={s.id} className={rec?.status === 'active' ? 'active' : rec?.status === 'error' ? 'err' : ''}>
                <td className="mono">{i + 1}</td><td>{s.name}</td><td>{a ? devName(p, a.deviceId) : <Badge kind="err">Action 없음</Badge>}</td>
                <td style={{ fontSize: 11 }}>{a?.completeSignalId ? sigName(p, a.completeSignalId) : <Badge kind="warn">미정</Badge>}</td>
                <td className="mono">{a?.duration.value ?? '미정'}s{a?.duration.assumption ? <span className="muted"> (가정)</span> : ''}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="small" disabled={locked || i === 0} onClick={() => edit(C.moveSubStep(p, q.id, i, i - 1), '단계 위로')} aria-label="위로">↑</button>
                  <button className="small" disabled={locked || i === q.steps.length - 1} onClick={() => edit(C.moveSubStep(p, q.id, i, i + 1), '단계 아래로')} aria-label="아래로">↓</button>
                  <button className="small danger" disabled={locked} onClick={() => edit(C.removeSubStep(p, q.id, s.id), '단계 삭제')} aria-label="단계 삭제">×</button></td>
              </tr>); })}
            {q.steps.length === 0 && <tr><td colSpan={6} className="muted">단계 없음 — 아래에서 Action을 추가하세요 (단계 없는 시퀀스는 실행 차단)</td></tr>}
          </tbody></table>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <select value={pick[q.id] ?? ''} disabled={locked} onChange={(e) => setPick({ ...pick, [q.id]: e.target.value })} aria-label="추가할 Action">
              <option value="">(이 Substation의 Action 선택)</option>
              {acts.map((a) => <option key={a.id} value={a.id}>{devName(p, a.deviceId)} · {a.name}</option>)}
            </select>
            <button className="small" disabled={locked || !pick[q.id]} onClick={() => { if (edit(C.addSubStep(p, q.id, pick[q.id]), '단계 추가')) setPick({ ...pick, [q.id]: '' }); }}>단계 추가</button>
          </div>
        </section>; })}
    </div>
  </div>;
}

export function GroupRunPanel({ p, gs, unitId }: { p: Project; gs: GroupState | null; unitId: string }) {
  const unit = p.units.find((u) => u.id === unitId);
  const seqs = (p.substationSequences ?? []).filter((q) => q.unitId === unitId);
  const ready = unit ? checkGroupReadiness(p, unitId) : null;
  return <div>
    <div className="section"><h4>그룹 실행 — {unit ? unit.name : '(Substation 없음)'} ({SUBSTATION})</h4>
      <div className="row wrap" style={{ gap: 8 }}>
        <span>공통 가상 시계 <b className="mono">{fmtTime(gs?.timeMs ?? 0)}</b></span>
        <Badge kind={gs?.status === 'completed' ? 'ok' : gs?.status === 'error' ? 'err' : gs?.status === 'running' ? 'acc' : gs?.status === 'paused' ? 'warn' : undefined}>그룹 {gs?.status ?? 'idle'}</Badge>
        {gs && <span className="muted small-text">실행 묶음 {gs.runId} · 모델 rev {gs.modelRevision}</span>}
      </div>
      <div className="muted small-text">시작 대상 시퀀스 {seqs.length}개: {seqs.map((q) => q.name).join(', ') || '없음'}. 일시정지는 묶음 전체를 동결하고, 재개는 남은 시간부터 이어 갑니다. 한 시퀀스 오류 시 묶음 전체 정지(보수적 정책, 설계 제안).</div>
    </div>
    {ready && !ready.ok && (!gs || gs.status === 'idle') && <div className="section"><h4>실행 전 검사 — 차단 {ready.blockers.length}건</h4>
      <ul className="diaglist">{ready.blockers.map((b) => <li key={b.id} className="err-text"><span className="mono">[{b.code}]</span> {b.message}</li>)}</ul>
      <div className="muted small-text">충돌은 임의 우선순위로 진행하지 않고 실행 전에 차단합니다. 3 시퀀스 단계 → “Substation 시퀀스”에서 수정하세요.</div></div>}
    {gs?.error && <div className="notice err" role="alert">[{gs.error.code}] {gs.error.message}</div>}
    <div className="section"><h4>시퀀스별 상태</h4>
      <table className="grid"><thead><tr><th>시퀀스</th><th>상태</th><th>현재 단계</th><th>진행</th><th>종료 시각</th></tr></thead><tbody>
        {(gs?.lanes ?? seqs.map((q) => ({ seqId: q.id, name: q.name, status: 'pending', stepIndex: 0, steps: q.steps.map((s) => ({ stepId: s.id, status: 'pending' })), endMs: undefined, active: null }))).map((l) => {
          const q = seqs.find((x) => x.id === l.seqId); const cur = q?.steps[Math.min(l.stepIndex, (q?.steps.length ?? 1) - 1)];
          const done = l.steps.filter((s) => s.status === 'done').length;
          return <tr key={l.seqId} className={l.status === 'error' ? 'err' : l.status === 'active' ? 'active' : ''}>
            <td>{l.name}</td><td><Badge kind={LANE_BADGE[l.status][0]}>{LANE_BADGE[l.status][1]}</Badge></td>
            <td>{l.status === 'done' ? '—' : cur?.name ?? '—'}</td><td className="mono">{done}/{l.steps.length}</td><td className="mono">{l.endMs !== undefined ? fmtTime(l.endMs) : '—'}</td></tr>; })}
        {seqs.length === 0 && <tr><td colSpan={5} className="muted">이 Substation에 시퀀스가 없습니다.</td></tr>}
      </tbody></table></div>
    <div className="section"><h4>공통 로그 ({gs?.log.length ?? 0})</h4>
      <div className="logbox" tabIndex={0} aria-label="그룹 실행 로그">
        {(gs?.log ?? []).map((e, i) => <div key={i} className={e.level === 'error' ? 'err-text' : ''}><span className="mono muted">{fmtTime(e.t)}</span> <span className="mono">{e.code}</span> {e.message}</div>)}
        {!gs?.log.length && <div className="muted">아직 실행 기록이 없습니다. ▶ 그룹 실행으로 시작하세요.</div>}
      </div></div>
  </div>;
}
