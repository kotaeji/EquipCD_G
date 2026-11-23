import type { ReactNode } from 'react';
import './data-table.css';

/** One table class for the screens in TURN-068. Appearance only. */
export const ECD_TABLE = 'ecd-table';

/** One line, with the full text on `title`. The visible words stay the same. */
export function Clip({ text, children }: { text: string; children?: ReactNode }) {
  return <span className="ecd-clip" title={text}>{children ?? text}</span>;
}
