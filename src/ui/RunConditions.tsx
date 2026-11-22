import { useEffect, useState } from 'react';
import type { Action, Project } from '../model/types';
import { NeverTrueFaults, ReadFailFaults } from './Panels';
import type { EditFn } from './Inspector';

const SPEEDS = [0.25, 0.5, 1, 2, 4];

export const TIMEOUT_WARN = '타임아웃이 동작 시간보다 짧습니다 — 실행하면 TIMEOUT';
export const TIMEOUT_EQUAL = '타임아웃이 동작 시간과 같습니다 — 여유가 없습니다';

/** Matches the engine tie rule: equal millisecond instants succeed, a shorter timeout is TIMEOUT. */
function timeoutNote(action: Action): string | null {
  const timeout = action.timeout.value;
  const duration = action.duration.value;
  if (timeout === null || duration === null) return null;
  const timeoutMs = Math.round(timeout * 1000);
  const durationMs = Math.round(duration * 1000);
  if (timeoutMs < durationMs) return TIMEOUT_WARN;
  if (timeoutMs === durationMs) return TIMEOUT_EQUAL;
  return null;
}

function QuantityRow({ action, field, label, disabled, onCommit }: {
  action: Action;
  field: 'duration' | 'timeout';
  label: string;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const quantity = action[field];
  const value = quantity.value;
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => { setDraft(null); }, [value]);
  const shown = draft ?? (value === null ? '' : String(value));
  const commit = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) { setDraft(null); return; }
    const rounded = Math.round(n * 1000) / 1000;
    if (rounded === value) { setDraft(null); return; }
    onCommit(rounded);
    setDraft(null);
  };
  const max = Math.max(10, Math.ceil((value ?? 1) + 1));
  const rangeValue = shown === '' || !Number.isFinite(Number(shown)) ? 0 : Number(shown);
  const aria = field === 'duration' ? '동작 시간' : '타임아웃';
  return (
    <div className="run3d-qty" data-field={field}>
      <span className="run3d-qty-label">{label}</span>
      <input type="range" aria-label={`${action.name} ${aria}`} min={0} max={max} step={0.1} disabled={disabled}
        value={Math.min(max, Math.max(0, rangeValue))}
        onChange={(e) => setDraft(e.target.value)}
        onPointerUp={(e) => commit((e.target as HTMLInputElement).value)}
        onBlur={(e) => commit(e.target.value)} />
      <input type="number" className="num" aria-label={`${action.name} ${aria} 숫자`} min={0} step={0.1} disabled={disabled}
        value={shown}
        onChange={(e) => { setDraft(e.target.value); commit(e.target.value); }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      <span className="muted">s</span>
      {quantity.assumption && <span className="badge">가정</span>}
    </div>
  );
}

function ActionTimes({ action, disabled, onDuration, onTimeout }: {
  action: Action;
  disabled: boolean;
  onDuration: (value: number) => void;
  onTimeout: (value: number) => void;
}) {
  const note = timeoutNote(action);
  return (
    <div className="run3d-dur">
      <span className="run3d-dur-name" title={action.name}>{action.name}</span>
      <QuantityRow action={action} field="duration" label="동작 시간" disabled={disabled} onCommit={onDuration} />
      <QuantityRow action={action} field="timeout" label="타임아웃" disabled={disabled} onCommit={onTimeout} />
      {note && <p className="run3d-timeout-warn" data-timeout-warn={action.id}>{note}</p>}
    </div>
  );
}

/** Right column of the 3D run view. Duration and timeout edits go through setQuantity. */
export function RunConditions({ p, locked, edit, speed, setSpeed, showNames, setShowNames, emphasize, setEmphasize, equipmentMotion, setEquipmentMotion, canRevert, onRevert, onDuration, onTimeout, folded, onToggleFold }: {
  p: Project;
  locked: boolean;
  edit: EditFn;
  speed: number;
  setSpeed: (n: number) => void;
  showNames: boolean;
  setShowNames: (v: boolean) => void;
  emphasize: boolean;
  setEmphasize: (v: boolean) => void;
  equipmentMotion: boolean;
  setEquipmentMotion: (v: boolean) => void;
  canRevert: boolean;
  onRevert: () => void;
  onDuration: (actionId: string, value: number) => void;
  onTimeout: (actionId: string, value: number) => void;
  folded: boolean;
  onToggleFold: () => void;
}) {
  return (
    <aside className={`run-conditions ${folded ? 'is-folded' : ''}`} aria-label="가동 조건">
      <div className="run3d-head">
        <h2>가동 조건</h2>
        <button type="button" className="small" aria-label={folded ? '가동 조건 펼치기' : '가동 조건 접기'} onClick={onToggleFold}>{folded ? '펼치기' : '접기'}</button>
      </div>
      {!folded && <>
      <label className="run3d-field">배속
        <select aria-label="배속" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => <option key={s} value={s}>{s}x</option>)}
        </select>
      </label>
      <label className="run3d-check"><input type="checkbox" aria-label="이름 표시" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />이름 표시</label>
      <label className="run3d-check"><input type="checkbox" aria-label="동작 강조" checked={emphasize} onChange={(e) => setEmphasize(e.target.checked)} />동작 강조</label>
      <label className="run3d-check"><input type="checkbox" aria-label="설비 동작" checked={equipmentMotion} onChange={(e) => setEquipmentMotion(e.target.checked)} />설비 동작</label>
      <h3>동작 시간 · 타임아웃</h3>
      {locked && <p className="run3d-lock" data-duration-locked="true" data-timeout-locked="true">실행 중 · 일시정지 중에는 동작 시간과 타임아웃을 바꿀 수 없습니다. 초기화한 뒤 편집하세요.</p>}
      {p.units.map((unit) => {
        const actions = p.actions.filter((a) => a.unitId === unit.id);
        if (!actions.length) return null;
        return (
          <details key={unit.id} className="run3d-unit" open>
            <summary>{unit.name}</summary>
            {actions.map((action) => (
              <ActionTimes key={action.id} action={action} disabled={locked}
                onDuration={(value) => onDuration(action.id, value)}
                onTimeout={(value) => onTimeout(action.id, value)} />
            ))}
          </details>
        );
      })}
      <button type="button" className="btn-main secondary" aria-label="이 화면에 들어온 뒤 바꾼 값 되돌리기" disabled={locked || !canRevert} onClick={onRevert}>이 화면에 들어온 뒤 바꾼 값 되돌리기</button>
      <h3>검증용 오류 주입</h3>
      <ReadFailFaults p={p} locked={locked} edit={edit} />
      <NeverTrueFaults p={p} locked={locked} edit={edit} />
      <p className="run3d-note">시간 · 속도는 가정값입니다. 실제 택트가 아닙니다.</p>
      </>}
    </aside>
  );
}
