// TURN-088. One reading of a wall-clock instant. File values stay ISO (UTC).
// Virtual time (`00:11.100`) does not come through here.

export interface LocalClockOptions {
  /** Logs keep seconds. Other places stop at the minute. */
  seconds?: boolean;
  /** IANA zone. Omitted means this computer's zone. */
  timeZone?: string;
}

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDate(input: Date | string | number | null | undefined): Date | null {
  if (input == null || input === '') return null;
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

function wallParts(date: Date, timeZone: string): Wall {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  }
  let year = Number(bag.year);
  let month = Number(bag.month);
  let day = Number(bag.day);
  let hour = Number(bag.hour);
  const minute = Number(bag.minute);
  const second = Number(bag.second);
  if (hour === 24) {
    hour = 0;
    const next = new Date(Date.UTC(year, month - 1, day) + 86_400_000);
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
  }
  return { year, month, day, hour, minute, second };
}

function offsetMinutes(date: Date, parts: Wall): number {
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/** `(UTC)`, `(UTC+9)`, `(UTC-5)`, `(UTC+5:30)`, `(UTC-9:30)`. */
export function utcOffsetLabel(totalMinutes: number): string {
  if (totalMinutes === 0) return '(UTC)';
  const sign = totalMinutes > 0 ? '+' : '-';
  const abs = Math.abs(totalMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  const body = minutes === 0 ? String(hours) : `${hours}:${pad(minutes)}`;
  return `(UTC${sign}${body})`;
}

function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/**
 * `2026-11-27 22:46 (UTC+9)`. With `seconds`, `2026-11-27 22:46:32 (UTC+9)`.
 * Empty when the instant cannot be read.
 */
export function formatLocalClock(input: Date | string | number | null | undefined, options: LocalClockOptions = {}): string {
  const date = toDate(input);
  if (!date) return '';
  const timeZone = options.timeZone ?? systemTimeZone();
  let parts: Wall;
  try {
    parts = wallParts(date, timeZone);
  } catch {
    return '';
  }
  const dateText = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  const clock = options.seconds
    ? `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`
    : `${pad(parts.hour)}:${pad(parts.minute)}`;
  return `${dateText} ${clock} ${utcOffsetLabel(offsetMinutes(date, parts))}`;
}

/** Stored instant for a tooltip. A string is kept as written. */
export function clockIso(input: Date | string | number | null | undefined): string {
  if (typeof input === 'string') return input;
  const date = toDate(input);
  return date ? date.toISOString() : '';
}

/**
 * Header of a CSV column whose cells stay ISO (UTC).
 * Virtual-time columns (`00:11.100`) are not passed here.
 */
export function utcCsvHeader(label: string): string {
  const name = label.trim();
  if (!name || name.includes('(UTC)')) return name;
  return `${name} (UTC)`;
}
