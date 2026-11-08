import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSET_LIBRARY } from '../src/assets/library';
import { GENERATED_KINDS, GENERATED_META, resolveGenerated, resolvePhoto } from '../src/assets/visuals';
import { buildSampleProject } from '../src/model/sample';
import { serializeProject } from '../src/storage/fileFormat';

describe('v0.3 AI-generated visuals (N04)', () => {
  it('all 14 bundled asset kinds have an AI image with label + generation metadata; file hashes match the manifest', () => {
    const kinds = ASSET_LIBRARY.filter((d) => d.amlSource.origin === 'bundled').map((d) => d.kind).sort();
    expect(kinds).toHaveLength(14);
    expect([...GENERATED_KINDS].sort()).toEqual(kinds);
    expect(GENERATED_META.label).toContain('실제 촬영 사진 아님');
    for (const k of ['tool', 'generatedAt', 'referenceComposition', 'commonBrief', 'toggleRule', 'reviewStatus', 'usageTerms']) expect((GENERATED_META as any)[k]).toBeTruthy();
    for (const k of kinds) {
      const g = resolveGenerated(k);
      expect(g.status).toBe('available');
      if (g.status !== 'available') continue;
      expect(g.url.startsWith('data:image/jpeg')).toBe(true); // inlined → offline single HTML
      expect(g.info.brief && g.info.orientation && g.info.referenceImage).toBeTruthy();
      expect(g.info.scope).toBe('class-reference');
      const buf = readFileSync(`assets/visuals/generated/${g.info.file}`);
      expect(createHash('sha256').update(buf).digest('hex')).toBe(g.info.sha256);
      expect(buf.length).toBe(g.info.bytes);
    }
  });
  it('unknown kind → missing (schematic fallback), never another image', () => {
    expect(resolveGenerated('ghostKind').status).toBe('missing');
  });
  it('previous photo references remain resolvable as history; AI layer is not in AML or project files', () => {
    expect(ASSET_LIBRARY.some((d) => resolvePhoto(d).status === 'available')).toBe(true);
    const json = serializeProject(buildSampleProject());
    expect(json).not.toContain('generated/');
    const aml = readFileSync('assets/aml/ecd-sample-library.aml', 'utf8');
    expect(aml).not.toContain('generated/');
  });
});
