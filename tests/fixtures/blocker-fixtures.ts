// TURN-001 fixtures: project mutations that make checkGroupReadiness emit real Diagnostics (shared by unit + jsdom tests).
import { buildSampleProject } from '../../src/model/sample';
import type { Project } from '../../src/model/types';
import type { BlockerGuide } from '../../src/ui/blockerTarget';

export const S1 = 'U-PS1';
export const undef = (note: string) => ({ kind: 'undefined' as const, note });
export const first = (p: Project) => { const s = p.substationSequences!.find((q) => q.unitId === S1)!.steps[0]; return { s, a: p.actions.find((x) => x.id === s.actionId)! }; };
const twoMaterials = (p: Project) => { const m = buildSampleProject().materials[0]; p.materials = [1, 2].map((i) => ({ ...structuredClone(m), id: `MAT-T${i}`, initialLocation: S1, route: [] })); };

/** fixtures that produce real Diagnostics through checkGroupReadiness — shared with the React test */
export const FIXTURES: { name: string; code: string; mutate: (p: Project) => void; unitId?: string; expect: Partial<BlockerGuide> & { label?: string }; focusId?: string; ui?: false }[] = [
  { name: 'step entry undefined only', code: 'CONDITION_UNDEFINED', mutate: (p) => { first(p).s.entry = [undef('review-entry')]; }, expect: { kind: 'unsupported', label: '4 자재·시퀀스 › Substation 시퀀스' } },
  { name: 'Action.pre undefined', code: 'CONDITION_UNDEFINED', mutate: (p) => { first(p).a.pre = [undef('pre')]; }, expect: { kind: 'fix', label: '3 속성·Action › Action' }, focusId: 'STP-A1' },
  { name: 'Action.post undefined', code: 'CONDITION_UNDEFINED', mutate: (p) => { first(p).a.post = [undef('post')]; }, expect: { kind: 'fix', label: '3 속성·Action › Action' }, focusId: 'STP-A1' },
  { name: 'step timeoutOverride value null (Action timeout set)', code: 'TIMEOUT_UNDEFINED', mutate: (p) => { const { s, a } = first(p); s.timeoutOverride = { ...a.timeout, value: null }; }, expect: { kind: 'unsupported', label: '4 자재·시퀀스 › Substation 시퀀스' } },
  { name: 'Action.timeout null (no override)', code: 'TIMEOUT_UNDEFINED', mutate: (p) => { const { a } = first(p); a.timeout = { ...a.timeout, value: null }; }, expect: { kind: 'fix', label: '3 속성·Action › Action' }, focusId: 'STP-A1' },
  { name: 'Action complete signal missing', code: 'NO_COMPLETE_SIGNAL', mutate: (p) => { first(p).a.completeSignalId = null; }, expect: { kind: 'fix', label: '3 속성·Action › Action' }, focusId: 'STP-A1' },
  { name: 'Action duration null', code: 'DURATION_UNDEFINED', mutate: (p) => { const { a } = first(p); a.duration = { ...a.duration, value: null }; }, expect: { kind: 'fix', label: '3 속성·Action › Action' }, focusId: 'STP-A1' },
  { name: 'destination capacity null', code: 'CAPACITY_UNDEFINED', mutate: (p) => { first(p).a.effect = { moveTo: 'U-PS2' }; const u = p.units.find((x) => x.id === 'U-PS2')!; u.capacity.maxMaterials = { ...u.capacity.maxMaterials, value: null }; }, expect: { kind: 'fix', label: '3 속성·Action › 속성 (수용 개수)' }, focusId: 'U-PS2' },
  { name: 'materials 0 (material-touching step)', code: 'MATERIAL_COUNT', mutate: (p) => { first(p).a.effect = { moveTo: 'U-PS2' }; p.materials = []; }, expect: { kind: 'fix', label: '4 자재·시퀀스 › 자재·Flow (F4)' } },
  { name: 'materials 2', code: 'MATERIAL_COUNT', mutate: (p) => { first(p).a.effect = { moveTo: 'U-PS2' }; twoMaterials(p); }, expect: { kind: 'unsupported', dest: undefined } },
  { name: 'material initial location missing', code: 'MAT_NO_LOCATION', mutate: (p) => { first(p).a.effect = { moveTo: 'U-PS2' }; twoMaterials(p); p.materials = [{ ...p.materials[0], initialLocation: null }]; }, expect: { kind: 'fix', label: '4 자재·시퀀스 › 자재·Flow (F4)' } },
  { name: 'device used by two sequences', code: 'DEVICE_CONFLICT', mutate: (p) => { const q = p.substationSequences!.filter((x) => x.unitId === S1); q[0].steps.push({ ...structuredClone(q[1].steps[0]), id: 'SSTEP-CONFLICT' }); }, expect: { kind: 'fix', label: '4 자재·시퀀스 › Substation 시퀀스' } },
  { name: 'missing signal reference (validateProject)', code: 'REF_MISSING_SIGNAL', mutate: (p) => { first(p).a.commandSignalId = 'SIG-NOPE'; }, expect: { kind: 'inspect', label: '5 점검 › 진단·저장·AML' }, ui: false }, // a project with a broken reference is not opened from storage (load rejects it) → unit test only
];

