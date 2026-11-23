// Case-insensitive disks (macOS, Windows) cannot hold two tracked paths that differ only by case.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('tracked paths', () => {
  it('no two paths differ only by letter case', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const file of files) {
      const key = file.toLowerCase();
      const prev = seen.get(key);
      if (prev) clashes.push(`${prev} ↔ ${file}`);
      else seen.set(key, file);
    }
    expect(clashes).toEqual([]);
  });
});
