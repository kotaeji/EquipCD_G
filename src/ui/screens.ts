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
}

/** Which of the 31 base screens the current view is showing. Dialogs S71–S73 are overlays, not this value. */
export function screenOf(s: ScreenInput): string {
  if (s.home) return 'S00';
  if (s.step === 'library') {
    if (s.sub === 'input') return 'S13';
    if (s.sub === 'aml') return 'S12';
    if (s.sub === 'extract') return 'S14';
    return 'S10';
  }
  if (s.step === 'canvas') return 'S20';
  if (s.step === 'attributes') {
    if (s.rightTab === 'signals') return 'S31';
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
