import type { ButtonHTMLAttributes } from 'react';

type ButtonExtra = ButtonHTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string | undefined>;
import { undefinedFormula } from '../model/conditionFormula';
import type { Project } from '../model/types';
import type { Diagnostic } from '../model/validate';
import { resolveBlocker, type BlockerGuide } from './blockerTarget';
import { blockerProblem, type ProblemCopy } from './problemCopy';
import { StatusMark } from './StatusMark';

/** Shared problem: 무엇 · 왜 · 어떻게, plus a jump when there is a place to go. */
export function Problem({ copy, onJump, compact, badge, buttonLabel, buttonAria, buttonAttrs }: {
  copy: ProblemCopy;
  onJump?: () => void;
  /** Toast: 무엇 and 왜 only. */
  compact?: boolean;
  badge?: string;
  buttonLabel?: string;
  buttonAria?: string;
  buttonAttrs?: ButtonExtra;
}) {
  const label = buttonLabel ?? copy.jump;
  const mark = badge ?? copy.badge;
  const showJump = !!onJump && !!label;
  return (
    <div className={`problem${compact ? ' is-compact' : ''}`} data-problem="" data-problem-tone={copy.tone} role="alert">
      <p className="problem-what" data-problem-what=""><StatusMark status={copy.tone} /><b>{copy.what}</b></p>
      <p className="problem-why" data-problem-why="">{copy.why}</p>
      {!compact && (copy.how || mark || showJump) && (
        <p className="problem-how" data-problem-how="">
          {copy.how}
          {mark && <span className="badge warn">{mark}</span>}
          {showJump && <button type="button" className="small" aria-label={buttonAria ?? copy.jumpAria ?? label} onClick={onJump} {...buttonAttrs}>{label}</button>}
        </p>
      )}
      {compact && showJump && <button type="button" className="small" aria-label={buttonAria ?? copy.jumpAria ?? label} onClick={onJump} {...buttonAttrs}>{label}</button>}
    </div>
  );
}

/** Readiness rows. The code stays visible so the existing gate tests can find it. */
export function BlockerList({ p, blockers, onGuide }: {
  p: Project;
  blockers: Diagnostic[];
  onGuide?: (b: Diagnostic, g: BlockerGuide) => void;
}) {
  return (
    <ul className="diaglist blockers">
      {blockers.map((b) => {
        const g = resolveBlocker(p, b, blockers);
        const copy0 = blockerProblem(b.message, b.code, g);
        const phrase = b.code === 'CONDITION_UNDEFINED' ? undefinedFormula(p, b.objectId) : '';
        const copy = phrase ? { ...copy0, why: `${copy0.why} ${phrase}` } : copy0;
        return (
          <li key={b.id} className="blocker-item" data-guide-kind={g.kind}>
            <span className="mono">[{b.code}]</span>
            <Problem copy={copy} badge={copy.badge} buttonLabel={copy.jump} buttonAria={copy.jumpAria}
              onJump={onGuide && copy.jump ? () => onGuide(b, g) : undefined}
              buttonAttrs={{ 'data-blocker-code': b.code, 'data-guide-kind': g.kind }} />
          </li>
        );
      })}
    </ul>
  );
}

export function BlockerCards({ p, blockers, onGuide }: {
  p: Project;
  blockers: Diagnostic[];
  onGuide: (b: Diagnostic, g: BlockerGuide) => void;
}) {
  return <>{blockers.map((b) => {
    const g = resolveBlocker(p, b, blockers);
    const copy0 = blockerProblem(b.message, b.code, g);
    const phrase = b.code === 'CONDITION_UNDEFINED' ? undefinedFormula(p, b.objectId) : '';
    const copy = phrase ? { ...copy0, why: `${copy0.why} ${phrase}` } : copy0;
    return (
      <div key={b.id} className="blocker-card" data-export-blocker={b.code} data-guide-kind={g.kind}>
        <span className="mono">[{b.code}]</span>
        <Problem copy={copy} badge={copy.badge} buttonLabel={copy.jump} buttonAria={copy.jumpAria}
          onJump={copy.jump ? () => onGuide(b, g) : undefined}
          buttonAttrs={{ 'data-blocker-code': b.code, 'data-guide-kind': g.kind }} />
      </div>
    );
  })}</>;
}

