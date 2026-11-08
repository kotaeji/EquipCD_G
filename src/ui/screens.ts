// Screen ids from the Figma handoff (31 base screens). View routing only — not a model field.
import type { StepId } from './wizard';

export interface ScreenInput {
  home: boolean;
  step: StepId;
  sub: string;
  rightTab: string;
  runMode: 'station' | 'group';
  groupBlocked: boolean;
  stationError: boolean;
  /** S11 card detail, still on the library step. */
  libDetail?: boolean;
  /** Full-page guides that are not a wizard step: S03 files, S04 bundle, S70 search. */
  guide?: 'files' | 'bundle' | 'search' | null;
}

/** Which of the 31 base screens the current view is showing. Dialogs S01, S02, S21, S71–S73 stay overlays on top of this value. */
export function screenOf(s: ScreenInput): string {
  if (s.guide === 'files') return 'S03';
  if (s.guide === 'bundle') return 'S04';
  if (s.guide === 'search') return 'S70';
  if (s.home) return 'S00';
  if (s.step === 'library') {
    if (s.sub === 'input') return 'S13';
    if (s.sub === 'aml') return 'S12';
    if (s.sub === 'extract') return 'S14';
    if (s.libDetail) return 'S11';
    return 'S10';
  }
  if (s.step === 'canvas') return 'S20';
  if (s.step === 'attributes') {
    if (s.rightTab === 'signals' || s.rightTab === 'positions') return 'S31';
    if (s.rightTab === 'actions' || s.rightTab === 'check') return 'S32';
    return 'S30';
  }
  if (s.step === 'sequence') {
    if (s.sub === 'material') return 'S40';
    if (s.sub === 'subseq') return 'S42';
    if (s.sub === 'sfc') return 'S43';
    if (s.sub === 'extend') return 'S44';
    return 'S41';
  }
  if (s.step === 'check') {
    if (s.sub === 'diag') return 'S51';
    if (s.sub === 'export') return 'S52';
    if (s.sub === 'lab') return 'S53';
    return 'S50';
  }
  if (s.runMode === 'group') return s.groupBlocked ? 'S62' : 'S61';
  return s.stationError ? 'S62' : 'S60';
}
