// TURN-066. Object index is a pure read of the model.
import { describe, expect, it } from 'vitest';
import { emptyProject } from '../src/model/factory';
import { analyzeGaps } from '../src/model/gaps';
import { buildFlowSampleProject, buildParallelSampleProject, buildSampleProject } from '../src/model/sample';
import type { Device } from '../src/model/types';
import {
  OBJECT_KINDS,
  OBJECT_PAGE,
  findObjects,
  indexObjects,
  parseFindQuery,
  searchObjects,
  type ObjectKind,
} from '../src/ui/objectFind';

const sample = buildSampleProject();
const entries = indexObjects(sample);

function ids(kind: ObjectKind, text: string) {
  const group = searchObjects(entries, text, new Set(OBJECT_KINDS)).find((g) => g.kind === kind);
  return group?.shown.map((row) => row.id) ?? [];
}

describe('TURN-066 object index', () => {
  it('AC2 > is commands only and @ is objects only', () => {
    expect(parseFindQuery('>복제')).toEqual({ scope: 'commands', text: '복제' });
    expect(parseFindQuery('@CYL-01')).toEqual({ scope: 'objects', text: 'CYL-01' });
    expect(parseFindQuery('  @ 투입')).toEqual({ scope: 'objects', text: '투입' });
    expect(parseFindQuery('실행')).toEqual({ scope: 'all', text: '실행' });
    expect(parseFindQuery('>')).toEqual({ scope: 'commands', text: '' });
    expect(parseFindQuery('@')).toEqual({ scope: 'objects', text: '' });
  });

  it('AC3 matches name, code, and screen name, ignoring spaces and case', () => {
    expect(ids('unit', 's1 투입')).toContain('U-S1');
    expect(ids('unit', 'S1')).toContain('U-S1');
    expect(ids('device', 'cyl-01')).toEqual(['CYL-01']);
    expect(ids('device', '실린더')).toEqual(expect.arrayContaining(['CYL-01', 'CYL-03']));
    expect(ids('device', '실린더')).not.toContain('PSH-01');

    const signal = entries.find((e) => e.kind === 'signal' && e.name === 'CYL-01.전진 완료')!;
    expect(signal.code).toBe('CYL-01');
    expect(signal.where).toBe('S1 투입 › CYL-01');
    expect(ids('signal', '전진완료')).toContain(signal.id);
    expect(ids('signal', signal.code)).toContain(signal.id);

    const position = entries.find((e) => e.id === 'GNT-04.pos-pick')!;
    expect(position.kind).toBe('position');
    expect(ids('position', '잡기 위치')).toContain(position.id);

    const action = entries.find((e) => e.kind === 'action' && e.name.includes('푸셔 보조'))!;
    expect(ids('action', '푸셔보조')).toContain(action.id);

    expect(ids('step', 'step-01')).toContain('STEP-01');
    expect(ids('interlock', 'il-01')).toContain('IL-01');
    expect(ids('material', '공작물')).toContain('MAT-001');
    expect(entries.find((e) => e.id === 'CYL-01')!.where).toBe('S1 투입 › CYL-01');

    const flow = indexObjects(buildFlowSampleProject());
    const block = flow.find((e) => e.id === 'FLW-BRANCH')!;
    expect(block.kind).toBe('block');
    expect(block.screenName).toContain('분기');
    expect(searchObjects(flow, '읽기 결과', new Set(['block'])).find((g) => g.kind === 'block')!.shown.map((e) => e.id)).toContain('FLW-BRANCH');
    expect(flow.some((e) => e.id === 'FLW-LOOP' && e.kind === 'block')).toBe(true);
    expect(flow.some((e) => e.id === 'FLW-PAR' && e.kind === 'block')).toBe(true);

    const parallel = indexObjects(buildParallelSampleProject());
    expect(parallel.some((e) => e.kind === 'step' && e.id === 'SSTEP-A1' && e.jump.sub === 'subseq')).toBe(true);
    expect(parallel.some((e) => e.kind === 'block' && e.jump.field === 'flow:FLW-SUB-S1')).toBe(true);

    const gap = analyzeGaps(sample)[0];
    expect(ids('gap', gap.title.slice(0, 12))).toContain(gap.id);
  });

  it('pages each kind at five rows and keeps kind order', () => {
    const groups = searchObjects(entries, '');
    expect(groups.map((g) => g.kind)).toEqual(OBJECT_KINDS.filter((kind) => entries.some((e) => e.kind === kind)));
    const signals = groups.find((g) => g.kind === 'signal')!;
    expect(signals.shown).toHaveLength(OBJECT_PAGE);
    expect(signals.more).toBeGreaterThan(0);
    const open = searchObjects(entries, '', new Set(['signal'])).find((g) => g.kind === 'signal')!;
    expect(open.more).toBe(0);
    expect(open.shown.length).toBe(OBJECT_PAGE + signals.more);
  });

  it('AC5 reading the index does not change the model', () => {
    const before = JSON.stringify(sample);
    findObjects(sample, 'CYL');
    expect(JSON.stringify(sample)).toBe(before);
    expect(sample.revision).toBe(1);
  });

  it('AC6 searches a 1,000-object model in under 50ms', () => {
    const project = emptyProject('천개');
    const devices: Device[] = [];
    for (let i = 0; i < 1000; i++) {
      devices.push({
        id: `D${i}`,
        name: i === 42 ? '표적-0042' : `장치-${String(i).padStart(4, '0')}`,
        kind: 'sensor',
        definitionRef: { assetId: 'none', version: '0' },
        unitId: 'none',
        layout: { x: (i % 50) * 80, y: Math.floor(i / 50) * 80, w: 20, h: 20 },
        properties: {},
      });
    }
    project.devices = devices;
    expect(indexObjects(project)).toHaveLength(1000);
    const started = performance.now();
    const found = findObjects(project, '표적');
    expect(performance.now() - started).toBeLessThan(50);
    expect(found.find((g) => g.kind === 'device')!.shown.map((e) => e.name)).toEqual(['표적-0042']);
  });
});
