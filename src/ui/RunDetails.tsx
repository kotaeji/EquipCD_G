import type { Project } from '../model/types';
import type { RuntimeState } from '../runtime/engine';
import { formatMs } from '../scene/runInfo';
import { fmtTime } from './Panels';
import { RunSummary } from './RunSummary';
import { Tabs } from './Tabs';
import type { RunDetailsTab } from './viewSettings';

function RunLog({ rt }: { rt: RuntimeState | null }) {
  const rows = [...(rt?.log ?? [])].reverse();
  return (
    <div className="log-list" aria-label="실행 로그">
      <table className="grid">
        <thead><tr><th>가상 시각</th><th>코드</th><th>내용</th></tr></thead>
        <tbody>
          {rows.map((line, i) => <tr key={i} className={line.level === 'error' ? 'err' : ''}>
            <td className="mono">{fmtTime(line.t)}</td>
            <td className="mono">{line.code}</td>
            <td>{line.message}</td>
          </tr>)}
          {rows.length === 0 && <tr><td colSpan={3} className="muted">로그 없음. 실행을 누르면 이 세션의 기록이 쌓입니다.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function pieceStatus(phase: string): string {
  if (phase === 'done') return '완료';
  if (phase === 'active') return '진행 중';
  return '대기';
}

function PieceTable({ rt }: { rt: RuntimeState | null }) {
  const rows = rt?.pieces ?? [];
  if (rows.length < 2) return null;
  const now = rt?.timeMs ?? 0;
  return (
    <table className="grid" aria-label="개체별 시간">
      <thead><tr><th>개체</th><th>투입 시각</th><th>배출 시각</th><th>기다린 시간</th><th>상태</th></tr></thead>
      <tbody>
        {rows.map((pc) => {
          const open = pc.wait ? Math.max(0, now - pc.wait.sinceMs) : 0;
          return (
            <tr key={pc.instanceId} data-piece-row={pc.instanceId}>
              <td>개체 {pc.index}</td>
              <td className="mono">{pc.fedAtMs == null ? '-' : formatMs(pc.fedAtMs)}</td>
              <td className="mono">{pc.exitedAtMs == null ? '-' : formatMs(pc.exitedAtMs)}</td>
              <td className="mono" data-piece-wait="">{formatMs(pc.waitMs + open)}</td>
              <td>{pieceStatus(pc.phase)}{pc.wait ? ` · ${pc.wait.note}` : ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RunSignals({ p, rt }: { p: Project; rt: RuntimeState | null }) {
  return (
    <table className="grid" aria-label="신호 상태">
      <thead><tr><th>신호</th><th>상태</th></tr></thead>
      <tbody>
        {p.signals.map((signal) => <tr key={signal.id} data-signal={signal.id}>
          <td>{signal.name}</td>
          <td>{rt?.signals[signal.id] ? 'ON' : 'OFF'}</td>
        </tr>)}
        {p.signals.length === 0 && <tr><td colSpan={2} className="muted">신호 없음</td></tr>}
      </tbody>
    </table>
  );
}

/** Collapsed by default under the canvas. Summary, the full log, and signal state. */
export function RunDetails({ p, rt, open, tab, onToggle, onTab }: {
  p: Project;
  rt: RuntimeState | null;
  open: boolean;
  tab: RunDetailsTab;
  onToggle: () => void;
  onTab: (id: RunDetailsTab) => void;
}) {
  const last = rt?.log?.length ? rt.log[rt.log.length - 1] : null;
  const lastLine = last ? `${fmtTime(last.t)} ${last.code} ${last.message}` : '로그 없음';
  return (
    <section className={`run-details ${open ? 'is-open' : ''}`} aria-label="자세히">
      <div className="run-details-head">
        <button type="button" className="small" aria-expanded={open} aria-label={open ? '자세히 접기' : '자세히 펼치기'} onClick={onToggle}>자세히</button>
        {!open && <span className="run-details-last" title={lastLine}>{lastLine}</span>}
      </div>
      {open && <div className="run-details-body">
        <PieceTable rt={rt} />
        <Tabs label="자세히" idBase="run-detail" value={tab} onChange={onTab} tabs={[
          { id: 'summary', label: '실행 결과 요약', panel: <RunSummary p={p} rt={rt} embedded /> },
          { id: 'log', label: '실행 로그', panel: <RunLog rt={rt} /> },
          { id: 'signals', label: '신호', panel: <RunSignals p={p} rt={rt} /> },
        ]} />
      </div>}
    </section>
  );
}
