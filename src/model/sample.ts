import { instantiateDevice, makeUnit, emptyProject, type DeviceBundle } from './factory';
import type { Action, AssetKind, Condition, MaterialEffect, Project, SequenceStep, Unit } from './types';
import { q } from './types';

// 첫 5공정 초기 예제 (14절). 장치 구성은 [확정], 시간·크기·무게·타임아웃 값은 모두 [예시] 가정값이다.
export const SAMPLE_NOTE = [
  '모든 시간·크기·무게·타임아웃은 [예시] 가정값이며 실제 장비 사양이 아님',
  '구간 사이 자재 이동은 스토퍼 하강(해제) Action 시간에 포함된 것으로 가정 (시제품 가정)',
  'S3 가공은 가상 작업(실린더 전진 2.0 s)으로 대체',
];

export function buildSampleProject(): Project {
  let n = 0;
  const seqId = (p: string) => `${p}-${(++n).toString().padStart(3, '0')}`;
  const p = emptyProject('조립 라인 01 (5공정 예제)', seqId);
  p.id = 'prj-sample-5step';

  const unitSpecs: [string, string][] = [['S1', '투입'], ['S2', '식별'], ['S3', '가공'], ['S4', '이송'], ['S5', '배출']];
  const units: Unit[] = unitSpecs.map(([code, name], i) => {
    const u = makeUnit(`${code} ${name}`, code, { x: 30 + i * 236, y: 70, w: 216, h: 300 }, () => `U-${code}`);
    u.capacity.maxWeight = q(5, 'kg', true, { method: 'sample-example' });
    return u;
  });
  p.units = units;
  p.equipment.unitIds = units.map((u) => u.id);
  const U = (code: string) => units.find((u) => u.code === code)!;

  const bundles: Record<string, DeviceBundle> = {};
  const add = (code: string, kind: AssetKind, unitCode: string, dx: number, dy: number) => {
    let k = 0;
    const unit = U(unitCode);
    const b = instantiateDevice(kind, unit.id, { x: unit.layout.x + dx, y: unit.layout.y + dy }, code,
      (pre) => (pre === 'dev' ? code : `${code}.${pre}${++k}`));
    unit.deviceIds.push(b.device.id);
    p.devices.push(b.device); p.signals.push(...b.signals); p.positions.push(...b.positions); p.actions.push(...b.actions);
    bundles[code] = b;
  };
  add('PSH-01', 'pusher', 'S1', 20, 150);
  add('CYL-01', 'cylinder', 'S1', 140, 60);
  add('STP-02', 'stopper', 'S2', 150, 180);
  add('BCR-02', 'barcodeReader', 'S2', 40, 70);
  add('STP-03', 'stopper', 'S3', 150, 180);
  add('CYL-03', 'cylinder', 'S3', 50, 60);
  add('GNT-04', 'gantry', 'S4', 30, 40);
  add('PCK-04', 'picker', 'S4', 80, 140);
  add('STP-05', 'stopper', 'S5', 20, 180);
  add('CNV-05', 'conveyor', 'S5', 40, 240);

  const sig = (code: string, port: string) => bundles[code].signals.find((s) => s.portKey === port)!.id;
  const act = (code: string, i = 0): Action => bundles[code].actions[i];

  // Positions for gantry (가정값)
  p.positions.push(
    { id: 'GNT-04.pos-pick', name: 'GNT-04 잡기 위치', deviceId: 'GNT-04', value: q(0, 'mm', true, { method: 'sample-example' }) },
    { id: 'GNT-04.pos-place', name: 'GNT-04 놓기 위치', deviceId: 'GNT-04', value: q(400, 'mm', true, { method: 'sample-example' }) },
  );

  const setA = (a: Action, name: string, dur: number, pre: Condition[], effect: MaterialEffect, post: Condition[] = [], timeout?: number) => {
    a.name = name; a.duration = q(dur, 's', true, { method: 'sample-example' }); a.pre = pre; a.effect = effect; a.post = post;
    if (timeout !== undefined) a.timeout = q(timeout, 's', true, { method: 'sample-example' });
  };
  setA(act('PSH-01'), 'S1 푸셔 투입', 0.8, [{ kind: 'materialAt', unitId: U('S1').id }], { moveTo: U('S2').id, setState: '투입됨' });
  setA(act('STP-02', 0), 'S2 스토퍼 상승(정지)', 0.3, [{ kind: 'materialAt', unitId: U('S2').id }], {});
  setA(act('BCR-02'), 'S2 바코드 읽기', 0.5, [{ kind: 'signal', signalId: sig('STP-02', 'upDone'), equals: true }, { kind: 'materialAt', unitId: U('S2').id }], { setState: '식별됨' });
  setA(act('STP-02', 1), 'S2 스토퍼 하강(S3로 이동)', 1.2, [], { moveTo: U('S3').id }, [], 3);
  setA(act('STP-03', 0), 'S3 스토퍼 상승(정지)', 0.3, [{ kind: 'materialAt', unitId: U('S3').id }], {});
  setA(act('CYL-03'), 'S3 가공 실린더 전진(가상 작업)', 2.0,
    [{ kind: 'signal', signalId: sig('STP-03', 'upDone'), equals: true }, { kind: 'materialState', state: '식별됨' }],
    { setState: '가공됨' }, [{ kind: 'signal', signalId: sig('STP-03', 'upDone'), equals: true }], 4);
  setA(act('STP-03', 1), 'S3 스토퍼 하강(S4로 이동)', 1.0, [], { moveTo: U('S4').id }, [], 3);
  setA(act('PCK-04', 0), 'S4 피커 잡기', 0.6, [{ kind: 'materialAt', unitId: U('S4').id }, { kind: 'materialHeldBy', deviceId: null }], { holder: 'PCK-04' });
  setA(act('GNT-04'), 'S4 갠트리 놓기위치 이동', 1.5, [{ kind: 'materialHeldBy', deviceId: 'PCK-04' }], {});
  act('GNT-04').targetPositionId = 'GNT-04.pos-place';
  setA(act('PCK-04', 1), 'S4 피커 놓기(S5로)', 0.6, [{ kind: 'materialHeldBy', deviceId: 'PCK-04' }], { moveTo: U('S5').id, holder: null });
  setA(act('STP-05', 1), 'S5 스토퍼 하강(해제)', 0.3, [{ kind: 'materialAt', unitId: U('S5').id }], {});
  setA(act('CNV-05'), 'S5 컨베이어 배출', 2.0, [{ kind: 'materialAt', unitId: U('S5').id }, { kind: 'signal', signalId: sig('STP-05', 'downDone'), equals: true }], { moveTo: 'EXIT', setState: '배출 완료' });
  act('STP-05', 0).name = 'S5 스토퍼 상승(정지)';
  act('CYL-01').name = 'S1 실린더 전진(푸셔 보조, 시퀀스 미사용)';

  const order: Action[] = [act('PSH-01'), act('STP-02', 0), act('BCR-02'), act('STP-02', 1), act('STP-03', 0), act('CYL-03'),
    act('STP-03', 1), act('PCK-04', 0), act('GNT-04'), act('PCK-04', 1), act('STP-05', 1), act('CNV-05')];
  const steps: SequenceStep[] = order.map((a, i) => ({
    id: `STEP-${String(i + 1).padStart(2, '0')}`, name: a.name, actionId: a.id, timeoutOverride: null, entry: [], origin: 'sample',
  }));
  p.sequence = { id: 'SEQ-main', name: '5공정 순차 시퀀스', steps, unresolved: [] };

  p.materials = [{
    id: 'MAT-001', name: 'M-001 공작물', kind: 'individual', carrierOf: null,
    size: { w: q(100, 'mm'), l: q(100, 'mm'), h: q(50, 'mm') }, weight: q(0.5, 'kg'), handling: '일반 (예시)',
    states: ['대기', '투입됨', '식별됨', '식별실패', '가공됨', '배출 완료'], initialState: '대기', initialLocation: U('S1').id,
    route: units.map((u) => u.id), feedInterval: q(10, 's', true, { method: 'sample-example' }),
  }];

  p.connections = [
    ...units.slice(0, -1).map((u, i) => ({ id: `FLOW-${i + 1}`, kind: 'flow' as const, from: { nodeId: u.id }, to: { nodeId: units[i + 1].id } })),
    { id: 'SIGC-1', kind: 'signal', from: { nodeId: 'STP-02', signalId: sig('STP-02', 'upDone') }, to: { nodeId: 'BCR-02', signalId: sig('BCR-02', 'trigger') } },
    { id: 'SIGC-2', kind: 'signal', from: { nodeId: 'STP-03', signalId: sig('STP-03', 'upDone') }, to: { nodeId: 'CYL-03', signalId: sig('CYL-03', 'cmdFwd') } },
    { id: 'SIGC-3', kind: 'signal', from: { nodeId: 'PCK-04', signalId: sig('PCK-04', 'picked') }, to: { nodeId: 'GNT-04', signalId: sig('GNT-04', 'cmdMove') } },
  ];
  p.constraints = [
    { id: 'IL-01', kind: 'interlock-candidate', description: 'CYL-03 전진은 STP-03 상승 완료일 때만 허용 (후보)', relatedIds: ['CYL-03', 'STP-03'], confirmation: 'unconfirmed', source: { method: 'sample-example' } },
    { id: 'IL-02', kind: 'interlock-candidate', description: 'GNT-04 이동 중 PCK-04 놓기 금지 (후보)', relatedIds: ['GNT-04', 'PCK-04'], confirmation: 'unconfirmed', source: { method: 'sample-example' } },
  ];
  p.assumptionsNote = [...SAMPLE_NOTE];
  p.revision = 1;
  return p;
}

// v0.3 추가 예제: Station > Substation > Device 와 Substation 안의 병렬 시퀀스 2개 (독립 Device, 자재 미사용).
// 구성·시간은 모두 [예시] 가정값이며 실제 장비 사양이 아님. 기본 5공정 예제는 변경하지 않음.
export function buildParallelSampleProject(): Project {
  let n = 0;
  const seqId = (p: string) => `${p}-${(++n).toString().padStart(3, '0')}`;
  const p = emptyProject('병렬 Substation 예제 (v0.3)', seqId);
  p.id = 'prj-sample-parallel';
  p.equipment.name = 'Station A (예시)';
  const u1 = makeUnit('S1 듀얼 클램프', 'S1', { x: 30, y: 70, w: 300, h: 300 }, () => 'U-PS1');
  const u2 = makeUnit('S2 푸시 아웃', 'S2', { x: 360, y: 70, w: 216, h: 300 }, () => 'U-PS2');
  p.units = [u1, u2]; p.equipment.unitIds = [u1.id, u2.id];
  const bundles: Record<string, DeviceBundle> = {};
  const add = (code: string, kind: AssetKind, unit: Unit, dx: number, dy: number) => {
    let k = 0;
    const b = instantiateDevice(kind, unit.id, { x: unit.layout.x + dx, y: unit.layout.y + dy }, code, (pre) => (pre === 'dev' ? code : `${code}.${pre}${++k}`));
    unit.deviceIds.push(b.device.id);
    p.devices.push(b.device); p.signals.push(...b.signals); p.positions.push(...b.positions); p.actions.push(...b.actions);
    bundles[code] = b;
  };
  add('STP-A1', 'stopper', u1, 30, 200);
  add('STP-B1', 'stopper', u1, 170, 200);
  add('CYL-B1', 'cylinder', u1, 160, 50);
  add('PSH-21', 'pusher', u2, 40, 150);
  const act = (code: string, i = 0): Action => bundles[code].actions[i];
  const sig = (code: string, port: string) => bundles[code].signals.find((s) => s.portKey === port)!.id;
  const setA = (a: Action, name: string, dur: number, pre: Condition[] = []) => { a.name = name; a.duration = q(dur, 's', true, { method: 'sample-example' }); a.pre = pre; };
  setA(act('STP-A1', 0), 'A 클램프 상승', 0.5);
  setA(act('STP-A1', 1), 'A 클램프 하강', 0.7);
  setA(act('STP-B1', 0), 'B 클램프 상승', 0.4);
  setA(act('CYL-B1'), 'B 실린더 전진', 0.8, [{ kind: 'signal', signalId: sig('STP-B1', 'upDone'), equals: true }]);
  setA(act('STP-B1', 1), 'B 클램프 하강', 0.4);
  setA(act('PSH-21'), 'S2 푸시', 0.9);
  const st = (id: string, a: Action): SequenceStep => ({ id, name: a.name, actionId: a.id, timeoutOverride: null, entry: [], origin: 'sample' });
  p.substationSequences = [
    { id: 'SSEQ-S1-A', name: 'S1 시퀀스 A (클램프 A)', unitId: u1.id, unresolved: [], steps: [st('SSTEP-A1', act('STP-A1', 0)), st('SSTEP-A2', act('STP-A1', 1))] },
    { id: 'SSEQ-S1-B', name: 'S1 시퀀스 B (클램프 B + 실린더)', unitId: u1.id, unresolved: [], steps: [st('SSTEP-B1', act('STP-B1', 0)), st('SSTEP-B2', act('CYL-B1')), st('SSTEP-B3', act('STP-B1', 1))] },
    { id: 'SSEQ-S2-A', name: 'S2 시퀀스 A (푸시)', unitId: u2.id, unresolved: [], steps: [st('SSTEP-C1', act('PSH-21'))] },
  ];
  p.sequence = { id: 'SEQ-station', name: 'Station 시퀀스 (이 예제에서는 비어 있음)', steps: [], unresolved: [] };
  p.connections = [{ id: 'FLOW-P1', kind: 'flow', from: { nodeId: u1.id }, to: { nodeId: u2.id } }];
  p.assumptionsNote = ['모든 시간은 [예시] 가정값이며 실제 장비 사양이 아님', 'S1의 두 시퀀스는 서로 다른 Device만 사용 (공유 Device 없음 → 동시 실행 허용)', '자재는 정의하지 않음 — Station 시퀀스 실행은 이 예제에서 대상 아님'];
  p.revision = 1;
  return p;
}
