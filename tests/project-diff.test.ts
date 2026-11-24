import { describe, expect, it } from 'vitest';
import { emptyProject, makeUnit } from '../src/model/factory';
import {
  DIFF_KINDS, diffProjects, diffSummaryText, groupDiff, type DiffKind,
} from '../src/model/projectDiff';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import { parseProjectFile, serializeProject } from '../src/storage/fileFormat';
import type { Device, Project } from '../src/model/types';
import { q } from '../src/model/types';

function kindOrder(kind: DiffKind): number {
  return DIFF_KINDS.indexOf(kind);
}

describe('TURN-081 project diff', () => {
  it('AC1 reports one added device, one removed device, and one action time with before and after', () => {
    const saved = buildSampleProject();
    const now = structuredClone(saved);
    const donor = structuredClone(now.devices[0]);
    const added: Device = { ...donor, id: 'DEV-NEW', name: '추가 장치' };
    now.devices.push(added);
    const removed = now.devices[1];
    now.devices = now.devices.filter((d) => d.id !== removed.id);
    const action = now.actions[0];
    const before = `${action.duration.value} ${action.duration.unit}`;
    action.duration = { ...action.duration, value: 9.5 };
    const diff = diffProjects(saved, now);
    expect(diffSummaryText(diff)).toBe('추가 1 · 삭제 1 · 바뀜 1');
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.changed).toBe(1);
    expect(diff.rows.find((r) => r.change === 'added')).toMatchObject({ kind: 'device', id: 'DEV-NEW', name: '추가 장치' });
    expect(diff.rows.find((r) => r.change === 'removed')).toMatchObject({ kind: 'device', id: removed.id, name: removed.name });
    const changed = diff.rows.find((r) => r.change === 'changed')!;
    expect(changed.kind).toBe('action');
    expect(changed.field).toBe('동작 시간');
    expect(changed.before).toContain(before);
    expect(changed.after).toContain('9.5 s');
    expect(changed.before).not.toBe(changed.after);
  });

  it('AC2 groups kinds and folds a move into one 위치 line', () => {
    const saved = buildSampleProject();
    const now = structuredClone(saved);
    const device = now.devices[0];
    device.layout = { ...device.layout, x: device.layout.x + 40, y: device.layout.y + 12 };
    now.signals[0].address = 'X10';
    now.signals[0].addressStatus = 'assumed';
    const diff = diffProjects(saved, now);
    const deviceRows = diff.rows.filter((r) => r.id === device.id);
    expect(deviceRows).toHaveLength(1);
    expect(deviceRows[0]).toMatchObject({ change: 'changed', kind: 'device', field: '위치' });
    expect(deviceRows[0].before).not.toContain('\n');
    expect(deviceRows[0].after).toContain(String(device.layout.x));
    expect(deviceRows[0].after).toContain(String(device.layout.y));
    const groups = groupDiff(diff);
    expect(groups.map((g) => g.kind)).toEqual(['device', 'signal']);
    const kinds = diff.rows.map((r) => r.kind);
    const sorted = [...kinds].sort((a, b) => kindOrder(a) - kindOrder(b));
    expect(kinds).toEqual(sorted);
    expect(groups.every((g) => g.rows.every((r) => r.kind === g.kind))).toBe(true);
  });

  it('AC6 AC8 leaves both models untouched and repeats the same rows in the same order', () => {
    const saved = buildSampleProject();
    const now = structuredClone(saved);
    now.name = '다른 이름';
    now.devices[2].layout = { ...now.devices[2].layout, x: 3, y: 9, w: 11, h: 13 };
    const snapSaved = structuredClone(saved);
    const snapNow = structuredClone(now);
    const first = diffProjects(saved, now);
    const second = diffProjects(structuredClone(snapSaved), structuredClone(snapNow));
    expect(saved).toEqual(snapSaved);
    expect(now).toEqual(snapNow);
    expect(second).toEqual(first);
    expect(first.rows.length).toBeGreaterThan(0);

    const reordered = structuredClone(saved);
    const props = reordered.devices[0].properties;
    reordered.devices[0].properties = Object.fromEntries(Object.keys(props).reverse().map((key) => [key, props[key]]));
    expect(diffProjects(saved, reordered).rows).toEqual([]);

    const broken = parseProjectFile('{');
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.errors[0].message).toContain('JSON');
    expect(saved.revision).toBe(snapSaved.revision);
  });

  it('AC7 compares 500 devices in under a second', () => {
    const unit = makeUnit('많은 장치', 'S1', { x: 0, y: 0, w: 4000, h: 4000 }, () => 'U-BULK');
    const make = (tag: string): Project => {
      const p = emptyProject('대량');
      p.id = 'prj-bulk';
      p.equipment.id = 'EQ-BULK';
      p.equipment.unitIds = [unit.id];
      p.units = [structuredClone(unit)];
      p.sequence.id = 'SEQ-BULK';
      for (let i = 0; i < 500; i++) {
        const id = `D${i}`;
        p.units[0].deviceIds.push(id);
        p.devices.push({
          id, name: `${tag}-${i}`, kind: 'sensor', definitionRef: { assetId: 'asset.sensor', version: '1' },
          unitId: unit.id, layout: { x: i * 10, y: i, w: 36, h: 32 },
          properties: { range: q(i, 'mm', true, { method: 'direct-input' }) },
        });
        p.signals.push({
          id: `SIG${i}`, name: `신호 ${i}`, deviceId: id, portKey: 'in', direction: 'in', valueType: 'bool',
          role: 'sensor', address: null, addressStatus: 'unassigned',
        });
        p.actions.push({
          id: `ACT${i}`, name: `동작 ${i}`, unitId: unit.id, deviceId: id, kind: 'read', params: {},
          duration: q(0.2, 's'), timeout: q(1, 's'), commandSignalId: null, completeSignalId: null,
          targetPositionId: null, pre: [], post: [], effect: {},
        });
      }
      return p;
    };
    const before = make('a');
    const after = make('a');
    after.actions[499].duration = { ...after.actions[499].duration, value: 3 };
    const started = performance.now();
    const diff = diffProjects(before, after);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(diff.changed).toBe(1);
    expect(diff.rows[0]).toMatchObject({ kind: 'action', id: 'ACT499', field: '동작 시간' });
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
  });

  it('a saved round trip of a renamed project is only the name, and identical samples are empty', () => {
    for (const build of [buildSampleProject, buildParallelSampleProject, buildFlowSampleProject]) {
      const project = build();
      expect(diffProjects(project, structuredClone(project)).rows).toEqual([]);
    }
    const saved = buildSampleProject();
    const renamed = structuredClone(saved);
    renamed.name = '바꾼 이름';
    renamed.revision += 1;
    const left = parseProjectFile(serializeProject(saved));
    const right = parseProjectFile(serializeProject(renamed));
    expect(left.ok && right.ok).toBe(true);
    if (!left.ok || !right.ok) return;
    const diff = diffProjects(left.project, right.project);
    expect(diff.rows.map((r) => `${r.kind}:${r.field}`)).toEqual(['project:이름']);
    expect(diff.rows[0].before).toContain(saved.name);
    expect(diff.rows[0].after).toContain('바꾼 이름');
  });

  it('a lock change is one 잠금 row and a background move is one 위치 row', () => {
    const base = emptyProject('잠금');
    const unit = makeUnit('유닛', 'S1', { x: 0, y: 0, w: 200, h: 120 }, () => 'U-LOCK');
    base.units = [unit];
    base.equipment.unitIds = [unit.id];
    base.diagramBackground = { dataUrl: 'data:image/png;base64,aaaa', width: 20, height: 10, x: 1, y: 2, scale: 1, opacity: 80, locked: true };
    const next = structuredClone(base);
    next.units[0].positionLocked = true;
    next.diagramBackground!.x = 30;
    next.diagramBackground!.y = 8;
    const diff = diffProjects(base, next);
    expect(diff.rows.filter((r) => r.kind === 'lock')).toEqual([
      expect.objectContaining({ change: 'changed', field: '위치 잠금', before: '풀림', after: '잠김', id: unit.id }),
    ]);
    expect(diff.rows.filter((r) => r.kind === 'background')).toEqual([
      expect.objectContaining({ field: '위치', before: '1, 2', after: '30, 8' }),
    ]);
  });
});
