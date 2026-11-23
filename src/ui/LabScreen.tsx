import { useEffect, useRef, useState } from 'react';
import {
  LAB_APPLY_LOCK, LAB_BASELINE_NAME, LAB_STALE, MAX_LAB_VARIANTS,
  formatDelta, formatLabMs, labBasis, labDiff, labVariantKey, runLab,
  type LabColumn, type LabReport, type LabVariant,
} from '../model/lab';
import type { Project } from '../model/types';
import { EmptyState } from './EmptyState';
import { Clip, ECD_TABLE } from './dataTable';
import { SCREEN } from './problemCopy';
import './lab.css';

export interface LabScreenProps {
  project: Project;
  locked: boolean;
  variants: LabVariant[];
  result: LabReport | null;
  onChangeVariants: (variants: LabVariant[]) => void;
  onResult: (result: LabReport) => void;
  /** Returns false when the model edit was rejected. */
  onApply: (variant: LabVariant) => boolean;
}

function nextVariant(variants: readonly LabVariant[]): LabVariant {
  const n = variants.reduce((max, variant) => Math.max(max, Number(/^lab-(\d+)$/.exec(variant.id)?.[1] ?? 0)), 0) + 1;
  return { id: `lab-${n}`, name: `안 ${variants.length + 1}`, durations: [], scale: null, timeouts: [], feedCount: null };
}

function commitNumber(raw: string): number | null | 'invalid' {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 'invalid';
  return Math.round(n * 1000) / 1000;
}

function NumberField({ label, aria, value, onCommit, integer }: {
  label: string;
  aria: string;
  value: number | null;
  onCommit: (value: number | null) => void;
  integer?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => { setDraft(null); }, [value]);
  const shown = draft ?? (value == null ? '' : String(value));
  const commit = (raw: string) => {
    const next = commitNumber(raw);
    if (next === 'invalid') { setDraft(null); return; }
    if (next != null && integer && !Number.isInteger(next)) { setDraft(null); return; }
    if (integer && next != null && next < 1) { setDraft(null); return; }
    onCommit(next);
    setDraft(null);
  };
  return (
    <label className="lab-field">{label}
      <input type="number" aria-label={aria} min={integer ? 1 : 0} step={integer ? 1 : 0.1} value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
}

function statusText(column: LabColumn): string {
  if (column.status === 'completed') return '끝남';
  if (column.status === 'blocked') return `실행 불가 — ${column.detail}`;
  return `오류 ${column.code ?? ''}${column.detail ? ` — ${column.detail}` : ''}`;
}

function bestIndexes(values: (number | null)[], higher: boolean): Set<number> {
  const rows = values.flatMap((value, index) => (value == null ? [] : [{ value, index }]));
  if (rows.length < 2) return new Set();
  const target = higher ? Math.max(...rows.map((row) => row.value)) : Math.min(...rows.map((row) => row.value));
  const winners = rows.filter((row) => row.value === target);
  if (winners.length === rows.length) return new Set();
  return new Set(winners.map((row) => row.index));
}

function cell(text: string, best: boolean, mark: string | null) {
  return <><Clip text={text} />{best && mark ? <span className="lab-mark">{mark}</span> : null}</>;
}

export function LabScreen({ project, locked, variants, result, onChangeVariants, onResult, onApply }: LabScreenProps) {
  const [pending, setPending] = useState<LabVariant | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const full = variants.length >= MAX_LAB_VARIANTS;
  const pendingRows = pending ? labDiff(project, pending) : [];
  const staleRev = !!result && result.modelRevision !== project.revision;
  const stalePlan = !!result && result.variantKey !== labVariantKey(variants);

  useEffect(() => { if (pending) cancelRef.current?.focus(); }, [pending]);

  const update = (id: string, patch: Partial<LabVariant> | ((variant: LabVariant) => LabVariant)) => {
    onChangeVariants(variants.map((variant) => {
      if (variant.id !== id) return variant;
      return typeof patch === 'function' ? patch(variant) : { ...variant, ...patch };
    }));
  };

  const add = () => { if (!full) onChangeVariants([...variants, nextVariant(variants)]); };

  const columns = result?.columns ?? [];
  const baseline = columns.find((column) => column.kind === 'baseline') ?? null;
  const best = {
    total: bestIndexes(columns.map((column) => (column.status === 'completed' ? column.totalMs : null)), false),
    cycle: bestIndexes(columns.map((column) => (column.status === 'completed' ? column.cycleMs : null)), false),
    throughput: bestIndexes(columns.map((column) => (column.status === 'completed' ? column.throughput : null)), true),
    bottleneck: bestIndexes(columns.map((column) => (column.status === 'completed' ? column.bottleneckMs : null)), false),
    longest: bestIndexes(columns.map((column) => (column.status === 'completed' ? column.longestMs : null)), false),
  };

  const metric = (key: string, title: string, textOf: (column: LabColumn, index: number) => { text: string; best: boolean; mark: string | null }) => (
    <tr data-metric={key}>
      <th scope="row">{title}</th>
      {columns.map((column, index) => {
        const cellInfo = textOf(column, index);
        const numeric = key !== 'status';
        const cls = [cellInfo.best ? 'lab-best' : '', numeric ? 'ecd-num' : ''].filter(Boolean).join(' ');
        return <td key={column.id} data-lab-col={column.id} className={cls || undefined} data-best={cellInfo.best ? '1' : undefined}>{cell(cellInfo.text, cellInfo.best, cellInfo.mark)}</td>;
      })}
    </tr>
  );

  return (
    <div className="lab-screen" data-lab-screen="" data-model-rev={project.revision}>
      <p className="lab-limit" data-lab-limit="">{SCREEN.lab.limit}</p>
      {variants.length === 0 ? (
        <EmptyState symbol="○" line={SCREEN.lab.empty} actions={[{ label: '안 추가', onClick: add, attrs: { 'data-lab-add': '1' } }]} />
      ) : (
        <>
          <div className="lab-tools">
            <button type="button" data-lab-add="1" disabled={full} title={full ? '안은 기준을 포함해 4개까지입니다' : undefined} onClick={add}>안 추가</button>
            <button type="button" className="primary" data-lab-run="" onClick={() => onResult(runLab(project, variants))}>모두 실행</button>
            <p className="lab-note">{LAB_BASELINE_NAME}은 지금 모델 rev {project.revision} 입니다. 안을 고치는 것은 모델을 바꾸지 않습니다.</p>
          </div>
          {result && (
            <>
              <p className="lab-note" data-lab-rev="">계산한 모델 rev {result.modelRevision}</p>
              {staleRev && <p className="lab-stale" data-lab-stale="">{LAB_STALE}</p>}
              {stalePlan && <p className="lab-note" data-lab-plan-stale="">이 표는 실행할 때의 안입니다.</p>}
              <div className="lab-table-wrap">
                <table className={`lab-table ${ECD_TABLE}`} data-lab-table="" aria-label="가동 조건 비교">
                  <thead>
                    <tr>
                      <th>지표</th>
                      {columns.map((column) => <th key={column.id} scope="col" data-lab-col={column.id}>{column.name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {metric('status', '끝남', (column) => ({ text: statusText(column), best: false, mark: null }))}
                    {metric('total', '총 가상 시간', (column, index) => ({
                      text: column.totalMs == null ? '—' : formatLabMs(column.totalMs),
                      best: best.total.has(index),
                      mark: '가장 짧음',
                    }))}
                    {metric('cycle', '사이클', (column, index) => ({
                      text: column.cycleMs == null ? '—' : `${formatLabMs(column.cycleMs)}${column.cycleBasis ? ` · ${column.cycleBasis}` : ''}`,
                      best: best.cycle.has(index),
                      mark: '가장 짧음',
                    }))}
                    {metric('throughput', '시간당 생산량', (column, index) => ({
                      text: column.throughput == null ? '—' : column.throughput.toFixed(1),
                      best: best.throughput.has(index),
                      mark: '가장 큼',
                    }))}
                    {metric('bottleneck', '병목', (column, index) => ({
                      text: column.bottleneckName == null || column.bottleneckMs == null ? '—' : `${column.bottleneckName} · ${formatLabMs(column.bottleneckMs)}`,
                      best: best.bottleneck.has(index),
                      mark: '가장 짧음',
                    }))}
                    {metric('longest', '가장 긴 단계', (column, index) => ({
                      text: column.longestName == null || column.longestMs == null ? '—' : `${column.longestName} · ${formatLabMs(column.longestMs)}`,
                      best: best.longest.has(index),
                      mark: '가장 짧음',
                    }))}
                    {metric('delta', '기준 대비 차이', (column) => {
                      if (column.kind === 'baseline') return { text: LAB_BASELINE_NAME, best: false, mark: null };
                      if (column.status !== 'completed' || baseline?.status !== 'completed' || column.totalMs == null || baseline.totalMs == null) {
                        return { text: '—', best: false, mark: null };
                      }
                      return { text: formatDelta(column.totalMs, baseline.totalMs), best: false, mark: null };
                    })}
                  </tbody>
                </table>
              </div>
              <p className="lab-note">병목 칸은 기다린 시간 합입니다. 기다림이 없으면 한 개 기준으로 가장 오래 걸린 Unit 시간입니다. 사이클은 개체 3개 이상이면 정상 상태입니다.</p>
            </>
          )}
          <div className="lab-cards">
            {variants.map((variant) => {
              const durationMode = variant.scale != null ? 'scale' : variant.durations.length > 0 ? 'action' : 'keep';
              const timeoutMode = variant.timeouts.length > 0 ? 'action' : 'keep';
              const intervalMode = variant.feedInterval === undefined ? 'keep' : variant.feedInterval == null ? 'unset' : 'value';
              const durationAction = project.actions.find((action) => action.id === variant.durations[0]?.actionId) ?? project.actions[0];
              const timeoutAction = project.actions.find((action) => action.id === variant.timeouts[0]?.actionId) ?? project.actions[0];
              const diffCount = labDiff(project, variant).length;
              return (
                <section key={variant.id} className="lab-card" data-lab-variant={variant.id}>
                  <div className="lab-card-head">
                    <h2>{variant.name || '안'}</h2>
                    <button type="button" className="small" aria-label={`${variant.name} 삭제`} onClick={() => onChangeVariants(variants.filter((item) => item.id !== variant.id))}>삭제</button>
                  </div>
                  <label className="lab-field">이름
                    <input aria-label={`${variant.id} 이름`} value={variant.name} onChange={(e) => update(variant.id, { name: e.target.value })} />
                  </label>
                  <label className="lab-field">동작 시간
                    <select aria-label={`${variant.id} 동작 시간 방식`} value={durationMode} onChange={(e) => {
                      const mode = e.target.value;
                      if (mode === 'keep') update(variant.id, { durations: [], scale: null });
                      else if (mode === 'scale') update(variant.id, { durations: [], scale: variant.scale ?? 1 });
                      else if (durationAction) update(variant.id, { scale: null, durations: [{ actionId: durationAction.id, value: durationAction.duration.value ?? 0 }] });
                    }}>
                      <option value="keep">그대로</option>
                      <option value="action">고른 Action</option>
                      <option value="scale">모든 Action × 배율</option>
                    </select>
                  </label>
                  {durationMode === 'action' && durationAction && (
                    <>
                      <label className="lab-field">Action
                        <select aria-label={`${variant.id} 동작 시간 Action`} value={variant.durations[0]?.actionId ?? durationAction.id} onChange={(e) => {
                          const action = project.actions.find((item) => item.id === e.target.value);
                          if (!action) return;
                          update(variant.id, { durations: [{ actionId: action.id, value: variant.durations[0]?.value ?? action.duration.value ?? 0 }] });
                        }}>
                          {project.actions.map((action) => <option key={action.id} value={action.id}>{action.name}</option>)}
                        </select>
                      </label>
                      <NumberField label="동작 시간" aria={`${variant.id} 동작 시간`} value={variant.durations[0]?.value ?? null} onCommit={(value) => {
                        if (value == null) return;
                        const actionId = variant.durations[0]?.actionId ?? durationAction.id;
                        update(variant.id, { durations: [{ actionId, value }] });
                      }} />
                    </>
                  )}
                  {durationMode === 'scale' && (
                    <NumberField label="배율" aria={`${variant.id} 배율`} value={variant.scale} onCommit={(value) => update(variant.id, { scale: value == null ? 1 : value })} />
                  )}
                  <label className="lab-field">타임아웃
                    <select aria-label={`${variant.id} 타임아웃 방식`} value={timeoutMode} onChange={(e) => {
                      if (e.target.value === 'keep') update(variant.id, { timeouts: [] });
                      else if (timeoutAction) update(variant.id, { timeouts: [{ actionId: timeoutAction.id, value: timeoutAction.timeout.value ?? 0 }] });
                    }}>
                      <option value="keep">그대로</option>
                      <option value="action">고른 Action</option>
                    </select>
                  </label>
                  {timeoutMode === 'action' && timeoutAction && (
                    <>
                      <label className="lab-field">Action
                        <select aria-label={`${variant.id} 타임아웃 Action`} value={variant.timeouts[0]?.actionId ?? timeoutAction.id} onChange={(e) => {
                          const action = project.actions.find((item) => item.id === e.target.value);
                          if (!action) return;
                          update(variant.id, { timeouts: [{ actionId: action.id, value: variant.timeouts[0]?.value ?? action.timeout.value ?? 0 }] });
                        }}>
                          {project.actions.map((action) => <option key={action.id} value={action.id}>{action.name}</option>)}
                        </select>
                      </label>
                      <NumberField label="타임아웃" aria={`${variant.id} 타임아웃`} value={variant.timeouts[0]?.value ?? null} onCommit={(value) => {
                        if (value == null) return;
                        const actionId = variant.timeouts[0]?.actionId ?? timeoutAction.id;
                        update(variant.id, { timeouts: [{ actionId, value }] });
                      }} />
                    </>
                  )}
                  <NumberField label="투입 개수" aria={`${variant.id} 투입 개수`} integer value={variant.feedCount} onCommit={(value) => update(variant.id, { feedCount: value })} />
                  <label className="lab-field">투입 간격
                    <select aria-label={`${variant.id} 투입 간격 방식`} value={intervalMode} onChange={(e) => {
                      const mode = e.target.value;
                      update(variant.id, (current) => {
                        if (mode === 'keep') {
                          const rest = { ...current };
                          delete rest.feedInterval;
                          return rest;
                        }
                        if (mode === 'unset') return { ...current, feedInterval: null };
                        return { ...current, feedInterval: current.feedInterval ?? project.materials[0]?.feedInterval.value ?? 0 };
                      });
                    }}>
                      <option value="keep">그대로</option>
                      <option value="value">값</option>
                      <option value="unset">미정</option>
                    </select>
                  </label>
                  {intervalMode === 'value' && (
                    <NumberField label="투입 간격" aria={`${variant.id} 투입 간격`} value={variant.feedInterval ?? null} onCommit={(value) => {
                      if (value == null) {
                        update(variant.id, (current) => {
                          const rest = { ...current };
                          delete rest.feedInterval;
                          return rest;
                        });
                      } else update(variant.id, { feedInterval: value });
                    }} />
                  )}
                  <button type="button" data-lab-apply={variant.id} disabled={locked || diffCount === 0}
                    title={locked ? LAB_APPLY_LOCK : diffCount === 0 ? '바꿀 값이 없습니다' : undefined}
                    onClick={() => { if (!locked && diffCount > 0) setPending(variant); }}>모델에 반영</button>
                </section>
              );
            })}
          </div>
        </>
      )}
      {pending && (
        <div className="modal-bg" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-label="모델에 반영" data-lab-confirm="">
            <h3>모델에 반영 — {pending.name}</h3>
            <p>바뀌는 값입니다. 확인하면 한 번에 반영됩니다.</p>
            <p>근거는 「{labBasis(pending.name)}」이고, 상태는 가정입니다.</p>
            <ul className="lab-diff" data-lab-diff="">
              {pendingRows.map((row) => <li key={`${row.label}:${row.from}:${row.to}`}>{row.label} {row.from} → {row.to}</li>)}
            </ul>
            <div className="modal-actions">
              <button type="button" ref={cancelRef} onClick={() => setPending(null)}>취소</button>
              <button type="button" className="primary" onClick={() => { if (onApply(pending)) setPending(null); }}>반영</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
