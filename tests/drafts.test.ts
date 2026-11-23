// TURN-047 — draft store. Saved bodies and the saved index stay untouched.
import { describe, expect, it } from 'vitest';
import { buildSampleProject } from '../src/model/sample';
import { DRAFTS_KEY, DRAFT_KEY, discardDraft, draftOffersRecovery, loadDraft, readDraftList, saveDraft, sweepDrafts, workTimesLabel } from '../src/storage/drafts';
import { INDEX_KEY, MemoryKV, PROJECT_KEY, readIndex, saveProject } from '../src/storage/localStore';
import { TXN_KEY, isDataKey } from '../src/storage/txn';

const T = (iso: string) => new Date(iso);
const proj = (rev: number, name = '라인') => ({ ...buildSampleProject(), id: 'prj-a', name, revision: rev });

describe('TURN-047 draft store', () => {
  it('AC1 AC12 a draft write leaves the saved index, saved body, and model revision alone', () => {
    const kv = new MemoryKV();
    const saved = proj(3, '저장본');
    const savedAt = saveProject(kv, saved, T('2026-11-23T05:02:00.000Z'));
    expect(savedAt.ok).toBe(true);
    const index = kv.getItem(INDEX_KEY);
    const body = kv.getItem(PROJECT_KEY('prj-a'));
    const edited = proj(4, '편집');
    const before = edited.revision;
    const d = saveDraft(kv, edited, T('2026-11-23T05:05:00.000Z'));
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.savedAt).toBe('2026-11-23T05:05:00.000Z');
    expect(edited.revision).toBe(before);
    expect(kv.getItem(INDEX_KEY)).toBe(index);
    expect(kv.getItem(PROJECT_KEY('prj-a'))).toBe(body);
    expect(readIndex(kv)).toEqual([{ id: 'prj-a', name: '저장본', savedAt: '2026-11-23T05:02:00.000Z', revision: 3 }]);
    expect(kv.getItem(TXN_KEY)).toBeNull();
    const loaded = loadDraft(kv, 'prj-a');
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.project.name).toBe('편집');
      expect(loaded.project.revision).toBe(4);
    }
    expect(readDraftList(kv).map((e) => e.revision)).toEqual([4]);
  });

  it('AC6 same revision or an older timestamp does not offer recovery; a newer revision does', () => {
    const saved = { revision: 5, savedAt: '2026-11-23T05:00:00.000Z' };
    expect(draftOffersRecovery({ revision: 5, savedAt: '2026-11-23T06:00:00.000Z' }, saved)).toBe(false);
    expect(draftOffersRecovery({ revision: 4, savedAt: '2026-11-23T04:00:00.000Z' }, saved)).toBe(false);
    expect(draftOffersRecovery({ revision: 6, savedAt: '2026-11-23T04:00:00.000Z' }, saved)).toBe(false);
    expect(draftOffersRecovery({ revision: 6, savedAt: '2026-11-23T05:00:00.000Z' }, saved)).toBe(true);
    expect(draftOffersRecovery({ revision: 6, savedAt: '2026-11-23T05:05:00.000Z' }, saved)).toBe(true);
    expect(draftOffersRecovery({ revision: 6, savedAt: '2026-11-23T05:05:00.000Z' }, null)).toBe(false);
  });

  it('AC5 AC9 discard removes one draft and leaves the other, and does not create keys when nothing is stored', () => {
    const kv = new MemoryKV();
    saveDraft(kv, proj(2, 'A'), T('2026-11-23T05:05:00.000Z'));
    saveDraft(kv, { ...proj(3, 'B'), id: 'prj-b' }, T('2026-11-23T05:06:00.000Z'));
    expect(discardDraft(kv, 'prj-a').ok).toBe(true);
    expect(kv.getItem(DRAFT_KEY('prj-a'))).toBeNull();
    expect(readDraftList(kv).map((e) => e.id)).toEqual(['prj-b']);
    expect(kv.getItem(PROJECT_KEY('prj-a'))).toBeNull();
    const empty = new MemoryKV();
    const before = empty.length;
    expect(discardDraft(empty, 'missing').ok).toBe(true);
    expect(empty.length).toBe(before);
    expect(empty.getItem(DRAFTS_KEY)).toBeNull();
  });

  it('AC7 a broken draft is quarantined and the saved project is left as it was', () => {
    const kv = new MemoryKV();
    saveProject(kv, proj(2, '저장본'), T('2026-11-23T05:02:00.000Z'));
    const body = kv.getItem(PROJECT_KEY('prj-a'));
    const index = kv.getItem(INDEX_KEY);
    kv.setItem(DRAFTS_KEY, JSON.stringify([{ id: 'prj-a', name: '깨짐', savedAt: '2026-11-23T05:09:00.000Z', revision: 9 }]));
    kv.setItem(DRAFT_KEY('prj-a'), '{not-json');
    const swept = sweepDrafts(kv, T('2026-11-23T05:10:00.000Z'));
    expect(swept.entries).toEqual([]);
    expect(swept.quarantine).toHaveLength(1);
    expect(swept.quarantine[0].raw).toBe('{not-json');
    expect(swept.quarantine[0].label).toBe('draft:prj-a');
    expect(kv.getItem(DRAFT_KEY('prj-a'))).toBeNull();
    expect(kv.getItem(PROJECT_KEY('prj-a'))).toBe(body);
    expect(kv.getItem(INDEX_KEY)).toBe(index);
    expect(readDraftList(kv)).toEqual([]);
  });

  it('AC8 a failed write changes nothing and reports the failure', () => {
    const kv = new MemoryKV();
    saveProject(kv, proj(1), T('2026-11-23T05:02:00.000Z'));
    const before = [...Array(kv.length)].map((_, i) => [kv.key(i), kv.getItem(kv.key(i)!)].join('='));
    kv.failWrites = true;
    const edited = proj(2, '편집');
    const d = saveDraft(kv, edited, T('2026-11-23T05:05:00.000Z'));
    expect(d.ok).toBe(false);
    expect(edited.revision).toBe(2);
    kv.failWrites = false;
    const after = [...Array(kv.length)].map((_, i) => [kv.key(i), kv.getItem(kv.key(i)!)].join('='));
    expect(after).toEqual(before);
    expect(kv.getItem(TXN_KEY)).toBeNull();
  });

  it('draft keys are journal data keys, and the work line stays one string', () => {
    expect(isDataKey(DRAFTS_KEY)).toBe(true);
    expect(isDataKey(DRAFT_KEY('prj-a'))).toBe(true);
    expect(isDataKey('ecd.v1.draft.')).toBe(false);
    const line = workTimesLabel('2026-11-23T05:02:00.000Z', '2026-11-23T05:05:00.000Z', false);
    expect(line).not.toMatch(/\n/);
    expect(line.startsWith('저장 ')).toBe(true);
    expect(line).toContain(' · 임시 저장 ');
    expect(workTimesLabel('2026-11-23T05:02:00.000Z', null, true)).toContain('임시 저장 실패');
  });
});
