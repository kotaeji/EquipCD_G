// TURN-002 storage tests (pure, in-memory KV — throwaway data only).
import { describe, expect, it } from 'vitest';
import { buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { parseProjectFile, serializeProject } from '../src/storage/fileFormat';
import { INDEX_KEY, PROJECT_KEY, readIndex, saveProject, type KV } from '../src/storage/localStore';
import * as W from '../src/storage/workspaces';

type Op = 'get' | 'set' | 'remove';
class MemKV implements KV {
  m = new Map<string, string>(); failOn: ((k: string) => boolean) | null = null; writes: string[] = [];
  /** fault injection: return true to throw for this call (n = 1-based count of this op on this key) */
  fault: ((op: Op, k: string, n: number) => boolean) | null = null; private cnt = new Map<string, number>();
  private hit(op: Op, k: string) { const c = (this.cnt.get(`${op}:${k}`) ?? 0) + 1; this.cnt.set(`${op}:${k}`, c); if (this.fault?.(op, k, c)) throw new Error(`injected ${op} failure (test)`); }
  getItem(k: string) { this.hit('get', k); return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { if (this.failOn?.(k)) throw new Error('QuotaExceededError (test)'); this.hit('set', k); this.writes.push(k); this.m.set(k, v); }
  removeItem(k: string) { if (this.failOn?.(k)) throw new Error('remove failed (test)'); this.hit('remove', k); this.m.delete(k); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
  clearFaults() { this.fault = null; this.failOn = null; this.cnt.clear(); }
}
const proj = (id: string, name: string) => ({ ...buildSampleProject(), id, name });
function seeded() {
  const kv = new MemKV();
  saveProject(kv, proj('prj-a', 'A 라인'), new Date('2026-11-01T00:00:00Z'));
  saveProject(kv, proj('prj-b', 'B 라인'), new Date('2026-11-02T00:00:00Z'));
  return kv;
}
const snapshot = (kv: MemKV) => Object.fromEntries([...kv.m].filter(([k]) => k !== W.WS_KEY && !k.startsWith(W.WS_CORRUPT_KEY)));
const all = (kv: MemKV) => Object.fromEntries(kv.m);

describe('TURN-002 migration (AC1)', () => {
  it('puts every saved project into the default workspace without touching bodies/index; idempotent', () => {
    const kv = seeded(); const before = snapshot(kv);
    const r1 = W.ensureWorkspaces(kv);
    expect(r1.migrated).toBe(true); expect(r1.persisted).toBe(true);
    expect(r1.reg.workspaces).toHaveLength(1);
    expect(r1.reg.workspaces[0]).toMatchObject({ id: W.DEFAULT_WS_ID, name: W.DEFAULT_WS_NAME });
    expect(new Set(r1.reg.workspaces[0].projectIds)).toEqual(new Set(['prj-a', 'prj-b']));
    expect(snapshot(kv)).toEqual(before);
    const raw1 = kv.getItem(W.WS_KEY); kv.writes = [];
    const r2 = W.ensureWorkspaces(kv);
    expect(r2.migrated).toBe(false); expect(kv.writes).toEqual([]); expect(kv.getItem(W.WS_KEY)).toBe(raw1);
    expect(r2.reg).toEqual(r1.reg);
  });
  it('empty storage → one default workspace', () => {
    const kv = new MemKV(); const r = W.ensureWorkspaces(kv);
    expect(r.reg.workspaces.map((w) => w.projectIds)).toEqual([[]]);
  });
  it('registry write failure → memory registry, originals intact, warning', () => {
    const kv = seeded(); const before = snapshot(kv); kv.failOn = (k) => k === W.WS_KEY;
    const r = W.ensureWorkspaces(kv);
    expect(r.persisted).toBe(false); expect(r.warnings.join()).toContain('저장 실패');
    expect(r.reg.workspaces[0].projectIds).toHaveLength(2);
    expect(kv.getItem(W.WS_KEY)).toBeNull(); expect(snapshot(kv)).toEqual(before);
    kv.failOn = null; expect(W.ensureWorkspaces(kv).persisted).toBe(true); // recovers on next start
  });
  it('corrupt registry → raw kept in .corrupt, rebuilt; projects intact', () => {
    const kv = seeded(); kv.m.set(W.WS_KEY, '{broken'); const before = snapshot(kv);
    const r = W.ensureWorkspaces(kv);
    expect(Object.keys(Object.fromEntries(kv.m)).filter((k) => k.startsWith(`${W.WS_CORRUPT_KEY}.`)).map((k) => kv.m.get(k))).toEqual(['{broken']); expect(r.warnings.length).toBe(1);
    expect(r.reg.workspaces[0].projectIds).toHaveLength(2); expect(snapshot(kv)).toEqual(before);
  });
  it('reconcile: orphans → default, duplicate membership → first owner, bad activeId → first workspace', () => {
    const reg: W.WorkspaceRegistry = { formatVersion: 1, activeId: 'gone', workspaces: [
      { id: 'ws-x', name: 'X', createdAt: '', updatedAt: '', projectIds: ['prj-a'] },
      { id: W.DEFAULT_WS_ID, name: '기본', createdAt: '', updatedAt: '', projectIds: ['prj-a'] }] };
    const r = W.reconcile(reg, ['prj-a', 'prj-b']);
    expect(r.activeId).toBe('ws-x');
    expect(r.workspaces.find((w) => w.id === 'ws-x')!.projectIds).toEqual(['prj-a']);
    expect(r.workspaces.find((w) => w.id === W.DEFAULT_WS_ID)!.projectIds).toEqual(['prj-b']);
  });
  it('project JSON format unchanged (export bytes equal, no workspace fields)', () => {
    const kv = seeded(); const p = parseProjectFile(kv.getItem(PROJECT_KEY('prj-a'))!);
    W.ensureWorkspaces(kv);
    expect(p.ok).toBe(true); if (!p.ok) return;
    expect(serializeProject(p.project)).toBe(kv.getItem(PROJECT_KEY('prj-a')));
    expect(kv.getItem(PROJECT_KEY('prj-a'))).not.toMatch(/workspace|ws-default/i);
  });
  it('index has no 50-entry cap any more (saved projects never drop out of a workspace)', () => {
    const kv = new MemKV(); for (let i = 0; i < 55; i++) saveProject(kv, proj(`prj-${i}`, `P${i}`));
    expect(readIndex(kv)).toHaveLength(55);
    expect(W.listProjects(kv, W.ensureWorkspaces(kv).reg, W.DEFAULT_WS_ID)).toHaveLength(55);
  });
});

describe('TURN-002 workspace CRUD rules (AC2)', () => {
  const base = () => W.ensureWorkspaces(seeded()).reg;
  it('names: blank / spaces / duplicate (case-insensitive) / too long rejected; normalised; stable id on rename', () => {
    const reg = base();
    expect(W.createWorkspace(reg, '   ').ok).toBe(false);
    expect(W.createWorkspace(reg, '기본 workspace').ok).toBe(false); // dup of "기본 Workspace"
    expect(W.createWorkspace(reg, 'x'.repeat(61)).ok).toBe(false);
    const c = W.createWorkspace(reg, '  설비   B  ', new Date(), 'ws-b'); expect(c.ok).toBe(true); if (!c.ok) return;
    expect(c.ws.name).toBe('설비 B');
    const r = W.renameWorkspace(c.reg, 'ws-b', '설비 C'); expect(r.ok && r.reg.workspaces.find((w) => w.id === 'ws-b')!.name).toBe('설비 C');
    expect(W.renameWorkspace(c.reg, 'ws-b', W.DEFAULT_WS_NAME).ok).toBe(false);
    expect(W.renameWorkspace(c.reg, 'ws-b', '설비 b').ok).toBe(true); // same workspace, case change allowed
  });
  it('delete: only empty, never the last, never the active; no cascade', () => {
    const reg = base();
    expect(W.deleteWorkspace(reg, W.DEFAULT_WS_ID, 0).ok).toBe(false); // last
    const c = W.createWorkspace(reg, 'B', new Date(), 'ws-b'); if (!c.ok) throw new Error();
    expect(W.deleteBlockReason(c.reg, W.DEFAULT_WS_ID, 2)).toContain('현재');
    const sw = W.setActive(c.reg, 'ws-b'); if (!sw.ok) throw new Error();
    expect(W.deleteBlockReason(sw.reg, W.DEFAULT_WS_ID, 2)).toContain('저장 프로젝트 2개');
    expect(W.deleteBlockReason(sw.reg, 'ws-b', 0)).toContain('현재');
    const sw2 = W.setActive(sw.reg, W.DEFAULT_WS_ID); if (!sw2.ok) throw new Error();
    const d = W.deleteWorkspace(sw2.reg, 'ws-b', 0); expect(d.ok && d.reg.workspaces.map((w) => w.id)).toEqual([W.DEFAULT_WS_ID]);
  });
});

describe('TURN-002 project storage operations (AC3)', () => {
  it('membership isolation: attach refuses an id owned by another workspace; listProjects scoped', () => {
    const kv = seeded(); let reg = W.ensureWorkspaces(kv).reg;
    const c = W.createWorkspace(reg, 'B', new Date(), 'ws-b'); if (!c.ok) throw new Error(); reg = c.reg;
    saveProject(kv, proj('prj-c', 'C 라인'));
    const a = W.attachProject(reg, 'ws-b', 'prj-c'); if (!a.ok) throw new Error(); reg = a.reg;
    expect(W.attachProject(reg, W.DEFAULT_WS_ID, 'prj-c').ok).toBe(false);
    expect(W.listProjects(kv, reg, 'ws-b').map((e) => e.id)).toEqual(['prj-c']);
    expect(W.listProjects(kv, reg, W.DEFAULT_WS_ID).map((e) => e.id).sort()).toEqual(['prj-a', 'prj-b']);
  });
  it('rename closed saved project: body + index updated, revision +1, id kept, other projects untouched', () => {
    const kv = seeded(); W.ensureWorkspaces(kv); const otherBefore = kv.getItem(PROJECT_KEY('prj-b'));
    const rev0 = (parseProjectFile(kv.getItem(PROJECT_KEY('prj-a'))!) as { ok: true; project: { revision: number } }).project.revision;
    const r = W.renameSavedProject(kv, 'prj-a', '  새   이름 '); expect(r.ok).toBe(true);
    const p = parseProjectFile(kv.getItem(PROJECT_KEY('prj-a'))!); if (!p.ok) throw new Error();
    expect(p.project.name).toBe('새 이름'); expect(p.project.id).toBe('prj-a'); expect(p.project.revision).toBe(rev0 + 1);
    expect(readIndex(kv).find((e) => e.id === 'prj-a')).toMatchObject({ name: '새 이름', revision: rev0 + 1 });
    expect(kv.getItem(PROJECT_KEY('prj-b'))).toBe(otherBefore);
  });
  it('rename refuses a broken saved body (no write)', () => {
    const kv = seeded(); kv.m.set(PROJECT_KEY('prj-a'), '{bad'); const idx = kv.getItem(INDEX_KEY);
    expect(W.renameSavedProject(kv, 'prj-a', 'X').ok).toBe(false);
    expect(kv.getItem(PROJECT_KEY('prj-a'))).toBe('{bad'); expect(kv.getItem(INDEX_KEY)).toBe(idx);
  });
  it('delete: body + index + membership removed; other workspace/project untouched', () => {
    const kv = seeded(); const reg = W.ensureWorkspaces(kv).reg; const bBefore = kv.getItem(PROJECT_KEY('prj-b'));
    const d = W.deleteSavedProject(kv, reg, 'prj-a'); if (!d.ok) throw new Error();
    expect(kv.getItem(PROJECT_KEY('prj-a'))).toBeNull(); expect(readIndex(kv).map((e) => e.id)).toEqual(['prj-b']);
    expect(d.reg.workspaces[0].projectIds).toEqual(['prj-b']); expect(reg.workspaces[0].projectIds).toContain('prj-a');
    expect(kv.getItem(PROJECT_KEY('prj-b'))).toBe(bBefore);
    expect(W.ensureWorkspaces(kv).reg.workspaces[0].projectIds).toEqual(['prj-b']); // deleted id does not come back
  });
  it('uniqueName / parallel sample names do not collide in scope', () => {
    expect(W.uniqueName('새 프로젝트', ['새 프로젝트', '새 프로젝트 2'])).toBe('새 프로젝트 3');
    expect(W.uniqueName(buildParallelSampleProject().name, [])).toBe(buildParallelSampleProject().name);
  });
});

// ---------------- TURN-002 rev 2: failure-injection regression (independent review H1–H4 + M2) ----------------
import { TXN_KEY } from '../src/storage/txn';
const P = (id: string) => PROJECT_KEY(id);
const visible = (kv: MemKV) => { const r = W.ensureWorkspaces(kv).reg; return r.workspaces.map((w) => [w.id, W.listProjects(kv, r, w.id).map((e) => e.id).sort()]); };

describe('H1 — registry: backup failure / read failure never overwrite the original', () => {
  it('backup write fails → WS_KEY keeps the corrupt original, memory-only, honest warning; next start (backup ok) recovers; idempotent', () => {
    const kv = seeded(); kv.m.set(W.WS_KEY, '{CORRUPT-ORIGINAL');
    kv.fault = (op, k) => op === 'set' && k.startsWith(`${W.WS_CORRUPT_KEY}.`);
    const r = W.ensureWorkspaces(kv);
    expect(kv.getItem(W.WS_KEY)).toBe('{CORRUPT-ORIGINAL'); expect(r.persisted).toBe(false);
    expect(r.warnings.join()).toContain('원문을 덮어쓰지 않았습니다'); expect(r.warnings.join()).not.toContain('별도 키에 보관');
    expect(r.reg.workspaces[0].projectIds.sort()).toEqual(['prj-a', 'prj-b']);
    // any later registry write in this session is refused too (original still protected)
    expect(W.writeRegistry(kv, r.reg, r.reg).ok).toBe(false); expect(kv.getItem(W.WS_KEY)).toBe('{CORRUPT-ORIGINAL');
    kv.clearFaults();
    const r2 = W.ensureWorkspaces(kv);
    expect(r2.persisted).toBe(true); expect([...kv.m.entries()].filter(([k]) => k.startsWith(`${W.WS_CORRUPT_KEY}.`)).map(([, v]) => v)).toEqual(['{CORRUPT-ORIGINAL']);
    kv.writes = []; W.ensureWorkspaces(kv); expect(kv.writes).toEqual([]);
  });
  it('backup read-back mismatch is treated as failure (original kept)', () => {
    const kv = seeded(); kv.m.set(W.WS_KEY, '{X');
    const orig = kv.setItem.bind(kv); kv.setItem = (k, v) => orig(k, k.startsWith(`${W.WS_CORRUPT_KEY}.`) ? v.slice(0, 1) : v);
    const r = W.ensureWorkspaces(kv);
    expect(kv.getItem(W.WS_KEY)).toBe('{X'); expect(r.persisted).toBe(false);
  });
  it('an existing backup is never overwritten by a second corruption', () => {
    const kv = seeded(); kv.m.set(W.WS_KEY, '{first'); W.ensureWorkspaces(kv, new Date(1000));
    kv.m.set(W.WS_KEY, '{second'); W.ensureWorkspaces(kv, new Date(1000));
    expect([...kv.m.entries()].filter(([k]) => k.startsWith(`${W.WS_CORRUPT_KEY}.`)).map(([, v]) => v).sort()).toEqual(['{first', '{second']);
  });
  it('registry READ failure (first getItem throws) → no write at all, existing workspaces kept for the next start', () => {
    const kv = seeded(); const base = W.ensureWorkspaces(kv).reg; const c = W.createWorkspace(base, 'B', new Date(), 'ws-b'); if (!c.ok) throw new Error();
    expect(W.writeRegistry(kv, c.reg, base).ok).toBe(true); const before = all(kv); kv.writes = [];
    let once = true; kv.fault = (op, k) => { if (op === 'get' && k === W.WS_KEY && once) { once = false; return true; } return false; };
    const r = W.ensureWorkspaces(kv);
    expect(r.persisted).toBe(false); expect(r.warnings.join()).toContain('읽지 못했습니다'); expect(kv.writes).toEqual([]); expect(all(kv)).toEqual(before);
    kv.clearFaults(); expect(W.ensureWorkspaces(kv).reg.workspaces.map((w) => w.id)).toEqual([W.DEFAULT_WS_ID, 'ws-b']);
  });
});

describe('M2 — invalid index shape', () => {
  it('index "{}" → no crash, warning, index original never overwritten by save/rename/delete', () => {
    const kv = seeded(); kv.m.set(INDEX_KEY, '{}');
    const r = W.ensureWorkspaces(kv); expect(r.warnings.join()).toContain('손상');
    expect(saveProject(kv, proj('prj-z', 'Z')).ok).toBe(false);
    expect(W.renameSavedProject(kv, 'prj-a', 'Q').ok).toBe(false);
    expect(W.deleteSavedProject(kv, r.reg, 'prj-a').ok).toBe(false);
    expect(kv.getItem(INDEX_KEY)).toBe('{}'); expect(kv.getItem(P('prj-z'))).toBeNull(); expect(kv.getItem(P('prj-a'))).not.toBeNull();
  });
});

describe('H4 — save into workspace (incl. new-ID copy): body + index + membership atomic', () => {
  const setup = () => { const kv = seeded(); const base = W.ensureWorkspaces(kv).reg; const c = W.createWorkspace(base, 'B', new Date(), 'ws-b'); if (!c.ok) throw new Error(); const s = W.setActive(c.reg, 'ws-b'); if (!s.ok) throw new Error(); expect(W.writeRegistry(kv, s.reg, base).ok).toBe(true); return { kv, reg: s.reg }; };
  const copy = { ...proj('prj-a-copy', 'A 사본') };
  it('id owned by another workspace is refused with no write', () => {
    const { kv, reg } = setup(); const before = all(kv);
    expect(W.saveProjectInWorkspace(kv, reg, 'ws-b', proj('prj-a', 'X')).ok).toBe(false); expect(all(kv)).toEqual(before);
  });
  it('journal cannot be written (quota) → nothing changes', () => {
    const { kv, reg } = setup(); const before = all(kv); kv.fault = (o, k) => o === 'set' && k === TXN_KEY;
    expect(W.saveProjectInWorkspace(kv, reg, 'ws-b', copy).ok).toBe(false); kv.clearFaults(); expect(all(kv)).toEqual(before);
  });
  it('journal left behind after a COMPLETED save (journal removal failed) is recognised as committed, not rolled back', () => {
    const { kv, reg } = setup(); kv.fault = (o, k) => o === 'remove' && k === TXN_KEY;
    expect(W.saveProjectInWorkspace(kv, reg, 'ws-b', copy).ok).toBe(true); kv.clearFaults();
    expect(kv.getItem(TXN_KEY)).not.toBeNull();
    const e = W.ensureWorkspaces(kv); expect(e.warnings).toEqual([]); expect(kv.getItem(TXN_KEY)).toBeNull();
    expect(visible(kv)).toEqual([[W.DEFAULT_WS_ID, ['prj-a', 'prj-b']], ['ws-b', ['prj-a-copy']]]);
  });
});
