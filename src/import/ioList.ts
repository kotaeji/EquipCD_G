// One CSV row per signal. Headers are names guessColumns already recognizes, so the file round-trips into candidates.
import { findAsset } from '../assets/library';
import type { Project, Signal } from '../model/types';

export const IO_LIST_HEADERS = ['Unit', '코드', 'Device', 'Type', 'Signal', 'Direction', '역할', 'Address', '주소 상태', 'Memo'] as const;

const ROLE_WORD: Record<Signal['role'], string> = {
  command: '명령',
  complete: '완료',
  sensor: '센서',
  result: '결과',
};

const STATUS_WORD: Record<Signal['addressStatus'], string> = {
  unassigned: '미지정',
  assumed: '가정',
  confirmed: '확인',
};

/** Leading tag such as CYL-01. A name without that shape keeps its first word. */
function deviceCode(name: string): string {
  const matched = name.match(/[A-Za-z]{2,}-\d+/);
  if (matched) return matched[0];
  const token = name.trim().split(/\s+/)[0];
  return token || name;
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Signals in model order. A missing device leaves the device cells empty. Memo has no signal field, so that cell stays blank. */
export function ioListRows(p: Project): string[][] {
  return p.signals.map((signal) => {
    const device = p.devices.find((d) => d.id === signal.deviceId);
    const unit = device ? p.units.find((u) => u.id === device.unitId) : undefined;
    const asset = device ? findAsset(device.kind) : undefined;
    return [
      unit?.name ?? '',
      device ? deviceCode(device.name) : '',
      device?.name ?? '',
      asset?.name ?? device?.kind ?? '',
      signal.name,
      signal.direction === 'out' ? '출력' : '입력',
      ROLE_WORD[signal.role],
      signal.address ?? '',
      STATUS_WORD[signal.addressStatus],
      '',
    ];
  });
}

/** UTF-8 BOM, comma, quotes. Does not read or write the project. */
export function renderIoListCsv(p: Project): string {
  const lines = [
    IO_LIST_HEADERS.join(','),
    ...ioListRows(p).map((row) => row.map(csvCell).join(',')),
  ];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function ioListFileName(projectName: string): string {
  const base = projectName.replace(/[^\w가-힣-]+/g, '_').replace(/^_+|_+$/g, '') || '프로젝트';
  return `${base}_IO리스트.csv`;
}
