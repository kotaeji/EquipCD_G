import { describe, expect, it } from 'vitest';
import { newCandidate } from '../src/model/candidates';
import {
  addressWord, assumptionWord, confirmationWord, confirmedCaption, gapStatusWord, normalizeConfirmerName,
  sortedConfirmationLog, targetLive, type ConfirmStamp,
} from '../src/model/confirmationLog';
import { formatLocalClock } from '../src/ui/localClock';
import * as C from '../src/model/commands';
import { buildAuroraExport, compareAuroraExport, parseAuroraExport, serializeAuroraExport } from '../src/model/auroraExport';
import { analyzeGaps, reconcileGapReview } from '../src/model/gaps';
import { applyEdit, initHistory, redo, undo } from '../src/model/history';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { parseProjectFile, serializeProject } from '../src/storage/fileFormat';
import { confirmationJump } from '../src/ui/confirmationJump';
import { VIEW_KEY } from '../src/storage/localStore';
import { DEFAULT_VIEW, loadView } from '../src/ui/viewSettings';
import type { Project } from '../src/model/types';

const stamp = (at: string, by = '김검토'): ConfirmStamp => ({ by, at });

function okp(r: C.CmdResult): Project {
  if (!r.ok) throw new Error(r.reason);
  return r.project;
}

function withGap(p0: Project) {
  const gaps = analyzeGaps(p0);
  const gap = gaps.find((g) => g.safety);
  if (!gap) throw new Error('safety gap missing');
  const gapReview = reconcileGapReview(p0.gapReview, gaps, p0.revision, new Set(gaps.filter((g) => g.safety).map((g) => g.id)));
  return { project: { ...p0, gapReview }, gap };
}

describe('TURN-070 confirmation log', () => {
  it('AC2 records name, time, target, and the previous and next state for each confirmation', () => {
    let p = buildSampleProject();
    const prop = Object.keys(p.devices[0].properties)[0];
    const deviceId = p.devices[0].id;
    p = okp(C.setDeviceProperty(p, deviceId, prop, p.devices[0].properties[prop].value, false, stamp('2026-11-24T01:00:00.000Z')));
    p = okp(C.setQuantity(p, { kind: 'action', id: p.actions[0].id, field: 'duration' }, p.actions[0].duration.value, false, stamp('2026-11-24T01:01:00.000Z')));
    p = okp(C.setConstraintConfirmation(p, 'IL-01', 'confirmed', stamp('2026-11-24T01:02:00.000Z')));
    const cand = newCandidate('device', 'SEN-X', 'sensor', p.units[0].id, 'direct', () => 'CAND-X');
    p = { ...p, candidates: [...p.candidates, cand] };
    p = okp(C.updateCandidate(p, cand.id, { confirmation: 'confirmed' }, stamp('2026-11-24T01:03:00.000Z')));
    p = okp(C.updateCandidate(p, cand.id, { confirmation: 'rejected' }, stamp('2026-11-24T01:04:00.000Z', '이검토')));
    const g = withGap(p);
    p = okp(C.setGapReviewStatus(g.project, g.gap.id, 'humanConfirmed', stamp('2026-11-24T01:05:00.000Z'), g.gap.title));
    const sig = p.signals[0];
    p = okp(C.updateSignal(p, sig.id, { address: 'X0.1' }));
    expect(p.confirmationLog).toHaveLength(6);
    p = okp(C.updateSignal(p, sig.id, { addressStatus: 'confirmed' }, stamp('2026-11-24T01:06:00.000Z')));

    const rows = p.confirmationLog ?? [];
    expect(rows).toHaveLength(7);
    expect(rows.map((e) => e.at)).toEqual([
      '2026-11-24T01:00:00.000Z', '2026-11-24T01:01:00.000Z', '2026-11-24T01:02:00.000Z',
      '2026-11-24T01:03:00.000Z', '2026-11-24T01:04:00.000Z', '2026-11-24T01:05:00.000Z', '2026-11-24T01:06:00.000Z',
    ]);
    expect(rows[0]).toMatchObject({ by: '김검토', from: assumptionWord(true), to: assumptionWord(false), target: { kind: 'quantity', ref: { kind: 'device', id: deviceId, key: prop } } });
    expect(rows[1].target).toMatchObject({ kind: 'quantity', ref: { kind: 'action', field: 'duration' } });
    expect(rows[2]).toMatchObject({ from: confirmationWord('unconfirmed'), to: confirmationWord('confirmed'), target: { kind: 'interlock', id: 'IL-01' } });
    expect(rows[3]).toMatchObject({ name: 'SEN-X', to: confirmationWord('confirmed'), target: { kind: 'candidate', id: 'CAND-X' } });
    expect(rows[4]).toMatchObject({ by: '이검토', from: confirmationWord('confirmed'), to: confirmationWord('rejected') });
    expect(rows[5]).toMatchObject({ name: g.gap.title, from: gapStatusWord('needsHuman'), to: gapStatusWord('humanConfirmed'), target: { kind: 'gap', id: g.gap.id } });
    expect(rows[6]).toMatchObject({ name: `${sig.name} 주소`, from: addressWord('assumed'), to: addressWord('confirmed'), target: { kind: 'signalAddress', id: sig.id } });
    expect(p.revision).toBe(buildSampleProject().revision + 8);
  });

  it('AC2 a value edit that keeps the assumption flag does not add a row', () => {
    const p = buildSampleProject();
    const prop = Object.keys(p.devices[0].properties)[0];
    const next = okp(C.setDeviceProperty(p, p.devices[0].id, prop, 3, true, stamp('2026-11-24T01:00:00.000Z')));
    expect(next.confirmationLog).toBeUndefined();
    expect(next.devices[0].properties[prop].value).toBe(3);
  });

  it('AC2 reversing a confirmation appends another row, and an empty name is refused', () => {
    let p = buildSampleProject();
    p = okp(C.setConstraintConfirmation(p, 'IL-01', 'confirmed', stamp('2026-11-24T01:00:00.000Z')));
    p = okp(C.setConstraintConfirmation(p, 'IL-01', 'unconfirmed', stamp('2026-11-24T01:05:00.000Z')));
    expect(p.confirmationLog?.map((e) => `${e.from} → ${e.to}`)).toEqual(['미확인 → 확인됨', '확인됨 → 미확인']);
    const before = p.revision;
    const bad = C.setConstraintConfirmation(p, 'IL-01', 'confirmed', { by: '   ', at: '2026-11-24T01:06:00.000Z' });
    expect(bad.ok).toBe(false);
    expect(p.revision).toBe(before);
    expect(p.confirmationLog).toHaveLength(2);
    const legacy = okp(C.setConstraintConfirmation(p, 'IL-01', 'confirmed'));
    expect(legacy.constraints.find((k) => k.id === 'IL-01')?.confirmation).toBe('confirmed');
    expect(legacy.confirmationLog).toHaveLength(2);
  });

  it('keeps the confirmer name at 60 characters', () => {
    const p = buildSampleProject();
    const next = okp(C.setConstraintConfirmation(p, 'IL-01', 'confirmed', { by: `  ${'가'.repeat(80)}  `, at: '2026-11-24T00:00:00.000Z' }));
    expect(next.confirmationLog?.[0].by).toHaveLength(60);
    expect(normalizeConfirmerName('  김  ')).toBe('김');
  });

  it('AC3 undo drops the row and redo brings it back', () => {
    const base = buildSampleProject();
    let h = initHistory(base);
    h = applyEdit(h, C.setConstraintConfirmation(h.present, 'IL-01', 'confirmed', stamp('2026-11-24T01:00:00.000Z')), 'Interlock 확인', false).history;
    expect(h.present.confirmationLog).toHaveLength(1);
    expect(h.present.constraints.find((k) => k.id === 'IL-01')?.confirmation).toBe('confirmed');
    h = undo(h, false).history;
    expect(h.present.confirmationLog).toBeUndefined();
    expect(h.present.constraints.find((k) => k.id === 'IL-01')?.confirmation).toBe('unconfirmed');
    h = redo(h, false).history;
    expect(h.present.confirmationLog).toHaveLength(1);
    expect(h.present.constraints.find((k) => k.id === 'IL-01')?.confirmation).toBe('confirmed');
  });

  it('AC4 round-trips the log and leaves old files and the three samples unchanged', () => {
    let p = buildSampleProject();
    p = okp(C.setConstraintConfirmation(p, 'IL-01', 'confirmed', stamp('2026-11-24T01:00:00.000Z')));
    const raw = serializeProject(p);
    const opened = parseProjectFile(raw);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(serializeProject(opened.project)).toBe(raw);
    expect(opened.project.confirmationLog).toEqual(p.confirmationLog);

    const old = JSON.parse(serializeProject(buildSampleProject())) as { project: Project };
    delete old.project.confirmationLog;
    const legacy = parseProjectFile(JSON.stringify(old));
    expect(legacy.ok).toBe(true);
    if (!legacy.ok) return;
    expect(legacy.project.confirmationLog).toBeUndefined();
    expect(serializeProject(legacy.project)).toBe(serializeProject(buildSampleProject()));

    const junk = JSON.parse(serializeProject(buildSampleProject())) as { project: { confirmationLog?: unknown } };
    junk.project.confirmationLog = [{ at: 1 }, { at: '2026-11-24T01:00:00.000Z', by: '김', name: 'IL', from: '미확인', to: '확인됨', target: { kind: 'interlock', id: 'IL-01' } }];
    const cleaned = parseProjectFile(JSON.stringify(junk));
    expect(cleaned.ok).toBe(true);
    if (!cleaned.ok) return;
    expect(cleaned.project.confirmationLog).toHaveLength(1);

    for (const make of [buildSampleProject, buildParallelSampleProject, buildFlowSampleProject]) {
      expect(serializeProject(make())).not.toContain('confirmationLog');
    }
  });

  it('AC5 sorts by time and treats a deleted target as gone', () => {
    let p = buildSampleProject();
    const deviceId = p.devices[0].id;
    const prop = Object.keys(p.devices[0].properties)[0];
    p = okp(C.setDeviceProperty(p, deviceId, prop, 1, false, stamp('2026-11-24T02:00:00.000Z')));
    p = okp(C.setConstraintConfirmation(p, 'IL-01', 'confirmed', stamp('2026-11-24T01:00:00.000Z')));
    expect(sortedConfirmationLog(p.confirmationLog).map((e) => e.at)).toEqual(['2026-11-24T01:00:00.000Z', '2026-11-24T02:00:00.000Z']);
    const row = p.confirmationLog![0];
    expect(confirmationJump(p, row)?.field).toBe(`prop:${deviceId}:${prop}`);
    expect(targetLive(p, row.target)).toBe(true);
    p = okp(C.deleteNode(p, deviceId));
    expect(targetLive(p, row.target)).toBe(false);
    expect(confirmationJump(p, row)).toBeNull();
    expect(confirmationJump(p, p.confirmationLog![1])?.field).toBe('interlock:IL-01');
  });

  it('AC6 the caption is the latest confirmer and date while the value stays confirmed', () => {
    let p = buildSampleProject();
    const ref = { kind: 'action' as const, id: p.actions[0].id, field: 'duration' as const };
    p = okp(C.setQuantity(p, ref, p.actions[0].duration.value, false, stamp('2026-11-24T03:04:05.000Z', '박확인')));
    expect(confirmedCaption(p.confirmationLog, { kind: 'quantity', ref }, true)).toBe(`확인: 박확인 · ${formatLocalClock('2026-11-24T03:04:05.000Z')}`);
    p = okp(C.setQuantity(p, ref, p.actions[0].duration.value, true, stamp('2026-11-24T04:00:00.000Z', '박확인')));
    expect(confirmedCaption(p.confirmationLog, { kind: 'quantity', ref }, false)).toBeNull();
    expect(confirmedCaption(p.confirmationLog, { kind: 'quantity', ref }, true)).toBeNull();
  });

  it('AC7 puts the log in the draft export and the reverse check matches', () => {
    let p = buildSampleProject();
    p = okp(C.setConstraintConfirmation(p, 'IL-01', 'confirmed', stamp('2026-11-24T01:00:00.000Z')));
    const text = serializeAuroraExport(buildAuroraExport(p));
    expect(text).toContain('confirmationLog');
    expect(text).toContain('김검토');
    const parsed = parseAuroraExport(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const report = compareAuroraExport(buildAuroraExport(p), parsed.file);
    expect(report.missing).toEqual([]);
    expect(report.removed).toEqual([]);
    expect(report.changed).toEqual([]);
    const bare = serializeAuroraExport(buildAuroraExport(buildSampleProject()));
    expect(bare).not.toContain('confirmationLog');
    expect(bare).not.toMatch(/"at":/);
    const counts = report.counts.find((c) => c.kind === 'confirmation');
    expect(counts).toMatchObject({ model: 1, file: 1 });
  });

  it('stores the confirmer name in the view, not in an untouched project file', () => {
    expect(DEFAULT_VIEW.confirmerName).toBe('');
    const store = new Map<string, string>();
    const kv = {
      store,
      getItem(k: string) { return store.get(k) ?? null; },
      setItem(k: string, v: string) { store.set(k, v); },
      removeItem(k: string) { store.delete(k); },
      key(i: number) { return [...store.keys()][i] ?? null; },
      get length() { return store.size; },
    };
    kv.setItem(VIEW_KEY, JSON.stringify({ confirmerName: `  ${'나'.repeat(70)}` }));
    expect(loadView(kv).confirmerName).toHaveLength(60);
    expect(serializeProject(buildSampleProject())).not.toContain('나');
  });
});
