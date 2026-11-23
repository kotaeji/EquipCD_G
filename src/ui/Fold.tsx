import { useState } from 'react';
import { IconLabel } from './Icon';
import './fold.css';

/**
 * Collapsible block. Without `open`, it starts open and the choice stays in this component.
 * Pass `open` and `onToggle` to remember the choice outside (the stage-2 palette does).
 */
export function Fold({ className, summary, children, open: openProp, onToggle }: {
  className?: string;
  summary: React.ReactNode;
  children: React.ReactNode;
  open?: boolean;
  onToggle?: (open: boolean) => void;
}) {
  const [inner, setInner] = useState(true);
  const open = openProp ?? inner;
  return (
    <details className={className ? `ecd-fold ${className}` : 'ecd-fold'} open={open} onToggle={(e) => {
      const next = (e.currentTarget as HTMLDetailsElement).open;
      if (onToggle) onToggle(next);
      else setInner((v) => (v === next ? v : next));
    }}>
      <summary><IconLabel id={open ? 'fold' : 'unfold'}>{summary}</IconLabel></summary>
      {children}
    </details>
  );
}
