import { findingsOf, levelAt, type ConditionLevel } from '../model/conditionCheck';
import type { Project } from '../model/types';
import { StatusMark } from './StatusMark';

const WORD: Record<ConditionLevel, string> = { error: '오류', undetermined: '미정', info: '안내' };

/** Worst finding on this condition place. 안내 uses the 가정 shape with its own word. */
export function ConditionMark({ p, site }: { p: Project; site: string }) {
  const level = levelAt(findingsOf(p), site);
  if (!level) return null;
  const status = level === 'error' ? 'error' : level === 'undetermined' ? 'undetermined' : 'assumption';
  return (
    <span data-cond-level={level} data-cond-site={site}>
      <StatusMark status={status} word={WORD[level]} />
    </span>
  );
}
