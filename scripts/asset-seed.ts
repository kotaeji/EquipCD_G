// GENERATOR SEED ONLY (not bundled into the app): used once by scripts/gen-aml.ts to (re)write
// assets/aml/ecd-sample-library.aml. The app reads that AML file as the asset source of truth.
// All numbers are [예시] assumptions, not real device specifications.
import type { AssetDefinition } from '../src/model/types';

const V = '0.1.0'; // existing 8 definitions are semantically unchanged from v0.1 → version kept
type Seed = Omit<AssetDefinition, 'amlSource' | 'version' | 'template' | 'visualRefs' | 'roleClassPath'> & { template?: AssetDefinition['template']; photo: string; match: string; scope: string };
const role = (c: AssetDefinition['category']) => `ECD_RoleClassLib/${({ axis: 'AxisDevice', io: 'IODevice', sensor: 'SensorDevice', transport: 'TransportDevice', unit: 'EquipmentUnit' })[c]}`;

const seeds: Seed[] = [
  { id: 'asset.cylinder', kind: 'cylinder', name: '실린더', category: 'axis', namePrefix: 'CYL',
    properties: [{ key: 'stroke', label: '스트로크', unit: 'mm', defaultValue: 100, requiredForRun: true }, { key: 'moveTime', label: '이동 시간', unit: 's', defaultValue: 0.8, requiredForRun: true }],
    ports: [{ key: 'cmdFwd', label: '전진 명령', direction: 'in', role: 'command' }, { key: 'fwdDone', label: '전진 완료', direction: 'out', role: 'complete' }],
    actions: [{ key: 'extend', label: '전진', kind: 'extend', commandPort: 'cmdFwd', completePort: 'fwdDone', durationS: 0.8, timeoutS: 3 }], photo: 'cyl.jpg', match: 'class-reference', scope: '' },
  { id: 'asset.pusher', kind: 'pusher', name: '푸셔', category: 'axis', namePrefix: 'PSH',
    properties: [{ key: 'stroke', label: '푸시 스트로크', unit: 'mm', defaultValue: 150, requiredForRun: true }, { key: 'pushTime', label: '푸시 시간', unit: 's', defaultValue: 0.8, requiredForRun: true }],
    ports: [{ key: 'cmdPush', label: '푸시 명령', direction: 'in', role: 'command' }, { key: 'pushDone', label: '푸시 완료', direction: 'out', role: 'complete' }],
    actions: [{ key: 'push', label: '푸시', kind: 'extend', commandPort: 'cmdPush', completePort: 'pushDone', durationS: 0.8, timeoutS: 3 }], photo: 'cyl.jpg', match: 'component-reference', scope: '' },
  { id: 'asset.barcodeReader', kind: 'barcodeReader', name: '바코드리더', category: 'sensor', namePrefix: 'BCR',
    properties: [{ key: 'readTime', label: '읽기 시간', unit: 's', defaultValue: 0.5, requiredForRun: true }],
    ports: [{ key: 'trigger', label: '읽기 트리거', direction: 'in', role: 'command' }, { key: 'readDone', label: '읽기 완료', direction: 'out', role: 'complete' }, { key: 'readOk', label: '읽기 결과 OK', direction: 'out', role: 'result' }],
    actions: [{ key: 'read', label: '읽기', kind: 'read', commandPort: 'trigger', completePort: 'readDone', durationS: 0.5, timeoutS: 2 }], photo: 'bcr.jpg', match: 'class-reference', scope: '' },
  { id: 'asset.conveyor', kind: 'conveyor', name: '컨베이어', category: 'transport', namePrefix: 'CNV',
    properties: [{ key: 'length', label: '길이', unit: 'mm', defaultValue: 600, requiredForRun: false }, { key: 'speed', label: '속도', unit: 'mm/s', defaultValue: 300, requiredForRun: true }],
    ports: [{ key: 'run', label: '구동 명령', direction: 'in', role: 'command' }, { key: 'exitSensor', label: '배출 감지', direction: 'out', role: 'complete' }],
    actions: [{ key: 'convey', label: '이송', kind: 'convey', commandPort: 'run', completePort: 'exitSensor', durationS: 2, timeoutS: 5 }], photo: 'conv.jpg', match: 'class-reference', scope: '' },
  { id: 'asset.stopper', kind: 'stopper', name: '스토퍼', category: 'io', namePrefix: 'STP',
    properties: [{ key: 'actTime', label: '동작 시간', unit: 's', defaultValue: 0.3, requiredForRun: true }],
    ports: [{ key: 'cmdUp', label: '상승 명령', direction: 'in', role: 'command' }, { key: 'upDone', label: '상승 완료', direction: 'out', role: 'complete' }, { key: 'cmdDown', label: '하강 명령', direction: 'in', role: 'command' }, { key: 'downDone', label: '하강 완료', direction: 'out', role: 'complete' }],
    actions: [{ key: 'raise', label: '상승(정지)', kind: 'raise', commandPort: 'cmdUp', completePort: 'upDone', durationS: 0.3, timeoutS: 1.5 }, { key: 'lower', label: '하강(해제)', kind: 'lower', commandPort: 'cmdDown', completePort: 'downDone', durationS: 0.3, timeoutS: 1.5 }], photo: 'cyl.jpg', match: 'component-reference', scope: '' },
  { id: 'asset.gantry', kind: 'gantry', name: '갠트리', category: 'axis', namePrefix: 'GAN',
    properties: [{ key: 'travelX', label: 'X 이동거리', unit: 'mm', defaultValue: 400, requiredForRun: true }, { key: 'speed', label: '축 속도', unit: 'mm/s', defaultValue: 300, requiredForRun: true }],
    ports: [{ key: 'cmdMove', label: '이동 명령', direction: 'in', role: 'command' }, { key: 'inPos', label: '위치 도달', direction: 'out', role: 'complete' }],
    actions: [{ key: 'move', label: '이동', kind: 'move', commandPort: 'cmdMove', completePort: 'inPos', durationS: 1.5, timeoutS: 4 }], photo: 'gantry.jpg', match: 'class-reference', scope: '' },
  { id: 'asset.picker', kind: 'picker', name: '피커', category: 'axis', namePrefix: 'PCK',
    properties: [{ key: 'zStroke', label: 'Z 스트로크', unit: 'mm', defaultValue: 80, requiredForRun: true }, { key: 'payload', label: '허용 하중', unit: 'kg', defaultValue: 2, requiredForRun: true }],
    ports: [{ key: 'cmdPick', label: '잡기 명령', direction: 'in', role: 'command' }, { key: 'picked', label: '잡기 완료', direction: 'out', role: 'complete' }, { key: 'cmdPlace', label: '놓기 명령', direction: 'in', role: 'command' }, { key: 'placed', label: '놓기 완료', direction: 'out', role: 'complete' }],
    actions: [{ key: 'pick', label: '잡기', kind: 'pick', commandPort: 'cmdPick', completePort: 'picked', durationS: 0.6, timeoutS: 2 }, { key: 'place', label: '놓기', kind: 'place', commandPort: 'cmdPlace', completePort: 'placed', durationS: 0.6, timeoutS: 2 }], photo: 'picker.jpg', match: 'class-reference', scope: '' },
  { id: 'asset.sensor', kind: 'sensor', name: '센서', category: 'sensor', namePrefix: 'SEN',
    properties: [{ key: 'responseTime', label: '응답 시간', unit: 's', defaultValue: 0.05, requiredForRun: false }],
    ports: [{ key: 'detect', label: '감지', direction: 'out', role: 'sensor' }], actions: [], photo: 'press.jpg', match: 'class-reference', scope: '' },
  { id: 'asset.photoelectricSensor', kind: 'photoelectricSensor', name: '광전 센서', category: 'sensor', namePrefix: 'PES',
    properties: [{ key: 'detectRange', label: '검출 거리', unit: 'mm', defaultValue: 300, requiredForRun: false }, { key: 'responseTime', label: '응답 시간', unit: 's', defaultValue: 0.001, requiredForRun: false }],
    ports: [{ key: 'detect', label: '광 검출(자재 있음)', direction: 'out', role: 'sensor' }], actions: [], photo: 'photo.jpg', match: 'class-reference', scope: '' },
  { id: 'asset.proximitySensor', kind: 'proximitySensor', name: '근접 센서', category: 'sensor', namePrefix: 'PRX',
    properties: [{ key: 'sensingDistance', label: '검출 거리', unit: 'mm', defaultValue: 8, requiredForRun: false }, { key: 'responseTime', label: '응답 시간', unit: 's', defaultValue: 0.002, requiredForRun: false }],
    ports: [{ key: 'detect', label: '근접 검출', direction: 'out', role: 'sensor' }], actions: [], photo: 'prox.jpg', match: 'class-reference', scope: '' },
  { id: 'asset.limitSwitch', kind: 'limitSwitch', name: '리밋 스위치', category: 'sensor', namePrefix: 'LMS',
    properties: [{ key: 'actuationTravel', label: '동작 행정', unit: 'mm', defaultValue: 2, requiredForRun: false }],
    ports: [{ key: 'contact', label: '끝단 접점 ON', direction: 'out', role: 'sensor' }], actions: [], photo: 'limit.jpg', match: 'class-reference', scope: '' },
  { id: 'asset.unitInput', kind: 'unitInput', name: '투입 유닛 템플릿', category: 'unit', namePrefix: 'UIN', properties: [], ports: [], actions: [],
    template: { size: { w: 216, h: 300 }, children: [
      { localId: 'PES1', assetId: 'asset.photoelectricSensor', label: '투입 자재 감지', dx: 150, dy: 40 },
      { localId: 'PSH1', assetId: 'asset.pusher', label: '투입 푸셔', dx: 20, dy: 110 },
      { localId: 'CYL1', assetId: 'asset.cylinder', label: '고정 실린더', dx: 130, dy: 190 },
    ], links: [{ from: { child: 'PES1', port: 'detect' }, to: { child: 'PSH1', port: 'cmdPush' } }],
    rules: [{ child: 'PSH1', action: 'push', pre: [{ child: 'PES1', port: 'detect', equals: true }] }, { child: 'CYL1', action: 'extend', pre: [{ child: 'PSH1', port: 'pushDone', equals: true }] }] },
    photo: 'belt.jpg', match: 'assembly-reference', scope: '' },
  { id: 'asset.unitIdentify', kind: 'unitIdentify', name: '식별 유닛 템플릿', category: 'unit', namePrefix: 'UID', properties: [], ports: [], actions: [],
    template: { size: { w: 216, h: 300 }, children: [
      { localId: 'STP1', assetId: 'asset.stopper', label: '식별 위치 스토퍼', dx: 30, dy: 200 },
      { localId: 'PRX1', assetId: 'asset.proximitySensor', label: '도착 근접 감지', dx: 150, dy: 200 },
      { localId: 'BCR1', assetId: 'asset.barcodeReader', label: '식별 바코드리더', dx: 80, dy: 60 },
    ], links: [{ from: { child: 'PRX1', port: 'detect' }, to: { child: 'BCR1', port: 'trigger' } }],
    rules: [{ child: 'BCR1', action: 'read', pre: [{ child: 'STP1', port: 'upDone', equals: true }, { child: 'PRX1', port: 'detect', equals: true }] }] },
    photo: 'ident.jpg', match: 'assembly-reference', scope: '' },
  { id: 'asset.unitTransfer', kind: 'unitTransfer', name: '이송 유닛 템플릿', category: 'unit', namePrefix: 'UTR', properties: [], ports: [], actions: [],
    template: { size: { w: 216, h: 300 }, children: [
      { localId: 'GAN1', assetId: 'asset.gantry', label: '이송 갠트리', dx: 30, dy: 40 },
      { localId: 'PCK1', assetId: 'asset.picker', label: '이송 피커', dx: 84, dy: 130 },
      { localId: 'LMS1', assetId: 'asset.limitSwitch', label: '원점 리밋', dx: 20, dy: 230 },
    ], links: [{ from: { child: 'GAN1', port: 'inPos' }, to: { child: 'PCK1', port: 'cmdPick' } }],
    rules: [{ child: 'PCK1', action: 'pick', pre: [{ child: 'GAN1', port: 'inPos', equals: true }] }, { child: 'GAN1', action: 'move', pre: [{ child: 'LMS1', port: 'contact', equals: true }] }] },
    photo: 'paro.jpg', match: 'assembly-reference', scope: '' },
];

export interface PhotoScopeSeed { kind: string; match: string }
export const SEED_PHOTO_SCOPE: PhotoScopeSeed[] = seeds.map((s) => ({ kind: s.kind, match: s.match }));

export function seedDefinitions(scopeNotes: Record<string, string>): AssetDefinition[] {
  return seeds.map(({ photo, match, scope: _s, template, ...s }) => ({
    ...s, version: V, roleClassPath: role(s.category), template: template ?? null,
    amlSource: { file: 'aml/ecd-sample-library.aml', sucPath: `ECD_SampleAssetLib/${s.kind}`, origin: 'bundled' as const },
    visualRefs: { schematic: `../visuals/schematic/${s.kind}.svg`, photo: `../visuals/photos/${photo}`,
      photoScope: { matchType: match as any, exactModelMatch: false, note: scopeNotes[s.kind] ?? '' } },
  }));
}
