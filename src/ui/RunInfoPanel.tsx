import { findAsset } from '../assets/library';
import type { Project } from '../model/types';
import type { RuntimeState } from '../runtime/engine';
import { describeScene, faultDeviceIds, activeDeviceIds } from '../scene/describe';
import { describeRunInfo } from '../scene/runInfo';
import { stepStatusLabel } from '../runtime/runSummary';

const RUN_STATUS_KO: Record<string, string> = {
  idle: '대기', running: '실행 중', paused: '일시정지', completed: '완료', error: '오류',
};

function deviceState(p: Project, rt: RuntimeState | null, deviceId: string): string {
  if (faultDeviceIds(p, rt).includes(deviceId)) return '오류';
  if (activeDeviceIds(p, rt).includes(deviceId)) return '동작 중';
  const records = (rt?.steps ?? []).filter((rec) => {
    const step = p.sequence.steps.find((s) => s.id === rec.stepId)
      ?? (p.substationSequences ?? []).flatMap((q) => q.steps).find((s) => s.id === rec.stepId);
    const action = step ? p.actions.find((a) => a.id === step.actionId) : undefined;
    return action?.deviceId === deviceId && rec.status !== 'pending';
  });
  const last = records[records.length - 1];
  return last ? stepStatusLabel(last.status) : '대기';
}

/** Left column of the 3D run view. */
export function RunInfoPanel({ p, rt, selectedId, folded, onToggleFold, onOpenGaps }: { p: Project; rt: RuntimeState | null; selectedId: string | null; folded: boolean; onToggleFold: () => void; onOpenGaps: () => void }) {
  const info = describeRunInfo(p, rt);
  const scene = describeScene(p, rt);
  const maxMs = Math.max(1, ...info.bars.map((bar) => bar.widthMs));
  const unitMax = Math.max(1, ...info.unitTotals.map((row) => row.ms));
  const device = selectedId ? p.devices.find((d) => d.id === selectedId) : undefined;
  const unit = device ? p.units.find((u) => u.id === device.unitId) : undefined;
  return (
    <aside className={`run-info ${folded ? 'is-folded' : ''}`} aria-label="정보 표시">
      <div className="run3d-head">
        <h2>정보 표시</h2>
        <button type="button" className="small" aria-label={folded ? '정보 펼치기' : '정보 접기'} onClick={onToggleFold}>{folded ? '펼치기' : '접기'}</button>
      </div>
      {!folded && <>
      <p className="run3d-name" data-project-name="">{info.projectName}</p>
      <p className="run3d-counts">Unit {info.unitCount} · Device {info.deviceCount} · 단계 {info.stepCount}</p>
      <dl className="run3d-facts">
        <div><dt>실행 상태</dt><dd data-run-status={info.status}>{RUN_STATUS_KO[info.status] ?? info.status}</dd></div>
        <div><dt>가상 시간</dt><dd className="mono" data-run-time="">{info.timeText}</dd></div>
      </dl>
      <section aria-label="사이클 시간">
        <h3>사이클 시간</h3>
        <p className="mono run3d-metric" data-cycle-time="" aria-label="사이클 시간">{info.cycleText}</p>
      </section>
      <section aria-label="시간당 생산량">
        <h3>시간당 생산량(가정)</h3>
        <p className="mono run3d-metric" data-throughput="" aria-label="시간당 생산량">{info.throughputText}</p>
        <p className="run3d-note" data-throughput-note="">{info.throughputNote}</p>
      </section>
      <section aria-label="병목 Unit">
        {info.bottleneck
          ? <p className="run3d-longest" data-bottleneck={info.bottleneck.unitId} aria-label="병목 Unit">병목 {info.bottleneck.name} {info.bottleneck.timeText}</p>
          : <p className="muted">Unit 없음</p>}
      </section>
      <section aria-label="Gap">
        <p data-gap-total={info.gapTotal} aria-label="Gap 건수">Gap 전체 {info.gapTotal}건</p>
        <ul className="run3d-gap-kinds">
          {info.gapKinds.map((row) => <li key={row.kind} data-gap-kind={row.kind} data-gap-count={row.count}>{row.label} {row.count}</li>)}
        </ul>
        <button type="button" className="run3d-gap-open" aria-label="5단계에서 보기" onClick={onOpenGaps}>5단계에서 보기</button>
      </section>
      <section aria-label="Unit 별 합계">
        <h3>Unit 별 합계</h3>
        <ul className="run3d-bars units">
          {info.unitTotals.map((row) => (
            <li key={row.unitId} className={info.bottleneck?.unitId === row.unitId ? 'is-bottleneck' : ''} data-unit-total={row.unitId}>
              <span className="run3d-bar-name" title={row.name}>{row.name}{info.bottleneck?.unitId === row.unitId ? ' · 병목' : ''}</span>
              <span className="run3d-bar-track" aria-hidden="true"><span className="run3d-bar-fill" style={{ width: `${Math.min(100, (row.ms / unitMax) * 100)}%` }} /></span>
              <span className="mono run3d-bar-time">{row.timeText}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="실행 중 단계">
        <h3>실행 중 단계</h3>
        {info.running.length === 0 && <p className="muted">진행 중인 단계 없음</p>}
        <ul className="run3d-list">
          {info.running.map((row, i) => <li key={`${row.name}:${i}`}>{row.lane ? `${row.lane} · ` : ''}{row.name}</li>)}
        </ul>
      </section>
      <section aria-label="자재" data-material="">
        <h3>자재</h3>
        {info.material
          ? <p>{info.material.where} · {info.material.state || '상태 없음'}</p>
          : <p className="muted">자재 없음</p>}
      </section>
      <section aria-label="단계별 시간">
        <h3>단계별 시간</h3>
        {info.longestText && <p className="run3d-longest" data-longest="">{info.longestText}</p>}
        <ul className="run3d-bars">
          {info.bars.map((bar) => (
            <li key={bar.key} className={bar.longest ? 'is-longest' : ''} data-step-id={bar.stepId} data-elapsed={bar.timeText}>
              <span className="run3d-bar-name" title={bar.name}>{bar.name}{bar.lane ? ` · ${bar.lane}` : ''}{bar.pass ? ` · ${bar.pass}회` : ''}</span>
              <span className="run3d-bar-status">{bar.statusLabel}</span>
              <span className="run3d-bar-track" aria-hidden="true"><span className="run3d-bar-fill" style={{ width: `${Math.min(100, (bar.widthMs / maxMs) * 100)}%` }} /></span>
              <span className="mono run3d-bar-time">{bar.timeText}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="선택한 Device">
        <h3>선택한 Device</h3>
        {device
          ? <p data-selected-device="">{device.name} · {findAsset(device.kind)?.name ?? device.kind} · {unit?.name ?? device.unitId} · {deviceState(p, rt, device.id)}</p>
          : <p className="muted">Device를 누르면 여기에 나옵니다</p>}
      </section>
      <p className="run3d-note">{info.assumed ? '실행 전 막대는 Action의 가정 동작 시간입니다. ' : ''}시간 · 속도는 가정값입니다. 실제 택트가 아닙니다.</p>
      <p className="muted run3d-note">장면의 구역 {scene.zones.length} · 장치 {scene.solids.length}</p>
      </>}
    </aside>
  );
}
