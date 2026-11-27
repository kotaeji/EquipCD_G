// Swatch, letter, and optional name for one material kind (TURN-091).
import type { MaterialKindLook } from '../model/materialKind';
import './material-kind.css';

export function MaterialKindSwatch({ look }: { look: MaterialKindLook }) {
  return <span className={`mat-swatch mat-slot-${look.slot}`} data-mat-pattern={look.pattern} aria-hidden="true" />;
}

/** Color, pattern, and letter. The name is the definition name, not the letter. */
export function MaterialKindMark({ look, name = false }: { look: MaterialKindLook; name?: boolean }) {
  return (
    <span className={`mat-kind mat-slot-${look.slot}`} data-mat-token={look.token} data-mat-pattern={look.pattern} data-mat-mark={look.mark}>
      <MaterialKindSwatch look={look} />
      <span className="mat-kind-letter">{look.mark}</span>
      {name ? <span className="mat-kind-name">{look.name}</span> : null}
    </span>
  );
}

/** The sentence keeps the letter. The swatch carries the color and the pattern. */
export function MaterialKindText({ look, text }: { look: MaterialKindLook; text: string }) {
  return (
    <span className={`mat-kind mat-slot-${look.slot}`} data-mat-token={look.token} data-mat-pattern={look.pattern} data-mat-mark={look.mark}>
      <MaterialKindSwatch look={look} />
      <span>{text}</span>
    </span>
  );
}
