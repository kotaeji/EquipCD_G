// F8 mapping preview (read-only). Targets name slots in the draft export file.
// Aurora Core's schema is still unknown — Core transfer stays unimplemented.
import { EXPORT_SLOTS } from './auroraExport';
import { walk } from './flow';
import type { Project } from './types';

export interface MapRow { category: string; sourceId: string; name: string; target: string; status: 'ready' | 'assumption' | 'undetermined' | 'notInTarget'; note: string }

function flowBlocks(p: Project): number {
  if (!p.sequence.flow) return 0;
  let n = 0;
  walk(p.sequence.flow, (node) => { if (node.kind !== 'step') n += 1; });
  return n;
}

export function buildExportPreview(p: Project): MapRow[] {
  const rows: MapRow[] = [];
  for (const u of p.units) rows.push({ category: 'Unit/Device 트리', sourceId: u.id, name: u.name, target: EXPORT_SLOTS.unit, status: 'undetermined', note: '초안 형식 자리. Aurora Core 스키마는 미확인' });
  for (const d of p.devices) rows.push({ category: 'Unit/Device 트리', sourceId: d.id, name: d.name, target: EXPORT_SLOTS.device, status: Object.values(d.properties).some((x) => x.assumption) ? 'assumption' : 'undetermined', note: `정의 ${d.definitionRef.assetId}@${d.definitionRef.version}${Object.values(d.properties).some((x) => x.assumption) ? ', 가정 사양 포함' : ''}` });
  for (const s of p.signals) rows.push({ category: 'Signal', sourceId: s.id, name: s.name, target: EXPORT_SLOTS.signal, status: s.address ? (s.addressStatus === 'confirmed' ? 'ready' : 'assumption') : 'undetermined', note: s.address ? `주소 ${s.address} (${s.addressStatus})` : '실제 I/O 주소 미정 — 개념 신호' });
  for (const ps of p.positions) rows.push({ category: 'Position', sourceId: ps.id, name: ps.name, target: EXPORT_SLOTS.position, status: ps.value.assumption ? 'assumption' : 'ready', note: `${ps.value.value ?? '미정'} ${ps.value.unit}${ps.value.assumption ? ' [가정]' : ''}` });
  const blocks = flowBlocks(p);
  rows.push({ category: 'SequenceDraft', sourceId: p.sequence.id, name: p.sequence.name, target: EXPORT_SLOTS.sequence, status: 'undetermined', note: blocks ? `${p.sequence.steps.length} 단계, 흐름 블록 ${blocks}` : `${p.sequence.steps.length} 단계, 순차` });
  for (const q of p.substationSequences ?? []) rows.push({ category: 'Substation 시퀀스', sourceId: q.id, name: q.name, target: EXPORT_SLOTS.substationSequence, status: 'undetermined', note: `${q.steps.length} 단계` });
  for (const k of p.constraints) rows.push({ category: 'Interlock', sourceId: k.id, name: k.description, target: k.confirmation === 'confirmed' ? EXPORT_SLOTS.interlock : EXPORT_SLOTS.excluded, status: k.confirmation === 'confirmed' ? 'ready' : 'undetermined', note: `확인 상태: ${k.confirmation}` });
  for (const m of p.materials) rows.push({ category: 'Material', sourceId: m.id, name: m.name, target: EXPORT_SLOTS.excluded, status: 'notInTarget', note: '원본 모델에 유지, Export 제외 목록에 표시' });
  return rows;
}
