// Header guesses and asset-kind matching for an IO list / specification sheet.
import { ASSET_LIBRARY } from '../assets/library';

export type ColumnRole = 'unitName' | 'deviceName' | 'deviceKind' | 'signalName' | 'signalDirection' | 'address' | 'memo' | 'ignore';

export interface ColumnMapping {
  index: number;
  header: string;
  role: ColumnRole;
  /** True while the role still comes from the header guess. */
  guessed: boolean;
}

export const COLUMN_ROLES: { role: ColumnRole; label: string }[] = [
  { role: 'unitName', label: 'Unit 이름' },
  { role: 'deviceName', label: 'Device 이름' },
  { role: 'deviceKind', label: 'Device 종류' },
  { role: 'signalName', label: '신호 이름' },
  { role: 'signalDirection', label: '신호 방향' },
  { role: 'address', label: '주소' },
  { role: 'memo', label: '메모' },
  { role: 'ignore', label: '쓰지 않음' },
];

interface Rule { role: ColumnRole; exact: string[]; words: string[]; includes: string[] }

const RULES: Rule[] = [
  { role: 'signalDirection', exact: ['di', 'do', 'in', 'out', 'in/out', 'inout', 'in-out', 'direction', '방향', '입력', '출력'], words: [], includes: ['direction', '방향'] },
  { role: 'address', exact: ['address', 'addr', '주소'], words: [], includes: ['address', '주소'] },
  { role: 'memo', exact: ['memo', 'note', 'comment', '메모', '비고'], words: [], includes: ['memo', '메모', '비고'] },
  { role: 'deviceKind', exact: ['type', '종류', '타입', '형식'], words: ['type'], includes: ['종류', '타입'] },
  { role: 'signalName', exact: ['signal', '신호', 'io'], words: [], includes: ['signal', '신호'] },
  { role: 'deviceName', exact: ['tag', 'device', '장치', '디바이스', '태그', '기기'], words: [], includes: ['device', '장치', '디바이스', '태그'] },
  { role: 'unitName', exact: ['unit', 'station', '공정', '유닛', '단위'], words: [], includes: ['unit', 'station', '공정', '유닛'] },
];

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ');
}

function hasWord(header: string, word: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`, 'i').test(header);
}

function guessRole(header: string, used: Set<ColumnRole>): ColumnRole {
  const n = normalizeHeader(header);
  if (!n) return 'ignore';
  for (const rule of RULES) {
    if (used.has(rule.role)) continue;
    if (rule.exact.includes(n) || rule.words.some((w) => hasWord(n, w)) || rule.includes.some((w) => n.includes(w))) return rule.role;
  }
  return 'ignore';
}

/** One role per column. The first header that matches a role wins; a later header of the same role is unused. */
export function guessColumns(headers: string[]): ColumnMapping[] {
  const used = new Set<ColumnRole>();
  return headers.map((header, index) => {
    const role = guessRole(header, used);
    if (role !== 'ignore') used.add(role);
    return { index, header: header.trim(), role, guessed: role !== 'ignore' };
  });
}

export function roleLabel(role: ColumnRole): string {
  return COLUMN_ROLES.find((r) => r.role === role)?.label ?? role;
}

function fold(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_\-./]+/g, '');
}

/** Extra spellings for the bundled device assets. Template names are not device kinds. */
const EXTRA: Record<string, string[]> = {
  cylinder: ['cylinder', 'cyl', '실린더'],
  pusher: ['pusher', 'push', '푸셔'],
  barcodeReader: ['barcodereader', 'barcode', 'bcr', '바코드리더', '바코드'],
  conveyor: ['conveyor', 'cnv', '컨베이어'],
  stopper: ['stopper', 'stp', '스토퍼'],
  gantry: ['gantry', 'gnt', '갠트리'],
  picker: ['picker', 'pck', '피커'],
  sensor: ['sensor', 'sen', '센서'],
  photoelectricSensor: ['photoelectricsensor', 'photoelectric', '광전센서', '광전', '포토센서'],
  proximitySensor: ['proximitysensor', 'proximity', '근접센서', '근접'],
  limitSwitch: ['limitswitch', 'limit', '리밋스위치', '리밋', '리미트스위치', '리미트'],
};

/** Map a cell to a device asset kind. Unknown text is null (종류 미지정). Unit templates are not device kinds. */
export function matchDeviceKind(text: string): string | null {
  const key = fold(text);
  if (!key) return null;
  for (const def of ASSET_LIBRARY) {
    if (def.template) continue;
    const names = [def.kind, def.name, ...(EXTRA[def.kind] ?? [])];
    if (names.some((n) => fold(n) === key)) return def.kind;
  }
  return null;
}

export function parseDirection(text: string): 'in' | 'out' | null {
  const s = text.trim().toLowerCase().replace(/\s+/g, '');
  if (['입력', 'in', 'di', 'input', 'i'].includes(s)) return 'in';
  if (['출력', 'out', 'do', 'output', 'o'].includes(s)) return 'out';
  return null;
}
