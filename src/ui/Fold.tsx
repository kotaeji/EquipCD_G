import { useState } from 'react';

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
    <details className={className} open={open} onToggle={(e) => {
      const next = (e.currentTarget as HTMLDetailsElement).open;
      if (onToggle) onToggle(next);
      else setInner((v) => (v === next ? v : next));
    }}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
