import { describe, expect, it } from 'vitest';
import { emptyProject } from '../src/model/factory';
import { buildSampleProject } from '../src/model/sample';
import { APP_VERSION } from '../src/model/types';
import { saveDraft } from '../src/storage/drafts';
import { parseProjectFile, serializeProject, stableStringify } from '../src/storage/fileFormat';
import { INDEX_KEY, MemoryKV, PROJECT_KEY, readIndex, type KV } from '../src/storage/localStore';
import { TXN_KEY } from '../src/storage/txn';
import {
  BUNDLE_FORMAT, BUNDLE_VERSION, applyWorkspaceBundle, exportWorkspaceBundle, knownProjectIds, parseWorkspaceBundle,
  previewWorkspaceBundle, summaryLine, type ConflictChoice, type WorkspaceBundle,
} from '../src/storage/workspaceBundle';
import { WS_KEY, createWorkspace, ensureWorkspaces, ownerOf, saveProjectInWorkspace, writeRegistry, type WorkspaceRegistry } from '../src/storage/workspaces';

const T0 = new Date('2026-11-23T00:00:00.000Z');
const T1 = new Date('2026-11-23T01:00:00.000Z');

function mini(id: string, name: string, revision = 2) {
  return { ...emptyProject(name), id, name, revision };
}

function dump(kv: KV) {
  const out: Record<string, string> = {};
  for (let i = 0; i < kv.length; i++) {
    const k = kv.key(i);
    if (k) out[k] = kv.getItem(k) ?? '';
  }
  return out;
}

function withoutCreated(text: string) {
  const o = JSON.parse(text) as { createdAt?: string };
  o.createdAt = '';
  return stableStringify(o);
}

function seeded() {
  const kv = new MemoryKV();
  const alpha = mini('prj-a', '알파', 4);
  const beta = { ...buildSampleProject(), id: 'prj-b', name: '베타' };
  expect(saveProjectInWorkspace(kv, ensureWorkspaces(kv, T0).reg, 'ws-default', alpha, T0).ok).toBe(true);
  const reg0 = ensureWorkspaces(kv, T0).reg;
  const saved = saveProjectInWorkspace(kv, reg0, reg0.activeId, beta, T0);
  expect(saved.ok).toBe(true);
  if (!saved.ok) throw new Error('save');
  const draft = saveDraft(kv, { ...alpha, name: '알파 임시', revision: 9 }, T0);
  expect(draft.ok).toBe(true);
  kv.setItem('ecd.v1.userView', '{"marker":"VIEW-MARKER-055"}');
  kv.setItem('ecd.v1.quarantine', '[{"raw":"QUARANTINE-MARKER-055"}]');
  return { kv, reg: saved.reg, alpha, beta };
}

function fresh() {
  const kv = new MemoryKV();
  const ensured = ensureWorkspaces(kv, T0);
  return { kv, reg: ensured.reg };
}

function mustExport(kv: KV, reg: WorkspaceRegistry, wsId = reg.activeId, now = T1) {
  const out = exportWorkspaceBundle(kv, reg, wsId, now);
  if ('ok' in out) throw new Error(out.reason);
  return out;
}

function mustParse(text: string): WorkspaceBundle {
  const parsed = parseWorkspaceBundle(text);
  if (!parsed.ok) throw new Error(parsed.why);
  return parsed.bundle;
}

class BoomKV extends MemoryKV {
  boom: string | null = null;
  override setItem(k: string, v: string) {
    if (this.boom && k === this.boom) throw new Error('QuotaExceededError');
    super.setItem(k, v);
  }
}

describe('TURN-055 workspace bundle', () => {
  it('AC1 export carries the format, the workspace name, and only saved projects', () => {
    const { kv, reg } = seeded();
    const out = mustExport(kv, reg);
    const file = JSON.parse(out.text) as WorkspaceBundle;
    expect(file.format).toBe(BUNDLE_FORMAT);
    expect(file.formatVersion).toBe(BUNDLE_VERSION);
    expect(file.appVersion).toBe(APP_VERSION);
    expect(file.workspaceName).toBe('기본 Workspace');
    expect(file.createdAt).toBe(T1.toISOString());
    expect(file.projects).toHaveLength(2);
    const names = file.projects.map((entry) => {
      const parsed = parseProjectFile(stableStringify(entry));
      if (!parsed.ok) throw new Error('project');
      return parsed.project.name;
    });
    expect(names.sort()).toEqual(['베타', '알파']);
    expect(out.text).not.toContain('알파 임시');
    expect(out.text).not.toContain('VIEW-MARKER-055');
    expect(out.text).not.toContain('QUARANTINE-MARKER-055');
    expect(out.text).not.toContain('ecd.v1.draft');
    expect(out.text).not.toContain('ecd.v1.userView');
    expect(out.bytes).toBe(new TextEncoder().encode(out.text).length);
    expect(out.projects.map((p) => p.name).sort()).toEqual(['베타', '알파']);
  });

  it('AC2 two exports of the same workspace differ only by createdAt', () => {
    const { kv, reg } = seeded();
    const a = mustExport(kv, reg, reg.activeId, T0);
    const b = mustExport(kv, reg, reg.activeId, T1);
    expect(a.text).not.toBe(b.text);
    expect(withoutCreated(a.text)).toBe(withoutCreated(b.text));
  });

  it('AC3 import into an empty store restores each saved project byte for byte', () => {
    const { kv, reg } = seeded();
    const out = mustExport(kv, reg);
    const { kv: dest, reg: dreg } = fresh();
    const applied = applyWorkspaceBundle(dest, dreg, mustParse(out.text), 'new', {}, T1, 'ws-in');
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.summary.imported).toBe(2);
    expect(summaryLine(applied.summary)).toBe('들어옴 2 · 사본 0 · 건너뜀 0 · 덮어씀 0 · 격리 0');
    for (const id of ['prj-a', 'prj-b']) {
      expect(dest.getItem(PROJECT_KEY(id))).toBe(kv.getItem(PROJECT_KEY(id)));
      const loaded = parseProjectFile(dest.getItem(PROJECT_KEY(id))!);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      expect(serializeProject(loaded.project)).toBe(kv.getItem(PROJECT_KEY(id)));
    }
    expect(applied.newWorkspace?.name).toBe('기본 Workspace 2');
    expect(applied.reg.activeId).toBe(dreg.activeId);
    expect(ownerOf(applied.reg, 'prj-a')?.id).toBe('ws-in');
  });

  it('AC4 preview names each verdict and does not write', () => {
    const { kv, reg } = seeded();
    const bundle = mustParse(mustExport(kv, reg).text);
    const before = dump(kv);
    const known = previewWorkspaceBundle(kv, reg, bundle);
    expect(dump(kv)).toEqual(before);
    expect(known.rows.map((r) => r.verdict).sort()).toEqual(['conflict', 'conflict']);
    bundle.projects[1] = { format: 'nope', project: { id: 'prj-x', name: '깨짐', revision: 1 } };
    const mixed = previewWorkspaceBundle(kv, reg, bundle);
    expect(dump(kv)).toEqual(before);
    expect(mixed.rows.filter((r) => r.verdict === 'conflict')).toHaveLength(1);
    expect(mixed.rows.some((r) => r.verdict === 'unreadable' && r.name === '깨짐')).toBe(true);
    const { kv: empty, reg: ereg } = fresh();
    const emptyBefore = dump(empty);
    const clean = mustParse(mustExport(kv, reg).text);
    const seen = previewWorkspaceBundle(empty, ereg, clean);
    expect(seen.rows.every((r) => r.verdict === 'new')).toBe(true);
    expect(dump(empty)).toEqual(emptyBefore);
  });

  it('AC5 copy, skip, and overwrite follow the choice', () => {
    const { kv, reg } = seeded();
    const bundle = mustParse(mustExport(kv, reg).text);
    const cases: [ConflictChoice, (kv: MemoryKV, reg: WorkspaceRegistry, original: string | null) => void][] = [
      ['copy', (dest, applied, original) => {
        expect(dest.getItem(PROJECT_KEY('prj-a'))).toBe(original);
        const copies = readIndex(dest).filter((e) => e.name.endsWith('사본'));
        expect(copies).toHaveLength(1);
        expect(copies.every((e) => e.id !== 'prj-a' && e.id !== 'prj-b')).toBe(true);
        expect(ownerOf(applied, copies[0].id)?.id).toBe(applied.activeId);
      }],
      ['skip', (dest, _applied, original) => {
        expect(dest.getItem(PROJECT_KEY('prj-a'))).toBe(original);
        expect(readIndex(dest).map((e) => e.id).sort()).toEqual(['prj-a', 'prj-b']);
      }],
      ['overwrite', (dest) => {
        const loaded = parseProjectFile(dest.getItem(PROJECT_KEY('prj-a'))!);
        expect(loaded.ok).toBe(true);
        if (!loaded.ok) return;
        expect(loaded.project.name).toBe('알파-바뀜');
        expect(loaded.project.id).toBe('prj-a');
      }],
    ];
    for (const [choice, check] of cases) {
      const { kv: dest, reg: dreg } = fresh();
      const kept = saveProjectInWorkspace(dest, dreg, dreg.activeId, mini('prj-a', '알파', 1), T0);
      expect(kept.ok).toBe(true);
      if (!kept.ok) return;
      const file = structuredClone(bundle);
      if (choice === 'overwrite') {
        const parsed = parseProjectFile(stableStringify(file.projects[0]));
        if (!parsed.ok) throw new Error('peek');
        const target = file.projects.find((entry) => {
          const p = parseProjectFile(stableStringify(entry));
          return p.ok && p.project.id === 'prj-a';
        });
        if (!target || typeof target !== 'object') throw new Error('row');
        (target as { project: { name: string } }).project.name = '알파-바뀜';
      }
      const choices: Record<number, ConflictChoice> = {};
      previewWorkspaceBundle(dest, kept.reg, file).rows.forEach((r) => { if (r.verdict === 'conflict') choices[r.index] = choice; });
      const original = dest.getItem(PROJECT_KEY('prj-a'));
      const applied = applyWorkspaceBundle(dest, kept.reg, file, 'add', choices, T1, 'ws-x');
      expect(applied.ok, choice).toBe(true);
      if (!applied.ok) return;
      if (choice === 'copy') expect(applied.summary.copied).toBe(1);
      if (choice === 'skip') expect(applied.summary.skipped).toBe(1);
      if (choice === 'overwrite') expect(applied.summary.overwritten).toBe(1);
      check(dest, applied.reg, original);
    }
  });

  it('AC6 an unreadable project is quarantined and the others still come in', () => {
    const { kv, reg } = seeded();
    const bundle = mustParse(mustExport(kv, reg).text);
    bundle.projects[0] = { format: 'equipment-concept-designer/project', formatVersion: '9.9.9', project: { id: 'prj-z', name: '깨짐', revision: 1 } };
    const { kv: dest, reg: dreg } = fresh();
    const before = dump(dest);
    const applied = applyWorkspaceBundle(dest, dreg, bundle, 'new', {}, T1, 'ws-in');
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.summary.imported).toBe(1);
    expect(applied.summary.quarantined).toBe(1);
    expect(applied.quarantine).toHaveLength(1);
    expect(applied.quarantine[0].errors[0]).toContain('VERSION_UNSUPPORTED');
    expect(applied.quarantine[0].label).toContain('깨짐');
    expect(readIndex(dest)).toHaveLength(1);
    expect(dest.getItem(PROJECT_KEY('prj-z'))).toBeNull();
    expect(applied.newWorkspace?.id).toBe('ws-in');
    expect(dest.getItem(WS_KEY)).not.toBe(before[WS_KEY]);
    const keptId = readIndex(dest)[0].id;
    expect(ownerOf(applied.reg, keptId)?.id).toBe('ws-in');
  });

  it('AC7 a broken file or a different format is refused and the store stays', () => {
    const { kv, reg } = fresh();
    const before = dump(kv);
    for (const raw of ['{', '{"format":"other"}', serializeProject(mini('prj-a', '알파'))]) {
      const parsed = parseWorkspaceBundle(raw);
      expect(parsed.ok, raw.slice(0, 24)).toBe(false);
      if (parsed.ok) return;
      expect(parsed.why.length).toBeGreaterThan(0);
    }
    expect(dump(kv)).toEqual(before);
    expect(reg.workspaces).toHaveLength(1);
  });

  it('AC8 a failed write restores the store', () => {
    const { kv, reg } = seeded();
    const bundle = mustParse(mustExport(kv, reg).text);
    const dest = new BoomKV();
    const ensured = ensureWorkspaces(dest, T0);
    const before = dump(dest);
    const ids = bundle.projects.map((entry) => {
      const parsed = parseProjectFile(stableStringify(entry));
      if (!parsed.ok) throw new Error('id');
      return parsed.project.id;
    });
    dest.boom = PROJECT_KEY(ids[1]);
    const applied = applyWorkspaceBundle(dest, ensured.reg, bundle, 'new', {}, T1, 'ws-in');
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.reason).toContain('되돌렸습니다');
    expect(dump(dest)).toEqual(before);
    expect(dest.getItem(TXN_KEY)).toBeNull();
    expect(dest.getItem(INDEX_KEY)).toBe(before[INDEX_KEY] ?? null);
    expect(knownProjectIds(dest, ensured.reg).size).toBe(0);
  });

  it('AC9 add and new workspace put projects in the right place, and a duplicate name gets a number', () => {
    const { kv, reg } = seeded();
    const bundle = mustParse(mustExport(kv, reg).text);
    const { kv: dest, reg: dreg } = fresh();
    const made = createWorkspace(dreg, '옆', T0, 'ws-side');
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(writeRegistry(dest, made.reg, dreg).ok).toBe(true);
    const side = { ...made.reg, activeId: 'ws-side' };
    expect(writeRegistry(dest, side, made.reg).ok).toBe(true);
    const added = applyWorkspaceBundle(dest, side, bundle, 'add', {}, T1, 'ws-unused');
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.newWorkspace).toBeNull();
    expect(ownerOf(added.reg, 'prj-a')?.id).toBe('ws-side');
    expect(ownerOf(added.reg, 'prj-a')?.name).toBe('옆');
    const again = fresh();
    const named = mustParse(mustExport(kv, reg).text);
    named.workspaceName = '기본 Workspace';
    const created = applyWorkspaceBundle(again.kv, again.reg, named, 'new', {}, T1, 'ws-2');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.newWorkspace?.name).toBe('기본 Workspace 2');
    expect(created.reg.workspaces.map((w) => w.name)).toEqual(['기본 Workspace', '기본 Workspace 2']);
  });

  it('imports twenty projects in one transaction', () => {
    const kv = new MemoryKV();
    let reg = ensureWorkspaces(kv, T0).reg;
    for (let i = 0; i < 20; i++) {
      const saved = saveProjectInWorkspace(kv, reg, reg.activeId, mini(`p-${i}`, `P${i}`, 1), T0);
      expect(saved.ok).toBe(true);
      if (!saved.ok) return;
      reg = saved.reg;
    }
    const out = mustExport(kv, reg);
    const { kv: dest, reg: dreg } = fresh();
    const applied = applyWorkspaceBundle(dest, dreg, mustParse(out.text), 'new', {}, T1, 'ws-many');
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.summary.imported).toBe(20);
    expect(readIndex(dest)).toHaveLength(20);
    expect(dest.getItem(TXN_KEY)).toBeNull();
  });

  it('preview of a second copy of the same id inside one file is a conflict', () => {
    const source = seeded();
    const bundle = mustParse(mustExport(source.kv, source.reg).text);
    const { kv: empty, reg: ereg } = fresh();
    const first = structuredClone(bundle.projects[0]);
    bundle.projects = [first, structuredClone(first)];
    const rows = previewWorkspaceBundle(empty, ereg, bundle).rows;
    expect(rows.map((r) => r.verdict)).toEqual(['new', 'conflict']);
  });
});
