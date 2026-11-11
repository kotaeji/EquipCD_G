import { useState } from 'react';

/** Collapsible block that starts open. The user can close it; the choice is not stored. */
export function Fold({ className, summary, children }: { className?: string; summary: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <details className={className} open={open} onToggle={(e) => {
      const next = (e.currentTarget as HTMLDetailsElement).open;
      setOpen((v) => (v === next ? v : next));
    }}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
