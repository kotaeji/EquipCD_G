import { useEffect, useState } from 'react';
import * as C from '../model/commands';
import { feedCountOf, type Action, type Project } from '../model/types';
import { NeverTrueFaults, ReadFailFaults, RunReadiness } from './Panels';
import type { Diagnostic } from '../model/validate';
import type { BlockerGuide } from './blockerTarget';
import type { EditFn } from './Inspector';
import { StatusMark } from './StatusMark';

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
      {quantity.assumption && <StatusMark status="assumption" />}
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

export const FEED_LOCK = '실행 중 · 일시정지 중에는 투입 개수와 투입 간격을 바꿀 수 없습니다. 초기화한 뒤 편집하세요.';
export const VIEW_3D_ONLY = '3D 보기에서 쓰는 옵션입니다';

function FeedCountInput({ value, disabled, onCommit }: { value: number; disabled: boolean; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => { setDraft(null); }, [value]);
  const shown = draft ?? String(value);
  const commit = (raw: string) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) { setDraft(null); return; }
    if (n !== value) onCommit(n);
    setDraft(null);
  };
  return (
    <label className="run3d-field">투입 개수
      <input type="number" aria-label="투입 개수" min={1} step={1} disabled={disabled} value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
}

function FeedIntervalInput({ value, disabled, onCommit }: { value: number | null; disabled: boolean; onCommit: (n: number | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => { setDraft(null); }, [value]);
  const shown = draft ?? (value === null ? '' : String(value));
  const commit = (raw: string) => {
    if (raw.trim() === '') { if (value !== null) onCommit(null); setDraft(null); return; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) { setDraft(null); return; }
    const rounded = Math.round(n * 1000) / 1000;
    if (rounded !== value) onCommit(rounded);
    setDraft(null);
  };
  return (
    <label className="run3d-field">투입 간격
      <input type="number" aria-label="투입 간격" min={0} step={0.1} disabled={disabled} value={shown} placeholder="미정"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      <span className="muted">s</span>
    </label>
  );
}

function SceneOption({ label, checked, enabled, onChange }: { label: string; checked: boolean; enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`run3d-check ${enabled ? '' : 'is-off'}`} title={enabled ? undefined : VIEW_3D_ONLY}>
      <input type="checkbox" aria-label={label} checked={enabled ? checked : false} disabled={!enabled} title={enabled ? undefined : VIEW_3D_ONLY} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Right column of the run step, shared by the diagram and the 3D view. */
export function RunConditions({ p, locked, edit, speed, setSpeed, showNames, setShowNames, emphasize, setEmphasize, equipmentMotion, setEquipmentMotion, canRevert, onRevert, onDuration, onTimeout, folded, onToggleFold, sceneOptions, onGoBlocker, emphasizeFirst }: {
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
  /** Name, emphasis, and motion options apply only while the center canvas is 3D. */
  sceneOptions: boolean;
  onGoBlocker?: (b: Diagnostic, g: BlockerGuide) => void;
  /** First remaining pre-run blocker, after coming back from a jump. */
  emphasizeFirst?: boolean;
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
      {p.materials[0] && <>
        <h3>투입</h3>
        {locked && <p className="run3d-lock" data-feed-locked="true">{FEED_LOCK}</p>}
        <FeedCountInput value={feedCountOf(p.materials[0])} disabled={locked} onCommit={(n) => edit(C.setFeedCount(p, p.materials[0].id, n), '투입 개수')} />
        <FeedIntervalInput value={p.materials[0].feedInterval.value} disabled={locked} onCommit={(n) => edit(C.setQuantity(p, { kind: 'material', id: p.materials[0].id, field: 'feedInterval' }, n, p.materials[0].feedInterval.assumption), '투입 간격')} />
      </>}
      <h3>표시 옵션</h3>
      <SceneOption label="이름 표시" checked={showNames} enabled={sceneOptions} onChange={setShowNames} />
      <SceneOption label="동작 강조" checked={emphasize} enabled={sceneOptions} onChange={setEmphasize} />
      <SceneOption label="설비 동작" checked={equipmentMotion} enabled={sceneOptions} onChange={setEquipmentMotion} />
      <RunReadiness p={p} onGoBlocker={onGoBlocker} emphasizeFirst={emphasizeFirst} />
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
      <h3>검증용 오류 주입</h3>
      <ReadFailFaults p={p} locked={locked} edit={edit} />
      <NeverTrueFaults p={p} locked={locked} edit={edit} />
      <button type="button" className="btn-main secondary" aria-label="이 화면에 들어온 뒤 바꾼 값 되돌리기" disabled={locked || !canRevert} onClick={onRevert}>이 화면에 들어온 뒤 바꾼 값 되돌리기</button>
      <p className="run3d-note">시간 · 속도는 가정값입니다. 실제 택트가 아닙니다.</p>
      </>}
    </aside>
  );
}
