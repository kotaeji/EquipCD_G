import { useEffect, useMemo, useRef, useState } from 'react';
import { findAsset } from '../assets/library';
import {
  applyBulkEdit, bulkOperandError, previewBulkEdit, quantityStatus, BULK_SOURCE_NOTE,
  type BulkEditRequest, type BulkNumberMode, type BulkPreview, type BulkStatusOp, type QtyStatus,
} from '../model/bulkEdit';
import type { CmdResult } from '../model/commands';
import type { Project, Quantity } from '../model/types';
import { StatusMark } from './StatusMark';
import './bulk-edit.css';

const LOCK_TITLE = '실행 중에는 적용이 막혀 있습니다. 초기화한 뒤에 편집하세요.';

type NumberChoice = 'none' | BulkNumberMode;
type TimeoutChoice = 'none' | BulkNumberMode | 'rule';
type StatusChoice = 'none' | BulkStatusOp;

function basisOf(duration: Quantity, timeout: Quantity): string {
  const notes = [duration.source?.note, timeout.source?.note].filter((note): note is string => !!note);
  const unique = [...new Set(notes)];
  return unique.length ? unique.join(' · ') : '—';
}

function StatusBits({ duration, timeout }: { duration: Quantity; timeout: Quantity }) {
  const one = (label: string, q: Quantity) => {
    const status = quantityStatus(q);
    if (status === 'unset') return <span className="bulk-status"><span>{label}</span> <StatusMark status="undetermined" /></span>;
    if (status === 'assumed') return <span className="bulk-status"><span>{label}</span> <StatusMark status="assumption" /></span>;
    return <span className="bulk-status"><span>{label}</span> <StatusMark status="done" word="확인" /></span>;
  };
  return <span className="bulk-status">{one('동작', duration)}{one('타임아웃', timeout)}</span>;
}

function CheckAll({ checked, indeterminate, onChange }: { checked: boolean; indeterminate: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate && !checked; }, [indeterminate, checked]);
  return <input ref={ref} type="checkbox" aria-label="보이는 Action 모두 체크" checked={checked} onChange={onChange} />;
}

function parseRequest(checkedIds: string[], durationMode: NumberChoice, durationRaw: string, timeoutMode: TimeoutChoice, timeoutRaw: string, factorRaw: string, marginRaw: string, statusMode: StatusChoice): { request: BulkEditRequest; error: string | null } {
  const request: BulkEditRequest = { actionIds: checkedIds };
  if (durationMode !== 'none') {
    const error = bulkOperandError(durationRaw, durationMode);
    if (error) return { request, error };
    request.duration = { mode: durationMode, amount: Number(durationRaw.trim()) };
  }
  if (timeoutMode === 'rule') {
    const factorError = bulkOperandError(factorRaw, 'factor');
    if (factorError) return { request, error: factorError };
    const marginError = bulkOperandError(marginRaw, 'margin');
    if (marginError) return { request, error: marginError };
    request.timeoutRule = { factor: Number(factorRaw.trim()), margin: Number(marginRaw.trim()) };
  } else if (timeoutMode !== 'none') {
    const error = bulkOperandError(timeoutRaw, timeoutMode);
    if (error) return { request, error };
    request.timeout = { mode: timeoutMode, amount: Number(timeoutRaw.trim()) };
  }
  if (statusMode !== 'none') request.status = statusMode;
  return { request, error: null };
}

export function BulkEdit({ project, locked, deviceIds, onApply }: {
  project: Project;
  locked: boolean;
  deviceIds: readonly string[];
  onApply: (result: CmdResult) => void;
}) {
  const presetKey = deviceIds.join('\n');
  const [seenPreset, setSeenPreset] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [unitFilter, setUnitFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | QtyStatus>('');
  const [durationMode, setDurationMode] = useState<NumberChoice>('none');
  const [durationRaw, setDurationRaw] = useState('');
  const [timeoutMode, setTimeoutMode] = useState<TimeoutChoice>('none');
  const [timeoutRaw, setTimeoutRaw] = useState('');
  const [factorRaw, setFactorRaw] = useState('');
  const [marginRaw, setMarginRaw] = useState('');
  const [statusMode, setStatusMode] = useState<StatusChoice>('none');

  if (presetKey && presetKey !== seenPreset) {
    setSeenPreset(presetKey);
    setChecked(new Set(project.actions.filter((action) => deviceIds.includes(action.deviceId)).map((action) => action.id)));
  }

  const kinds = useMemo(() => {
    const ids = new Set(project.actions.map((action) => action.deviceId));
    const list = project.devices.filter((device) => ids.has(device.id));
    const seen = new Set<string>();
    return list.filter((device) => (seen.has(device.kind) ? false : (seen.add(device.kind), true)));
  }, [project.actions, project.devices]);

  const visible = project.actions.filter((action) => {
    if (unitFilter && action.unitId !== unitFilter) return false;
    const device = project.devices.find((item) => item.id === action.deviceId);
    if (kindFilter && device?.kind !== kindFilter) return false;
    if (statusFilter) {
      const duration = quantityStatus(action.duration);
      const timeout = quantityStatus(action.timeout);
      if (duration !== statusFilter && timeout !== statusFilter) return false;
    }
    return true;
  });
  const visibleIds = visible.map((action) => action.id);
  const checkedIds = [...checked].filter((id) => project.actions.some((action) => action.id === id));
  const allVisible = visibleIds.length > 0 && visibleIds.every((id) => checked.has(id));
  const someVisible = visibleIds.some((id) => checked.has(id));

  const draft = parseRequest(checkedIds, durationMode, durationRaw, timeoutMode, timeoutRaw, factorRaw, marginRaw, statusMode);
  const preview: BulkPreview | null = draft.error ? null : previewBulkEdit(project, draft.request);
  const canApply = !locked && !draft.error && !!preview && preview.applicable > 0;

  const toggleVisible = () => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (allVisible) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };
  const toggleRow = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const listed = preview?.rows.filter((row) => row.apply || row.warnings.length > 0) ?? [];

  return (
    <div className="bulk-edit" data-bulk-edit>
      <p className="bulk-lead">프로젝트의 Action을 골라 동작 시간 · 타임아웃 · 가정 상태를 한 번에 바꿉니다. 적용은 수정 한 번이고, 실행 취소도 한 번입니다.</p>
      <div className="bulk-filters">
        <label className="bulk-field">Unit
          <select aria-label="Unit 걸러 보기" value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)}>
            <option value="">전체</option>
            {project.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
          </select>
        </label>
        <label className="bulk-field">종류
          <select aria-label="종류 걸러 보기" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            <option value="">전체</option>
            {kinds.map((device) => <option key={device.kind} value={device.kind}>{findAsset(device.kind)?.name ?? device.kind}</option>)}
          </select>
        </label>
        <label className="bulk-field">상태
          <select aria-label="상태 걸러 보기" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | QtyStatus)}>
            <option value="">전체</option>
            <option value="assumed">가정</option>
            <option value="confirmed">확인</option>
            <option value="unset">미정</option>
          </select>
        </label>
      </div>
      <p className="bulk-count">전체 {project.actions.length}개 중 {visible.length}개 · 체크 {checkedIds.length}개</p>
      <div className="bulk-table-wrap">
        <table className="bulk-table" data-bulk-table data-bulk-visible={visible.length}>
          <thead>
            <tr>
              <th><CheckAll checked={allVisible} indeterminate={someVisible} onChange={toggleVisible} /></th>
              <th>Unit</th>
              <th>Device</th>
              <th>Action</th>
              <th>동작 시간</th>
              <th>타임아웃</th>
              <th>상태</th>
              <th>근거</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((action) => {
              const unit = project.units.find((item) => item.id === action.unitId);
              const device = project.devices.find((item) => item.id === action.deviceId);
              const on = checked.has(action.id);
              return (
                <tr key={action.id} data-bulk-row={action.id} className={on ? 'is-checked' : undefined}>
                  <td><input type="checkbox" aria-label={`${action.name} 체크`} checked={on} onChange={() => toggleRow(action.id)} /></td>
                  <td>{unit?.name ?? action.unitId}</td>
                  <td>{device?.name ?? action.deviceId}</td>
                  <td>{action.name}</td>
                  <td>{action.duration.value === null ? '미정' : `${action.duration.value} s`}</td>
                  <td>{action.timeout.value === null ? '미정' : `${action.timeout.value} s`}</td>
                  <td><StatusBits duration={action.duration} timeout={action.timeout} /></td>
                  <td>{basisOf(action.duration, action.timeout)}</td>
                </tr>
              );
            })}
            {visible.length === 0 && <tr><td colSpan={8}>조건에 맞는 Action이 없습니다</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="bulk-ops">
        <label className="bulk-field">동작 시간
          <select aria-label="동작 시간 방식" value={durationMode} onChange={(e) => setDurationMode(e.target.value as NumberChoice)}>
            <option value="none">안 바꿈</option>
            <option value="set">값으로</option>
            <option value="scale">배율</option>
            <option value="add">더하기 / 빼기</option>
          </select>
        </label>
        {durationMode !== 'none' && (
          <label className="bulk-field">{durationMode === 'scale' ? '배율' : durationMode === 'add' ? '더할 초' : '초'}
            <input aria-label="동작 시간 값" value={durationRaw} placeholder={durationMode === 'scale' ? '0.5' : durationMode === 'add' ? '-1' : '1'} onChange={(e) => setDurationRaw(e.target.value)} />
          </label>
        )}
        <label className="bulk-field">타임아웃
          <select aria-label="타임아웃 방식" value={timeoutMode} onChange={(e) => setTimeoutMode(e.target.value as TimeoutChoice)}>
            <option value="none">안 바꿈</option>
            <option value="set">값으로</option>
            <option value="scale">배율</option>
            <option value="add">더하기 / 빼기</option>
            <option value="rule">동작 시간 × 배율 + 여유</option>
          </select>
        </label>
        {timeoutMode !== 'none' && timeoutMode !== 'rule' && (
          <label className="bulk-field">{timeoutMode === 'scale' ? '배율' : timeoutMode === 'add' ? '더할 초' : '초'}
            <input aria-label="타임아웃 값" value={timeoutRaw} placeholder={timeoutMode === 'scale' ? '0.5' : timeoutMode === 'add' ? '-1' : '2'} onChange={(e) => setTimeoutRaw(e.target.value)} />
          </label>
        )}
        {timeoutMode === 'rule' && (
          <>
            <label className="bulk-field">배율
              <input aria-label="타임아웃 배율" value={factorRaw} placeholder="2" onChange={(e) => setFactorRaw(e.target.value)} />
            </label>
            <label className="bulk-field">여유 (s)
              <input aria-label="타임아웃 여유" value={marginRaw} placeholder="0.5" onChange={(e) => setMarginRaw(e.target.value)} />
            </label>
          </>
        )}
        <label className="bulk-field">상태
          <select aria-label="상태 변경" value={statusMode} onChange={(e) => setStatusMode(e.target.value as StatusChoice)}>
            <option value="none">안 바꿈</option>
            <option value="assume">가정</option>
            <option value="confirm">확인</option>
            <option value="unset">미정</option>
          </select>
        </label>
        <button
          type="button"
          data-bulk-apply
          disabled={!canApply}
          title={locked ? LOCK_TITLE : undefined}
          onClick={() => { if (canApply) onApply(applyBulkEdit(project, draft.request)); }}
        >적용</button>
      </div>
      {draft.error && <p className="bulk-error" role="alert">{draft.error}</p>}
      {locked && <p className="bulk-error">{LOCK_TITLE}</p>}
      <div className="bulk-preview" data-bulk-preview>
        <h2>미리보기</h2>
        {!checkedIds.length && <p className="bulk-count">체크한 Action이 없습니다.</p>}
        {!!checkedIds.length && draft.error && <p className="bulk-count">숫자를 고치면 전 → 후가 나옵니다.</p>}
        {preview && !!checkedIds.length && !draft.error && (
          <>
            <p className="bulk-count">적용 {preview.applicable} · 경고 {preview.warned} · 변화 없음 {preview.unchanged}. 경고가 붙은 줄은 적용되지 않습니다. 근거에는 「{BULK_SOURCE_NOTE}」이 남습니다.</p>
            <ul>
              {listed.map((row) => (
                <li key={row.actionId} data-bulk-preview-row={row.actionId} className={row.warnings.length ? 'is-warn' : undefined}>
                  <span>{row.unitName} · {row.deviceName} · {row.actionName}</span>
                  <span> · 동작 {row.durationFrom} → {row.durationTo}</span>
                  <span> · 타임아웃 {row.timeoutFrom} → {row.timeoutTo}</span>
                  <span> · 상태 {row.statusFrom} → {row.statusTo}</span>
                  {row.warnings.map((warning) => <span key={warning} className="bulk-warn" data-bulk-warn>{warning}</span>)}
                  {row.warnings.length > 0 && <span className="bulk-skip"> 적용 안 함</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
