// Case-insensitive disks (macOS, Windows) cannot hold two tracked paths that differ only by case.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
}

describe('tracked paths', () => {
  it('no two paths differ only by letter case', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const file of trackedFiles()) {
      const key = file.toLowerCase();
      const prev = seen.get(key);
      if (prev) clashes.push(`${prev} ↔ ${file}`);
      else seen.set(key, file);
    }
    expect(clashes).toEqual([]);
  });

  it('no two modules in one folder have stems that differ only by case', () => {
    // Extensionless imports (`./Notices` and `./notices`) resolve to the same
    // file on a case-insensitive disk. A stylesheet keeps its extension.
    const moduleExt = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
    const seen = new Map<string, { file: string; stem: string }>();
    const clashes: string[] = [];
    for (const file of trackedFiles()) {
      const slash = file.lastIndexOf('/');
      const dir = slash >= 0 ? file.slice(0, slash) : '';
      const base = slash >= 0 ? file.slice(slash + 1) : file;
      const dot = base.lastIndexOf('.');
      const stem = dot > 0 ? base.slice(0, dot) : base;
      const ext = dot > 0 ? base.slice(dot).toLowerCase() : '';
      if (!moduleExt.has(ext)) continue;
      const key = `${dir}\0${stem.toLowerCase()}`;
      const prev = seen.get(key);
      if (prev && prev.stem !== stem) clashes.push(`${prev.file} ↔ ${file}`);
      else if (!prev) seen.set(key, { file, stem });
    }
    expect(clashes).toEqual([]);
  });
});
