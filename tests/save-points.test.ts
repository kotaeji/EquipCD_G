import { describe, expect, it } from 'vitest';
import { emptyProject } from '../src/model/factory';
import { buildSampleProject } from '../src/model/sample';
import { FILE_FORMAT_VERSION } from '../src/model/types';
import { serializeProject } from '../src/storage/fileFormat';
import { MemoryKV, PROJECT_KEY } from '../src/storage/localStore';
import {
  SAVE_POINT_LIMIT, SAVEPOINTS_KEY, createSavePoint, deleteSavePoint, loadSavePoint, packSavePoints,
  readSavePointRecords, renameSavePoint, restoredProject, savePointCount, writeSavePointRecords,
} from '../src/storage/savePoints';
import { isDataKey } from '../src/storage/txn';
import {
  BUNDLE_VERSION, applyWorkspaceBundle, exportWorkspaceBundle, parseWorkspaceBundle,
} from '../src/storage/workspaceBundle';
import { deleteSavedProject, ensureWorkspaces, saveProjectInWorkspace } from '../src/storage/workspaces';

const T0 = new Date('2026-11-27T01:00:00.000Z');
const T1 = new Date('2026-11-27T02:00:00.000Z');
const MARK = 'SP-MARKER-094';

function mini(id = 'prj-a', name = '알파', revision = 3) {
  return { ...emptyProject(name), id, name, revision };
}

function must<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error('reason' in r ? String((r as { reason?: string }).reason) : 'failed');
  return r as Extract<T, { ok: true }>;
}

describe('TURN-094 save points', () => {
  it('keeps the model, the project key, and a newest-first list', () => {
    const kv = new MemoryKV();
    const project = mini();
    const before = serializeProject(project);
    const first = must(createSavePoint(kv, project, '  첫째  ', '  메모 하나 ', T0, { id: 'sp1' }));
    const second = must(createSavePoint(kv, project, MARK, '', T1, { id: 'sp2' }));
    expect(serializeProject(project)).toBe(before);
    expect(project.revision).toBe(3);
    expect(kv.getItem(PROJECT_KEY(project.id))).toBeNull();
    expect(first.revision).toBe(3);
    expect(first.savedAt).toBe(T0.toISOString());
    expect(second.droppedId).toBeNull();
    const list = must(readSavePointRecords(kv, project.id));
    expect(list.points.map((p) => p.name)).toEqual([MARK, '첫째']);
    expect(list.points[1].note).toBe('메모 하나');
    expect(list.points[0].savedAt).toBe(T1.toISOString());
    expect(savePointCount(kv, project.id)).toEqual({ ok: true, count: 2 });
    expect(serializeProject(project)).not.toContain(MARK);
    const loaded = must(loadSavePoint(kv, project.id, 'sp1'));
    expect(loaded.project.name).toBe('알파');
    expect(loaded.project.revision).toBe(3);
  });

  it('asks before the 21st and drops only the oldest when told', () => {
    const kv = new MemoryKV();
    const project = mini();
    for (let i = 0; i < SAVE_POINT_LIMIT; i++) {
      must(createSavePoint(kv, project, `점 ${i}`, '', new Date(Date.UTC(2026, 0, i + 1)), { id: `sp${i}` }));
    }
    const raw = kv.getItem(SAVEPOINTS_KEY(project.id));
    const refused = createSavePoint(kv, project, '스물하나', '', T1, { id: 'sp21' });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toContain(String(SAVE_POINT_LIMIT));
    expect(kv.getItem(SAVEPOINTS_KEY(project.id))).toBe(raw);
    expect(must(readSavePointRecords(kv, project.id)).points).toHaveLength(20);
    const dropped = must(createSavePoint(kv, project, '스물하나', '', T1, { id: 'sp21', dropOldest: true }));
    expect(dropped.droppedId).toBe('sp0');
    const names = must(readSavePointRecords(kv, project.id)).points.map((p) => [p.id, p.name]);
    expect(names[0]).toEqual(['sp21', '스물하나']);
    expect(names.some((row) => row[0] === 'sp0')).toBe(false);
    expect(names).toHaveLength(20);
    expect(project.revision).toBe(3);
  });

  it('refuses a quota failure and leaves the model and the list', () => {
    const kv = new MemoryKV();
    const project = mini();
    const before = serializeProject(project);
    must(createSavePoint(kv, project, '있는 것', '', T0, { id: 'sp1' }));
    const raw = kv.getItem(SAVEPOINTS_KEY(project.id));
    kv.failWrites = true;
    const failed = createSavePoint(kv, project, '못 씀', '', T1, { id: 'sp2' });
    expect(failed.ok).toBe(false);
    kv.failWrites = false;
    expect(kv.getItem(SAVEPOINTS_KEY(project.id))).toBe(raw);
    expect(must(readSavePointRecords(kv, project.id)).points.map((p) => p.name)).toEqual(['있는 것']);
    expect(serializeProject(project)).toBe(before);
  });

  it('renames without touching the snapshot, and delete removes the key when it is the last one', () => {
    const kv = new MemoryKV();
    const project = mini();
    must(createSavePoint(kv, project, '처음', '메모', T0, { id: 'sp1' }));
    const body = must(readSavePointRecords(kv, project.id)).points[0].body;
    expect(renameSavePoint(kv, project.id, 'sp1', '나중', '다른 메모', T1).ok).toBe(true);
    const renamed = must(readSavePointRecords(kv, project.id)).points[0];
    expect(renamed.name).toBe('나중');
    expect(renamed.note).toBe('다른 메모');
    expect(renamed.savedAt).toBe(T0.toISOString());
    expect(renamed.revision).toBe(3);
    expect(renamed.body).toBe(body);
    expect(deleteSavePoint(kv, project.id, 'sp1', T1).ok).toBe(true);
    expect(kv.getItem(SAVEPOINTS_KEY(project.id))).toBeNull();
    expect(savePointCount(kv, project.id)).toEqual({ ok: true, count: 0 });
  });

  it('does not overwrite a damaged list', () => {
    const kv = new MemoryKV();
    const project = mini();
    kv.setItem(SAVEPOINTS_KEY(project.id), '{');
    const failed = createSavePoint(kv, project, '새로', '', T0, { id: 'sp1' });
    expect(failed.ok).toBe(false);
    expect(kv.getItem(SAVEPOINTS_KEY(project.id))).toBe('{');
  });

  it('restore prepares one undo step: same id, revision + 1', () => {
    const current = mini('prj-a', '지금', 8);
    const snapshot = mini('prj-a', '예전', 4);
    const next = restoredProject(current, snapshot);
    expect(next.id).toBe('prj-a');
    expect(next.name).toBe('예전');
    expect(next.revision).toBe(9);
    expect(current.revision).toBe(8);
    expect(current.name).toBe('지금');
  });

  it('project JSON omits save points; a bundle keeps them only when asked, and import restores the list', () => {
    const kv = new MemoryKV();
    const reg0 = ensureWorkspaces(kv, T0).reg;
    const project = { ...buildSampleProject(), id: 'prj-a', name: '알파' };
    const saved = must(saveProjectInWorkspace(kv, reg0, reg0.activeId, project, T0));
    must(createSavePoint(kv, project, MARK, '포장 전', T0, { id: 'sp1' }));
    must(createSavePoint(kv, project, '둘째 지점', '', T1, { id: 'sp2' }));
    expect(serializeProject(project)).not.toContain(MARK);
    expect(FILE_FORMAT_VERSION.startsWith('0.3')).toBe(true);

    const plain = exportWorkspaceBundle(kv, saved.reg, saved.reg.activeId, T1);
    if ('ok' in plain) throw new Error(plain.reason);
    expect(plain.text).not.toContain(MARK);
    expect(parseWorkspaceBundle(plain.text).ok).toBe(true);

    const withPoints = exportWorkspaceBundle(kv, saved.reg, saved.reg.activeId, T1, { includeSavePoints: true });
    if ('ok' in withPoints) throw new Error(withPoints.reason);
    expect(withPoints.text).toContain(MARK);
    const parsed = parseWorkspaceBundle(withPoints.text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.bundle.formatVersion).toBe(BUNDLE_VERSION);
    expect(parsed.bundle.savePoints?.[0].points.map((p) => p.name)).toEqual(['둘째 지점', MARK]);

    const dest = new MemoryKV();
    const destReg = ensureWorkspaces(dest, T0).reg;
    const applied = must(applyWorkspaceBundle(dest, destReg, parsed.bundle, 'new', {}, T1, 'ws-in'));
    expect(applied.summary.imported).toBe(1);
    const restored = must(readSavePointRecords(dest, 'prj-a'));
    expect(restored.points.map((p) => p.name)).toEqual(['둘째 지점', MARK]);
    expect(restored.points[1].note).toBe('포장 전');
    expect(must(loadSavePoint(dest, 'prj-a', 'sp1')).project.name).toBe('알파');

    const again = new MemoryKV();
    const againReg = ensureWorkspaces(again, T0).reg;
    const kept = must(saveProjectInWorkspace(again, againReg, againReg.activeId, mini('prj-a', '있던 것', 1), T0));
    const copied = must(applyWorkspaceBundle(again, kept.reg, parsed.bundle, 'add', { 0: 'copy' }, T1, 'ws-x'));
    expect(copied.summary.copied).toBe(1);
    expect(savePointCount(again, 'prj-a')).toEqual({ ok: true, count: 0 });
    const copyId = copied.reg.workspaces.flatMap((w) => w.projectIds).find((id) => id !== 'prj-a');
    expect(copyId).toBeTruthy();
    const copyPoints = must(readSavePointRecords(again, copyId!));
    expect(copyPoints.points.map((p) => p.name)).toEqual(['둘째 지점', MARK]);
    expect(must(loadSavePoint(again, copyId!, 'sp2')).project.id).toBe(copyId);
  });

  it('deletes save points with the project, and a failed delete leaves them', () => {
    const kv = new MemoryKV();
    const reg0 = ensureWorkspaces(kv, T0).reg;
    const project = mini();
    const saved = must(saveProjectInWorkspace(kv, reg0, reg0.activeId, project, T0));
    must(createSavePoint(kv, project, MARK, '', T0, { id: 'sp1' }));
    kv.failWrites = true;
    expect(deleteSavedProject(kv, saved.reg, project.id).ok).toBe(false);
    kv.failWrites = false;
    expect(kv.getItem(PROJECT_KEY(project.id))).toBeTruthy();
    expect(must(readSavePointRecords(kv, project.id)).points).toHaveLength(1);
    const removed = must(deleteSavedProject(kv, saved.reg, project.id));
    expect(kv.getItem(PROJECT_KEY(project.id))).toBeNull();
    expect(kv.getItem(SAVEPOINTS_KEY(project.id))).toBeNull();
    expect(removed.reg.workspaces.every((w) => !w.projectIds.includes(project.id))).toBe(true);
  });

  it('accepts the save-point key and rejects a bare prefix', () => {
    expect(isDataKey(SAVEPOINTS_KEY('prj-a'))).toBe(true);
    expect(isDataKey('ecd.v1.savepoints.')).toBe(false);
    expect(isDataKey('ecd.v1.savepoints')).toBe(false);
    expect(packSavePoints([]).ok).toBe(true);
    const kv = new MemoryKV();
    expect(writeSavePointRecords(kv, 'prj-a', [], T0).ok).toBe(true);
    expect(kv.getItem(SAVEPOINTS_KEY('prj-a'))).toBeNull();
  });
});
