import type { Project } from '../model/types';
import './unit-lock.css';

/** Padlock drawn on a locked Unit. The name row is left alone. */
export function UnitLockMark({ unitId }: { unitId: string }) {
  return (
    <span className="rf-unit-lock" data-unit-lock={unitId} role="img" aria-label="위치 잠금" title="위치 잠금">
      <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
        <rect x="2.5" y="6" width="9" height="6.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M4.5 6V4.2a2.5 2.5 0 0 1 5 0V6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </span>
  );
}

interface ToolsProps {
  project: Project;
  selection: string[];
  disabled: boolean;
  onLockSelected: (locked: boolean) => void;
  onLockAll: (locked: boolean) => void;
}

/** Toolbar: lock the selection, or every Unit. */
export function UnitLockTools({ project, selection, disabled, onLockSelected, onLockAll }: ToolsProps) {
  const selected = project.units.filter((u) => selection.includes(u.id));
  const allLocked = selected.length > 0 && selected.every((u) => u.positionLocked === true);
  const anyUnit = project.units.length > 0;
  const label = allLocked ? '위치 잠금 해제' : '위치 잠금';
  return (
    <span className="unit-lock-tools">
      <button type="button" disabled={disabled || selected.length === 0} aria-pressed={allLocked} onClick={() => onLockSelected(!allLocked)}>{label}</button>
      <button type="button" disabled={disabled || !anyUnit} onClick={() => onLockAll(true)}>모두 잠금</button>
      <button type="button" disabled={disabled || !anyUnit} onClick={() => onLockAll(false)}>모두 풀기</button>
    </span>
  );
}
