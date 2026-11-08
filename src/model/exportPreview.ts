// F8 매핑 미리보기 (읽기 전용). 실제 Aurora Core 스키마/버전 미확인 → 실제 Export·역매핑은 미구현.
import type { Project } from './types';

export interface MapRow { category: string; sourceId: string; name: string; target: string; status: 'ready' | 'assumption' | 'undetermined' | 'notInTarget'; note: string }

export function buildExportPreview(p: Project): MapRow[] {
  const rows: MapRow[] = [];
  for (const u of p.units) rows.push({ category: 'Unit/Device 트리', sourceId: u.id, name: u.name, target: 'Core Configurator (계약 미확인)', status: 'undetermined', note: '대상 스키마 미확인' });
  for (const d of p.devices) rows.push({ category: 'Unit/Device 트리', sourceId: d.id, name: d.name, target: 'Core Configurator (계약 미확인)', status: Object.values(d.properties).some((x) => x.assumption) ? 'assumption' : 'undetermined', note: `정의 ${d.definitionRef.assetId}@${d.definitionRef.version}${Object.values(d.properties).some((x) => x.assumption) ? ', 가정 사양 포함' : ''}` });
  for (const s of p.signals) rows.push({ category: 'Signal', sourceId: s.id, name: s.name, target: `SignalMap ${s.direction === 'in' ? 'DO' : 'DI'}? (AX 의미 미정)`, status: s.address ? (s.addressStatus === 'confirmed' ? 'ready' : 'assumption') : 'undetermined', note: s.address ? `주소 ${s.address} (${s.addressStatus})` : '실제 I/O 주소 미정 — 개념 신호' });
  for (const ps of p.positions) rows.push({ category: 'Position', sourceId: ps.id, name: ps.name, target: '포지션 테이블 (계약 미확인)', status: ps.value.assumption ? 'assumption' : 'ready', note: `${ps.value.value ?? '미정'} ${ps.value.unit}${ps.value.assumption ? ' [가정]' : ''}` });
  rows.push({ category: 'SequenceDraft', sourceId: p.sequence.id, name: p.sequence.name, target: 'SequenceDesigner SFC (계약 미확인)', status: 'undetermined', note: `${p.sequence.steps.length} 단계, 순차만` });
  for (const k of p.constraints) rows.push({ category: 'Interlock', sourceId: k.id, name: k.description, target: 'override 가능한 기본값 (계약 미확인)', status: k.confirmation === 'confirmed' ? 'ready' : 'undetermined', note: `확인 상태: ${k.confirmation}` });
  for (const m of p.materials) rows.push({ category: 'Material', sourceId: m.id, name: m.name, target: 'Core 자리 없음 → MD 보관 (형식 미정)', status: 'notInTarget', note: '원본 모델에 유지, Export 제외 목록에 표시' });
  return rows;
}
