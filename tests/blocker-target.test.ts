// TURN-001 (rev 2): group-run blocker guidance resolved per ACTUAL Diagnostic object, from real gate output.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildParallelSampleProject } from '../src/model/sample';
import { FIXTURES, first, S1, undef } from './fixtures/blocker-fixtures';
import { checkGroupReadiness, createGroupRuntime, startGroup } from '../src/runtime/group';
import { destLabel, GROUP_CODES, guideCopy, resolveBlocker, VALIDATE_ERROR_CODES } from '../src/ui/blockerTarget';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const run = (f: (typeof FIXTURES)[number]) => { const p = buildParallelSampleProject(); f.mutate(p); const r = checkGroupReadiness(p, f.unitId ?? S1); return { p, r, b: r.blockers.find((x) => x.code === f.code)! }; };

describe('TURN-001 blocker guidance (real Diagnostics)', () => {
  it.each(FIXTURES)('$name → $code → $expect.kind', (f) => {
    const { p, r, b } = run(f);
    expect(r.ok).toBe(false);
    expect(b, `gate must emit ${f.code}`).toBeDefined();
    const g = resolveBlocker(p, b, r.blockers);
    expect(g.kind).toBe(f.expect.kind);
    if (f.expect.label) expect(destLabel(g.dest!)).toBe(f.expect.label);
    if ('dest' in f.expect && f.expect.dest === undefined) expect(g.dest).toBeUndefined();
    expect(g.focus?.id).toBe(f.focusId);
    const c = guideCopy(b.code, g);
    if (g.kind === 'fix') { expect(c.lead).toMatch(/^수정 위치: /); expect(c.aria).toContain('원인 수정'); }
    if (g.kind === 'inspect') { expect(c.lead).toMatch(/^원인 확인: /); expect(c.aria).toContain('직접 수정 위치 아님'); expect(c.aria).not.toContain('원인 수정'); }
    if (g.kind === 'unsupported') { expect(c.badge).toBe('현재 화면에서 직접 편집 불가'); expect(c.lead).not.toMatch(/수정 위치/); expect(c.aria ?? '').not.toContain('원인 수정'); }
    expect(startGroup(createGroupRuntime(p, f.unitId ?? S1)).state).toMatchObject({ status: 'idle', timeMs: 0 }); // gate still blocks
  });

  it('H1: mixed Action.pre + step entry undefined → first blocker fix (Action), second unsupported (step entry)', () => {
    const p = buildParallelSampleProject(); const { s, a } = first(p);
    a.pre = [undef('pre')]; s.entry = [undef('entry')];
    const r = checkGroupReadiness(p, S1);
    const conds = r.blockers.filter((b) => b.code === 'CONDITION_UNDEFINED' && b.objectId === s.id);
    expect(conds.length).toBe(2);
    expect(conds.map((b) => resolveBlocker(p, b, r.blockers).kind)).toEqual(['fix', 'unsupported']);
    // without the gate list the ordinal is unknown → never claims a fix
    expect(resolveBlocker(p, { ...conds[1] }, r.blockers).kind).toBe('inspect');
  });

  it('H1/H2: editing the Action does NOT clear step-level causes (why they are "unsupported"); fix causes clear when the shown field is edited', () => {
    const e = buildParallelSampleProject(); first(e).s.entry = [undef('x')]; first(e).a.pre = []; first(e).a.post = [];
    expect(checkGroupReadiness(e, S1).blockers.map((b) => b.code)).toContain('CONDITION_UNDEFINED');
    const o = buildParallelSampleProject(); { const { s, a } = first(o); s.timeoutOverride = { ...a.timeout, value: null }; a.timeout = { ...a.timeout, value: 10 }; }
    expect(checkGroupReadiness(o, S1).blockers.map((b) => b.code)).toContain('TIMEOUT_UNDEFINED');
    const t = buildParallelSampleProject(); { const { a } = first(t); a.timeout = { ...a.timeout, value: null }; }
    expect(checkGroupReadiness(t, S1).blockers.map((b) => b.code)).toContain('TIMEOUT_UNDEFINED');
    { const { a } = first(t); a.timeout = { ...a.timeout, value: 3 }; }
    expect(checkGroupReadiness(t, S1).ok).toBe(true);
  });

  it('M2/unknown: NO_SUBSTATION and unknown codes are inspect-only (5 점검), never a create/fix promise', () => {
    const p = buildParallelSampleProject();
    const r = checkGroupReadiness(p, 'U-DOES-NOT-EXIST');
    const g = resolveBlocker(p, r.blockers[0], r.blockers);
    expect([r.blockers[0].code, g.kind, destLabel(g.dest!)]).toEqual(['NO_SUBSTATION', 'inspect', '5 점검 › 점검']);
    expect(g.note).toContain('다시 선택');
    for (const code of ['SOMETHING_NEW', '__proto__']) { const x = { code, objectId: '' }; expect(resolveBlocker(p, x, [x])).toMatchObject({ kind: 'inspect', dest: { step: 'check' } }); }
  });

  it('coverage: code lists match the gate source exactly; no label says "3 시퀀스"', () => {
    const g = src('runtime/group.ts');
    const groupCodes = [...g.slice(g.indexOf('export function checkGroupReadiness'), g.indexOf('function initialState')).matchAll(/\bb\('([A-Z_]+)'/g)].map((m) => m[1]);
    expect(new Set(GROUP_CODES)).toEqual(new Set(groupCodes));
    const v = src('model/validate.ts');
    const vErr = new Set(v.split('\n').flatMap((l) => (l.includes("'warning'") ? [] : [...l.matchAll(/\b(?:err|push)\('([A-Z_]+)'/g)].map((m) => m[1]))));
    expect(new Set(VALIDATE_ERROR_CODES)).toEqual(vErr);
    const p = buildParallelSampleProject();
    for (const code of [...GROUP_CODES, ...VALIDATE_ERROR_CODES]) { const x = { code, objectId: '' }; const c = guideCopy(code, resolveBlocker(p, x, [x])); expect(`${c.lead} ${c.button ?? ''}`).not.toMatch(/3 시퀀스/); }
    expect(src('ui/SubstationPanels.tsx')).not.toContain('3 시퀀스 단계');
    const app = src('ui/App.tsx');
    for (const k of ["['subseq', `Substation 시퀀스", "['material', '자재·Flow (F4)']", "['diag', '진단·저장·AML']"]) expect(app).toContain(k);
  });
});
