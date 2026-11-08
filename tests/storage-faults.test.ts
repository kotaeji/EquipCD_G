// TURN-002 rev 3 — storage failure regressions with a STRICT fault double (throwaway in-memory data only).
// Every injected fault is counted when it actually throws; each case asserts hit === 1 (no "no-op" injections).
// Values are stored like Web Storage (String(v)), so a bad journal writing `undefined` would be visible.
import { describe, expect, it } from 'vitest';
import { buildSampleProject } from '../src/model/sample';
import { INDEX_KEY, PROJECT_KEY, readIndex, saveProject, type KV } from '../src/storage/localStore';
import { recoverJournal, TXN_KEY } from '../src/storage/txn';
import * as W from '../src/storage/workspaces';

type Op = 'get' | 'set' | 'remove';
interface Spec { op: Op; key: string | ((k: string) => boolean); nth: number; hits: number }
/** Web-Storage-like KV with a call trace and exact-call fault injection */
class StrictKV implements KV {
  m = new Map<string, string>(); trace: [Op, string][] = []; tracing = false;
  private specs: Spec[] = []; private cnt = new Map<string, number>(); private any: Spec[] = [];
  /** install faults; counters start from zero at install time */
  inject(...s: Omit<Spec, 'hits'>[]) { this.cnt.clear(); this.specs = s.map((x) => ({ ...x, hits: 0 })); return this.specs; }
  /** fail every matching call from now on (used to make a rollback fail too) */
  failAll(op: Op, key: (k: string) => boolean) { const s = { op, key, nth: 0, hits: 0 }; this.any.push(s); return s; }
  clear() { this.specs = []; this.any = []; this.cnt.clear(); }
  private hit(op: Op, k: string) {
    if (this.tracing) this.trace.push([op, k]);
    const id = `${op}:${k}`; const c = (this.cnt.get(id) ?? 0) + 1; this.cnt.set(id, c);
    const m = (s: Spec) => s.op === op && (typeof s.key === 'string' ? s.key === k : s.key(k));
    for (const s of this.specs) if (m(s) && s.nth === c) { s.hits++; throw new Error(`injected ${op} ${k} #${c}`); }
    for (const s of this.any) if (m(s)) { s.hits++; throw new Error(`injected ${op} ${k} (all)`); }
  }
  getItem(k: string) { this.hit('get', k); return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.hit('set', k); this.m.set(k, String(v)); }
  removeItem(k: string) { this.hit('remove', k); this.m.delete(k); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}
const T0 = new Date('2026-11-08T09:00:00Z');
const proj = (id: string, name: string) => ({ ...buildSampleProject(), id, name });
const all = (kv: StrictKV) => Object.fromEntries([...kv.m].sort(([a], [b]) => a.localeCompare(b)));
const P = PROJECT_KEY;
function base(ids = ['prj-a', 'prj-b']) {
  const kv = new StrictKV();
  ids.forEach((id, i) => saveProject(kv, proj(id, `${id} 라인`), new Date(Date.UTC(2026, 10, 1 + i))));
  const reg = W.ensureWorkspaces(kv, T0).reg; return { kv, reg };
}
const listed = (kv: StrictKV) => { const r = W.ensureWorkspaces(kv, T0).reg; return W.listProjects(kv, r, r.activeId).map((e) => e.id).sort(); };
/** every index entry has a body and every body is listed (no hidden or ghost projects) */
const consistent = (kv: StrictKV) => {
  const bodies = [...kv.m.keys()].filter((k) => k.startsWith('ecd.v1.project.')).map((k) => k.slice('ecd.v1.project.'.length)).sort();
  expect(readIndex(kv).map((e) => e.id).sort()).toEqual(bodies);
};

// ------------------------------------------------------------------------------------------------ R1
describe('R1 — registry read failure: the same session must not replace the valid stored registry', () => {
  const setup = () => {
    const { kv, reg } = base(); const c = W.createWorkspace(reg, 'B', T0, 'ws-b'); if (!c.ok) throw new Error();
    expect(W.writeRegistry(kv, c.reg, reg).ok).toBe(true); return kv;
  };
  it('first WS_KEY read throws → memory session; later createWorkspace+writeRegistry is refused; ws-b survives', () => {
    const kv = setup(); const before = all(kv);
    const [s] = kv.inject({ op: 'get', key: W.WS_KEY, nth: 1 });
    const e = W.ensureWorkspaces(kv, T0); expect(s.hits).toBe(1); kv.clear();
    expect(e.persisted).toBe(false); expect(all(kv)).toEqual(before);
    const c = W.createWorkspace(e.reg, 'C', T0, 'ws-c'); if (!c.ok) throw new Error();
    const w = W.writeRegistry(kv, c.reg, e.reg);
    expect(w.ok).toBe(false); expect(all(kv)).toEqual(before);
    expect(JSON.parse(kv.m.get(W.WS_KEY)!).workspaces.map((x: W.Workspace) => x.id)).toEqual([W.DEFAULT_WS_ID, 'ws-b']);
  });
  it('same session: saving into the stale memory registry is refused too (no body/index/registry change)', () => {
    const kv = setup(); const before = all(kv);
    const [s] = kv.inject({ op: 'get', key: W.WS_KEY, nth: 1 }); const e = W.ensureWorkspaces(kv, T0); expect(s.hits).toBe(1); kv.clear();
    expect(W.saveProjectInWorkspace(kv, e.reg, e.reg.activeId, proj('prj-n', 'N'), T0).ok).toBe(false);
    expect(W.deleteSavedProject(kv, e.reg, 'prj-a').ok).toBe(false);
    expect(all(kv)).toEqual(before);
  });
  it('restart after the read failure (read ok) → original registry, writes allowed again', () => {
    const kv = setup(); kv.inject({ op: 'get', key: W.WS_KEY, nth: 1 }); W.ensureWorkspaces(kv, T0); kv.clear();
    const e = W.ensureWorkspaces(kv, T0); expect(e.persisted).toBe(true);
    expect(e.reg.workspaces.map((x) => x.id)).toEqual([W.DEFAULT_WS_ID, 'ws-b']);
    const c = W.createWorkspace(e.reg, 'C', T0, 'ws-c'); if (!c.ok) throw new Error();
    expect(W.writeRegistry(kv, c.reg, e.reg).ok).toBe(true);
  });
  it('a second session/tab changed the registry meanwhile → stale write refused (compare-before-write)', () => {
    const kv = setup(); const e = W.ensureWorkspaces(kv, T0);
    const other = W.renameWorkspace(e.reg, 'ws-b', 'B2'); if (!other.ok) throw new Error(); expect(W.writeRegistry(kv, other.reg, e.reg).ok).toBe(true);
    const mine = W.createWorkspace(e.reg, 'C', T0, 'ws-c'); if (!mine.ok) throw new Error();
    expect(W.writeRegistry(kv, mine.reg, e.reg).ok).toBe(false);
    expect(JSON.parse(kv.m.get(W.WS_KEY)!).workspaces.map((x: W.Workspace) => x.name)).toEqual([W.DEFAULT_WS_NAME, 'B2']);
  });
  it('backup-candidate key read throws → ensureWorkspaces does not throw, original kept, memory session', () => {
    const { kv } = base(); kv.m.set(W.WS_KEY, '{CORRUPT'); kv.m.set(`${W.WS_CORRUPT_KEY}.1`, 'older'); const before = all(kv);
    const [s] = kv.inject({ op: 'get', key: `${W.WS_CORRUPT_KEY}.1`, nth: 1 });
    let e: W.EnsureResult | null = null; expect(() => { e = W.ensureWorkspaces(kv, T0); }).not.toThrow(); expect(s.hits).toBe(1); kv.clear();
    expect(e!.persisted).toBe(false); expect(all(kv)).toEqual(before);
    expect(W.writeRegistry(kv, e!.reg, e!.reg).ok).toBe(false); expect(all(kv)).toEqual(before);
  });
});

// ------------------------------------------------------------------------------------------------ R2
describe('R2 — an untrusted journal never changes data: strict validation, fail closed, journal kept', () => {
  /** produce a REAL leftover journal: delete prj-a, body remove fails, rollback index write fails */
  const leftover = () => {
    const { kv, reg } = base();
    const sp = kv.inject({ op: 'remove', key: P('prj-a'), nth: 1 }, { op: 'set', key: INDEX_KEY, nth: 2 });
    const r = W.deleteSavedProject(kv, reg, 'prj-a'); expect(r.ok).toBe(false); expect(sp.map((x) => x.hits)).toEqual([1, 1]); kv.clear();
    expect(kv.m.get(TXN_KEY)).toBeTruthy(); return { kv, reg, j: JSON.parse(kv.m.get(TXN_KEY)!) };
  };
  const bad: [string, (kv: StrictKV, j: any) => string][] = [
    ['review input: before missing + invalid hash', () => JSON.stringify({ v: 1, label: 'broken', ops: [{ key: P('prj-a'), after: 'invalid-hash' }] })],
    ['review input: null op', () => '{"v":1,"ops":[null]}'],
    ['not JSON', () => '{journal'],
    ['JSON but not an object', () => '[1,2]'],
    ['unknown version', (_k, j) => JSON.stringify({ ...j, v: 9 })],
    ['empty ops', (_k, j) => JSON.stringify({ ...j, ops: [] })],
    ['before of wrong type', (_k, j) => JSON.stringify({ ...j, ops: j.ops.map((o: any, i: number) => (i ? o : { ...o, before: 42 })) })],
    ['after hash malformed', (_k, j) => JSON.stringify({ ...j, ops: j.ops.map((o: any, i: number) => (i ? o : { ...o, after: 'zz' })) })],
    ['key outside the app data keys', (_k, j) => JSON.stringify({ ...j, ops: [...j.ops, { ...j.ops[0], key: 'other.app.key' }] })],
    ['journal key references itself', (_k, j) => JSON.stringify({ ...j, ops: [...j.ops, { ...j.ops[0], key: TXN_KEY }] })],
    ['duplicate key', (_k, j) => JSON.stringify({ ...j, ops: [...j.ops, j.ops[0]] })],
    ['extra field', (_k, j) => JSON.stringify({ ...j, extra: 1 })],
    ['old value tampered (checksum mismatch)', (_k, j) => JSON.stringify({ ...j, ops: j.ops.map((o: any) => (o.key === INDEX_KEY ? { ...o, before: '[]' } : o)) })],
    ['old value hash does not match old value', (_k, j) => JSON.stringify({ ...j, ops: j.ops.map((o: any) => (o.key === INDEX_KEY ? { ...o, beforeHash: '1:0' } : o)) })],
  ];
  it.each(bad)('%s → recoverJournal fails, every key (journal included) byte-identical; startup does not throw; writes blocked', (_n, make) => {
    const { kv, reg, j } = leftover(); kv.m.set(TXN_KEY, make(kv, j)); const before = all(kv);
    kv.tracing = true; kv.trace = [];
    const r = recoverJournal(kv); expect(r.ok).toBe(false);
    expect(kv.trace.filter(([o]) => o !== 'get')).toEqual([]); expect(all(kv)).toEqual(before);
    let e: W.EnsureResult | null = null; expect(() => { e = W.ensureWorkspaces(kv, T0); }).not.toThrow();
    expect(e!.persisted).toBe(false); expect(e!.warnings.join()).toContain('복구 기록');
    expect(W.saveProjectInWorkspace(kv, reg, reg.activeId, proj('prj-n', 'N'), T0).ok).toBe(false);
    expect(W.deleteSavedProject(kv, reg, 'prj-b').ok).toBe(false);
    expect(kv.trace.filter(([o]) => o !== 'get')).toEqual([]); expect(all(kv)).toEqual(before);
  });
  it('valid journal but a target key now holds an unexpected value (changed elsewhere) → no write, journal kept', () => {
    const { kv } = leftover(); kv.m.set(INDEX_KEY, '[]'); const before = all(kv);
    kv.tracing = true; kv.trace = []; expect(recoverJournal(kv).ok).toBe(false);
    expect(kv.trace.filter(([o]) => o !== 'get')).toEqual([]); expect(all(kv)).toEqual(before);
  });
  it('the genuine leftover journal is accepted and restores the original state (positive control)', () => {
    const { kv } = leftover(); const r = recoverJournal(kv); expect(r).toEqual({ ok: true, recovered: 'rolled-back' });
    expect(kv.m.get(TXN_KEY)).toBeUndefined(); expect(listed(kv)).toEqual(['prj-a', 'prj-b']); consistent(kv);
  });
});

// ------------------------------------------------------------------------------------------------ R3
describe('R3 — same session after a failed rollback: the next write is planned AFTER recovery', () => {
  it('review input: delete prj-a (body remove + rollback index set fail) → same-session save prj-c keeps prj-a listed', () => {
    const { kv, reg } = base();
    const sp = kv.inject({ op: 'remove', key: P('prj-a'), nth: 1 }, { op: 'set', key: INDEX_KEY, nth: 2 });
    const d = W.deleteSavedProject(kv, reg, 'prj-a'); expect(d.ok).toBe(false); expect(sp.map((x) => x.hits)).toEqual([1, 1]); kv.clear();
    expect(kv.m.get(TXN_KEY)).toBeTruthy();
    const s = W.saveProjectInWorkspace(kv, reg, reg.activeId, proj('prj-c', 'C'), T0); // no ensureWorkspaces in between
    expect(s.ok).toBe(true); expect(kv.m.get(TXN_KEY)).toBeUndefined();
    expect(readIndex(kv).map((e) => e.id).sort()).toEqual(['prj-a', 'prj-b', 'prj-c']);
    expect(listed(kv)).toEqual(['prj-a', 'prj-b', 'prj-c']); consistent(kv);
  });
  it('review input 2: new prj-b save (registry set + rollback index set fail) → same-session save prj-c makes no ghost prj-b', () => {
    const { kv, reg } = base(['prj-a']);
    const sp = kv.inject({ op: 'set', key: W.WS_KEY, nth: 1 }, { op: 'set', key: INDEX_KEY, nth: 2 });
    const r = W.saveProjectInWorkspace(kv, reg, reg.activeId, proj('prj-b', 'B'), T0); expect(r.ok).toBe(false); expect(sp.map((x) => x.hits)).toEqual([1, 1]); kv.clear();
    const s = W.saveProjectInWorkspace(kv, reg, reg.activeId, proj('prj-c', 'C'), T0);
    expect(s.ok).toBe(true); expect(readIndex(kv).map((e) => e.id).sort()).toEqual(['prj-a', 'prj-c']); consistent(kv);
    expect(listed(kv)).toEqual(['prj-a', 'prj-c']);
  });
  it('same for closed rename and registry write after a leftover journal', () => {
    const { kv, reg } = base();
    kv.inject({ op: 'remove', key: P('prj-a'), nth: 1 }, { op: 'set', key: INDEX_KEY, nth: 2 }); W.deleteSavedProject(kv, reg, 'prj-a'); kv.clear();
    expect(W.renameSavedProject(kv, 'prj-b', 'B2', T0).ok).toBe(true);
    expect(readIndex(kv).map((e) => [e.id, e.name]).sort()).toEqual([['prj-a', 'prj-a 라인'], ['prj-b', 'B2']]); consistent(kv);
    const c = W.createWorkspace(reg, 'C', T0, 'ws-c'); if (!c.ok) throw new Error();
    expect(W.writeRegistry(kv, c.reg, reg).ok).toBe(true); expect(listed(kv)).toEqual(['prj-a', 'prj-b']);
  });
});

// --------------------------------------------------------------------- trace-driven fault matrix (real hits only)
type Ctx = { kv: StrictKV; reg: W.WorkspaceRegistry };
interface Case { name: string; setup: () => Ctx; run: (c: Ctx) => { ok: boolean } }
const cases: Case[] = [
  { name: 'delete prj-a', setup: () => base(), run: ({ kv, reg }) => W.deleteSavedProject(kv, reg, 'prj-a') },
  { name: 'rename prj-a (closed)', setup: () => base(), run: ({ kv }) => W.renameSavedProject(kv, 'prj-a', 'Renamed', T0) },
  { name: 'save new prj-n', setup: () => base(), run: ({ kv, reg }) => W.saveProjectInWorkspace(kv, reg, reg.activeId, proj('prj-n', 'N'), T0) },
  { name: 'new-ID copy into ws-b', setup: () => { const b = base(); const c = W.createWorkspace(b.reg, 'B', T0, 'ws-b'); if (!c.ok) throw new Error(); const a = W.setActive(c.reg, 'ws-b'); if (!a.ok) throw new Error(); expect(W.writeRegistry(b.kv, a.reg, b.reg).ok).toBe(true); return { kv: b.kv, reg: a.reg }; },
    run: ({ kv, reg }) => W.saveProjectInWorkspace(kv, reg, 'ws-b', proj('prj-a-copy-1', 'A 사본'), T0) },
  { name: 'registry write (create ws-c)', setup: () => base(), run: ({ kv, reg }) => { const c = W.createWorkspace(reg, 'C', T0, 'ws-c'); if (!c.ok) throw new Error(); return W.writeRegistry(kv, c.reg, reg); } },
];
const dataKey = (k: string) => k === INDEX_KEY || k === W.WS_KEY || k.startsWith('ecd.v1.project.');
export const matrixStats = { cases: 0, hits: 0 };
describe('fault matrix — every storage call the operation really makes fails once (hit asserted)', () => {
  for (const c of cases) {
    const dry = c.setup(); const before = all(dry.kv); dry.kv.tracing = true; expect(c.run(dry).ok).toBe(true);
    const trace = dry.kv.trace.slice(); const after = all(dry.kv);
    const nth = trace.map(([op, k], i) => trace.slice(0, i + 1).filter(([o2, k2]) => o2 === op && k2 === k).length);
    it(`${c.name}: dry run makes ${trace.length} calls incl. journal write/remove`, () => {
      expect(trace).toContainEqual(['set', TXN_KEY]); expect(trace).toContainEqual(['remove', TXN_KEY]); expect(before).not.toEqual(after);
    });
    trace.forEach(([op, k], i) => {
      for (const rollbackFails of [false, true]) {
        it(`${c.name}: call #${i + 1} ${op} ${k} (#${nth[i]})${rollbackFails ? ' + every later data write fails' : ''}`, () => {
          const ctx = c.setup(); expect(all(ctx.kv)).toEqual(before);
          const [s] = ctx.kv.inject({ op, key: k, nth: nth[i] });
          if (rollbackFails) { ctx.kv.failAll('set', (x) => s.hits > 0 && dataKey(x)); ctx.kv.failAll('remove', (x) => s.hits > 0 && dataKey(x)); }
          const r = c.run(ctx); expect(s.hits).toBe(1); matrixStats.cases++; matrixStats.hits += s.hits; ctx.kv.clear();
          const sess = all(ctx.kv);
          // same session, next write (planned after recovery) — then restart
          const next = W.saveProjectInWorkspace(ctx.kv, r.ok ? W.ensureWorkspaces(ctx.kv, T0).reg : ctx.reg, ctx.reg.activeId, proj('prj-z', 'Z'), T0);
          expect(next.ok).toBe(true);
          const fin = all(ctx.kv); const want = { ...(r.ok ? after : before) };
          delete fin[P('prj-z')]; const fi = JSON.parse(fin[INDEX_KEY]).filter((e: { id: string }) => e.id !== 'prj-z'); const wi = JSON.parse(want[INDEX_KEY]);
          expect(fi.map((e: { id: string; name: string; revision: number }) => [e.id, e.name, e.revision])).toEqual(wi.map((e: { id: string; name: string; revision: number }) => [e.id, e.name, e.revision]));
          for (const key of Object.keys(want)) if (key.startsWith('ecd.v1.project.')) expect(fin[key]).toBe(want[key]);
          expect(Object.keys(fin).filter((x) => x.startsWith('ecd.v1.project.')).sort()).toEqual(Object.keys(want).filter((x) => x.startsWith('ecd.v1.project.')).sort());
          const wr = JSON.parse(want[W.WS_KEY]) as W.WorkspaceRegistry; const fr = JSON.parse(fin[W.WS_KEY]) as W.WorkspaceRegistry;
          expect(fr.workspaces.map((w) => [w.id, w.name, w.projectIds.filter((x) => x !== 'prj-z')])).toEqual(wr.workspaces.map((w) => [w.id, w.name, w.projectIds]));
          expect(fin[TXN_KEY]).toBeUndefined(); consistent(ctx.kv);
          if (!r.ok && !rollbackFails) expect(sess).toEqual(before); // single failure: rolled back in-session
          const e = W.ensureWorkspaces(ctx.kv, T0); expect(e.warnings).toEqual([]); consistent(ctx.kv);
        });
      }
    });
  }
  it('stats: every matrix case had exactly one real injected hit', () => { expect(matrixStats.hits).toBe(matrixStats.cases); expect(matrixStats.cases).toBeGreaterThan(100); console.log(`[fault-matrix] cases=${matrixStats.cases} realHits=${matrixStats.hits}`); });
});
