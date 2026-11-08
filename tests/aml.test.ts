import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { defSignature, parseAmlLibrary, serializeAmlLibrary } from '../src/assets/aml';
import { ASSET_LIBRARY, BUNDLED_AML_TEXT, getAssetById, registerImported, resetImported } from '../src/assets/library';
import { MATCH_LABEL, resolvePhoto } from '../src/assets/visuals';
import * as C from '../src/model/commands';
import { emptyProject } from '../src/model/factory';
import { buildSampleProject } from '../src/model/sample';
import { validateProject } from '../src/model/validate';
import { evaluateSteps, stepBadge } from '../src/ui/wizard';
import { loadView } from '../src/ui/viewSettings';
import { MemoryKV, VIEW_KEY } from '../src/storage/localStore';

const okp = (r: C.CmdResult) => { if (!r.ok) throw new Error(r.reason); return r.project; };
const opts = { fileName: 'rt.aml', lastWritingDateTime: '2026-11-08T00:00:00Z', originVersion: 'test' };
afterEach(() => resetImported());

describe('AML (CAEX 3.0 subset) read / write (C02-04~10)', () => {
  it('bundled library parses without errors: CAEX 3.0, AutomationML 2.10, 14 definitions', () => {
    const r = parseAmlLibrary(BUNDLED_AML_TEXT, 'aml/ecd-sample-library.aml', 'bundled');
    expect(r.diags.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.meta.schemaVersion).toBe('3.0');
    expect(r.meta.superiorStandard).toContain('AutomationML 2.10');
    expect(r.defs.length).toBe(14);
    const pusher = r.defs.find((d) => d.kind === 'pusher')!;
    expect(pusher.ports.map((p) => `${p.key}:${p.direction}:${p.role}`)).toEqual(['cmdPush:in:command', 'pushDone:out:complete']);
    expect(pusher.actions[0]).toMatchObject({ commandPort: 'cmdPush', completePort: 'pushDone', durationS: 0.8, timeoutS: 3 });
    expect(pusher.properties.find((p) => p.key === 'stroke')).toMatchObject({ unit: 'mm', defaultValue: 150, requiredForRun: true });
  });
  it('round trip: parse → serialize → parse gives identical definitions, and serialization is a fixpoint', () => {
    const a = parseAmlLibrary(BUNDLED_AML_TEXT, 'x', 'bundled');
    const t1 = serializeAmlLibrary(a.defs, opts);
    const b = parseAmlLibrary(t1, 'x', 'bundled');
    expect(b.ok).toBe(true);
    expect(b.defs.map(defSignature)).toEqual(a.defs.map(defSignature));
    expect(serializeAmlLibrary(b.defs, opts)).toBe(t1);
  });
  it('official CAEX 3.0 XSD validation (lxml, outside browser): bundled + extra sample valid, 2.15 rejected', () => {
    // XSD missing (it is not redistributed) → script must say "not run", exit 2, and leave xsd-report.json untouched
    // Python 3 + lxml is optional (e.g. Windows without Python, or the Microsoft Store "python3" stub) → skip, never fail
    const probe = spawnSync('python3', ['-c', 'import lxml'], { encoding: 'utf8' });
    if (probe.error || probe.status !== 0) { console.warn('python3/lxml unavailable — XSD test skipped'); return; }
    const before = readFileSync('assets/aml/xsd-report.json', 'utf8');
    const miss = spawnSync('python3', ['scripts/validate-aml.py'], { encoding: 'utf8', env: { ...process.env, CAEX_XSD: '/nonexistent/CAEX_ClassModel_V.3.0.xsd' } });
    if (!miss.error && !/No module named/.test(miss.stderr)) {
      expect(miss.status).toBe(2);
      expect(miss.stdout).toBe('');
      expect(miss.stderr).toContain('NOT RUN');
      expect(readFileSync('assets/aml/xsd-report.json', 'utf8')).toBe(before);
    }
    const py = spawnSync('python3', ['scripts/validate-aml.py'], { encoding: 'utf8' });
    if (py.error || /No module named/.test(py.stderr)) { console.warn('python3/lxml unavailable — XSD test skipped'); return; }
    if (py.status === 2) { console.warn('CAEX XSD not present locally (not redistributed) — XSD test skipped'); return; }
    const rep = JSON.parse(py.stdout);
    const by = (s: string) => rep.results.find((r: any) => r.file.includes(s));
    expect(by('ecd-sample-library').xsdValid).toBe(true);
    expect(by('extra-asset').xsdValid).toBe(true);
    expect(by('unsupported-schema-2.15').xsdValid).toBe(false);
    expect(by('invalid-syntax').wellFormed).toBe(false);
    // XSD-valid but semantically broken → only the app subset check catches it (XSD ≠ semantic conformance)
    expect(by('missing-child-ref').xsdValid).toBe(true);
    expect(parseAmlLibrary(readFileSync('samples/aml/missing-child-ref.aml', 'utf8')).diags.some((d) => d.code === 'CHILD_REF_MISSING')).toBe(true);
  });
  it('rejects broken / unsupported input with located diagnostics and never throws', () => {
    expect(parseAmlLibrary('<CAEXFile').diags[0].code).toBe('XML_SYNTAX');
    expect(parseAmlLibrary('<root/>').diags[0].code).toBe('NOT_CAEX');
    expect(parseAmlLibrary(BUNDLED_AML_TEXT.replace('SchemaVersion="3.0"', 'SchemaVersion="2.15"')).diags.some((d) => d.code === 'SCHEMA_VERSION')).toBe(true);
    const noUnit = parseAmlLibrary(BUNDLED_AML_TEXT.replace(/Unit="mm">(\s*)<Description>스트로크</, '>$1<Description>스트로크<'));
    expect(noUnit.diags.find((d) => d.code === 'ATTR_NO_UNIT')!.where).toContain('cylinder');
    expect(noUnit.defs.some((d) => d.kind === 'cylinder')).toBe(false); // broken definition is not offered as usable
    expect(noUnit.defs.some((d) => d.kind === 'unitInput')).toBe(false); // template using the broken child is rejected too
    expect(noUnit.defs.some((d) => d.kind === 'pusher')).toBe(true);   // other definitions stay usable
    const badLink = parseAmlLibrary(BUNDLED_AML_TEXT.replace('RefPartnerSideA="asset.unitInput.PES1.detect" RefPartnerSideB="asset.unitInput.PSH1.cmdPush"', 'RefPartnerSideA="asset.unitInput.PSH1.cmdPush" RefPartnerSideB="asset.unitInput.PES1.detect"'));
    expect(badLink.diags.some((d) => d.code === 'LINK_DIRECTION')).toBe(true);
    expect(badLink.defs.some((d) => d.kind === 'unitInput')).toBe(false);
  });
  it('importing an external AML adds only valid new definitions; duplicates and failures leave the library unchanged', () => {
    const before = ASSET_LIBRARY.length;
    const bad = registerImported(readFileSync('samples/aml/invalid-syntax.aml', 'utf8'), 'bad.aml');
    expect(bad.added).toEqual([]); expect(ASSET_LIBRARY.length).toBe(before);
    const dup = registerImported(BUNDLED_AML_TEXT, 'copy.aml');
    expect(dup.added).toEqual([]); expect(dup.skipped.length).toBe(14);
    const ex = registerImported(readFileSync('samples/aml/extra-asset-vacuumGripper.aml', 'utf8'), 'imported/extra.aml');
    expect(ex.added.map((d) => d.kind)).toEqual(['vacuumGripper']);
    let p = buildSampleProject();
    p = okp(C.addDevice(p, 'vacuumGripper', { x: p.units[0].layout.x + 20, y: p.units[0].layout.y + 200 }));
    const dev = p.devices.find((d) => d.kind === 'vacuumGripper')!;
    expect(dev.definitionRef).toEqual({ assetId: 'asset.extra.vacuumGripper', version: '0.1.0' });
    expect(p.actions.find((a) => a.deviceId === dev.id)!.completeSignalId).not.toBeNull();
    expect(resolvePhoto(getAssetById('asset.extra.vacuumGripper')!).status).toBe('missing');
  });
});

describe('unit templates (C02-09, C02-AC7)', () => {
  it('two placements create independent units with fresh IDs, re-wired internal links and rule preconditions', () => {
    let p = emptyProject('t');
    p = okp(C.addUnitFromTemplate(p, 'unitInput', { x: 40, y: 40 }));
    p = okp(C.addUnitFromTemplate(p, 'unitInput', { x: 300, y: 40 }));
    expect(p.units.length).toBe(2); expect(p.devices.length).toBe(6);
    expect(new Set(p.devices.map((d) => d.id)).size).toBe(6);
    expect(p.units.every((u) => u.templateRef?.assetId === 'asset.unitInput')).toBe(true);
    for (const u of p.units) {
      const ids = new Set(u.deviceIds);
      const links = p.connections.filter((c) => c.kind === 'signal' && ids.has(c.from.nodeId));
      expect(links.length).toBe(1);
      expect(ids.has(links[0].to.nodeId)).toBe(true); // link stays inside its own instance
      const push = p.actions.find((a) => ids.has(a.deviceId) && a.kind === 'extend' && p.devices.find((d) => d.id === a.deviceId)!.templateChild === 'PSH1')!;
      const sensor = p.signals.find((s) => s.id === (push.pre[0] as any).signalId)!;
      expect(ids.has(sensor.deviceId)).toBe(true);
    }
    expect(validateProject(p).filter((d) => d.severity === 'error')).toEqual([]);
    const d0 = p.devices.find((d) => d.unitId === p.units[0].id && d.templateChild === 'PSH1')!;
    const d1 = p.devices.find((d) => d.unitId === p.units[1].id && d.templateChild === 'PSH1')!;
    p = okp(C.setDeviceProperty(p, d0.id, 'stroke', 999, false));
    expect(p.devices.find((d) => d.id === d1.id)!.properties.stroke.value).toBe(150);
    expect(getAssetById('asset.pusher')!.properties.find((x) => x.key === 'stroke')!.defaultValue).toBe(150);
  });
  it('rejects a template whose child definition is missing, without partial instances', () => {
    const p = emptyProject('t');
    const r = C.addUnitFromTemplate(p, 'cylinder', { x: 0, y: 0 });
    expect(r.ok).toBe(false);
    expect(p.units.length).toBe(0);
  });
});

describe('photos / schematic visual refs (C03-04~09)', () => {
  it('every bundled definition has a real-photo reference with attribution and representative scope; no exact-model claim', () => {
    for (const d of ASSET_LIBRARY) {
      const r = resolvePhoto(d);
      expect(r.status).toBe('available');
      if (r.status !== 'available') continue;
      expect(r.url.startsWith('data:image/jpeg;base64,')).toBe(true);
      expect(r.info.license).toMatch(/^CC/);
      expect(r.info.author.length).toBeGreaterThan(0);
      expect(r.info.captureType).toBe('actual-photo');
      expect(r.scope!.exactModelMatch).toBe(false);
      expect(d.visualRefs.schematic).toMatch(/schematic\/.+\.svg$/);
    }
    expect(resolvePhoto(getAssetById('asset.pusher')!)).toMatchObject({ scope: { matchType: 'component-reference' } });
    expect(resolvePhoto(getAssetById('asset.unitTransfer')!)).toMatchObject({ scope: { matchType: 'assembly-reference' } });
    expect(MATCH_LABEL['component-reference']).toContain('조립체 아님');
  });
});

describe('wizard step evaluation (C10)', () => {
  it('readiness comes from data, a changed dependency marks a confirmed step "재확인 필요", view data is not involved', () => {
    const e0 = evaluateSteps(emptyProject('e'), { gaps: [], rt: null, saved: true, photoMissingKinds: [] });
    expect(e0.library.ready).toBe(false);
    const p = buildSampleProject();
    const e1 = evaluateSteps(p, { gaps: [], rt: null, saved: true, photoMissingKinds: [] });
    expect(e1.library.ready).toBe(true);
    expect(e1.attributes.ready).toBe(true);
    const fp = e1.attributes.fingerprint;
    const used = p.actions.find((a) => p.sequence.steps.some((s) => s.actionId === a.id))!;
    const p2 = okp(C.updateAction(p, used.id, { completeSignalId: null }));
    const e2 = evaluateSteps(p2, { gaps: [], rt: null, saved: true, photoMissingKinds: [] });
    expect(e2.attributes.ready).toBe(false);
    expect(stepBadge(e2.attributes, fp)).toBe('recheck');
    // same model → same fingerprint (photo/theme toggles are not inputs of evaluateSteps)
    expect(evaluateSteps(p, { gaps: [], rt: null, saved: true, photoMissingKinds: ['cylinder'] }).attributes.fingerprint).toBe(fp);
    expect(e0.library.items.every((i) => i.level !== 'missing' || !i.text.includes('사진'))).toBe(true);
  });
  it('broken UserView step falls back to the first step without touching the model', () => {
    const kv = new MemoryKV(); kv.setItem(VIEW_KEY, JSON.stringify({ step: 'nonsense', visualMode: 'photo' }));
    const v = loadView(kv);
    expect(v.step).toBe('library'); expect(v.visualMode).toBe('photo');
  });
});
