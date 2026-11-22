import { useEffect, useState } from 'react';
import type { Action, Project } from '../model/types';
import { NeverTrueFaults, ReadFailFaults } from './Panels';
import type { EditFn } from './Inspector';

const SPEEDS = [0.25, 0.5, 1, 2, 4];

function DurationField({ action, disabled, onCommit }: { action: Action; disabled: boolean; onCommit: (value: number) => void }) {
  const value = action.duration.value;
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
  return (
    <div className="run3d-dur">
      <span className="run3d-dur-name">{action.name}</span>
      <input type="range" aria-label={`${action.name} 동작 시간`} min={0} max={max} step={0.1} disabled={disabled}
        value={Math.min(max, Math.max(0, rangeValue))}
        onChange={(e) => setDraft(e.target.value)}
        onPointerUp={(e) => commit((e.target as HTMLInputElement).value)}
        onBlur={(e) => commit(e.target.value)} />
      <input type="number" className="num" aria-label={`${action.name} 동작 시간 숫자`} min={0} step={0.1} disabled={disabled}
        value={shown}
        onChange={(e) => { setDraft(e.target.value); commit(e.target.value); }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      <span className="muted">s</span>
      {action.duration.assumption && <span className="badge">가정</span>}
    </div>
  );
}

/** Right column of the 3D run view. Duration edits go through setQuantity. */
export function RunConditions({ p, locked, edit, speed, setSpeed, showNames, setShowNames, emphasize, setEmphasize, canRevert, onRevert, onDuration }: {
  p: Project;
  locked: boolean;
  edit: EditFn;
  speed: number;
  setSpeed: (n: number) => void;
  showNames: boolean;
  setShowNames: (v: boolean) => void;
  emphasize: boolean;
  setEmphasize: (v: boolean) => void;
  canRevert: boolean;
  onRevert: () => void;
  onDuration: (actionId: string, value: number) => void;
}) {
  return (
    <aside className="run-conditions" aria-label="가동 조건">
      <h2>가동 조건</h2>
      <label className="run3d-field">배속
        <select aria-label="배속" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => <option key={s} value={s}>{s}x</option>)}
        </select>
      </label>
      <label className="run3d-check"><input type="checkbox" aria-label="이름 표시" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />이름 표시</label>
      <label className="run3d-check"><input type="checkbox" aria-label="동작 강조" checked={emphasize} onChange={(e) => setEmphasize(e.target.checked)} />동작 강조</label>
      <h3>동작 시간</h3>
      {locked && <p className="run3d-lock" data-duration-locked="true">실행 중 · 일시정지 중에는 동작 시간을 바꿀 수 없습니다. 초기화한 뒤 편집하세요.</p>}
      {p.units.map((unit) => {
        const actions = p.actions.filter((a) => a.unitId === unit.id);
        if (!actions.length) return null;
        return (
          <details key={unit.id} className="run3d-unit" open>
            <summary>{unit.name}</summary>
            {actions.map((action) => <DurationField key={action.id} action={action} disabled={locked} onCommit={(value) => onDuration(action.id, value)} />)}
          </details>
        );
      })}
      <button type="button" className="btn-main secondary" aria-label="이 화면에 들어온 뒤 바꾼 값 되돌리기" disabled={locked || !canRevert} onClick={onRevert}>이 화면에 들어온 뒤 바꾼 값 되돌리기</button>
      <h3>검증용 오류 주입</h3>
      <ReadFailFaults p={p} locked={locked} edit={edit} />
      <NeverTrueFaults p={p} locked={locked} edit={edit} />
      <p className="run3d-note">시간 · 속도는 가정값입니다. 실제 택트가 아닙니다.</p>
    </aside>
  );
}
