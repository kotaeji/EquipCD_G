// TURN-057. Saving a Unit template does not touch the project. Placing it mints new ids.
import { describe, expect, it } from 'vitest';
import { addMaterial, addStep, updateMaterial } from '../src/model/commands';
import { applyEdit, initHistory, undo } from '../src/model/history';
import { buildSampleProject } from '../src/model/sample';
import { emptyProject } from '../src/model/factory';
import {
  captureUnitTemplate,
  exportTemplateText,
  parseTemplateFile,
  placeUserTemplate,
  TEMPLATE_FORMAT,
  TEMPLATE_FORMAT_VERSION,
  templateOriginText,
} from '../src/model/userTemplates';
import { rectsOverlap } from '../src/model/unitLayout';
import { createRuntime, runToEnd } from '../src/runtime/engine';
import { MemoryKV } from '../src/storage/localStore';
import { parseProjectFile, serializeProject } from '../src/storage/fileFormat';
import { FILE_FORMAT_VERSION } from '../src/model/types';
import { deleteTemplate, readTemplates, renameTemplate, saveTemplate, TEMPLATES_INDEX_KEY, templateBodyKey } from '../src/storage/userTemplates';

const idsOf = (p: { units: { id: string }[]; devices: { id: string }[]; signals: { id: string }[]; actions: { id: string }[]; connections: { id: string }[] }) =>
  new Set([...p.units, ...p.devices, ...p.signals, ...p.actions, ...p.connections].map((x) => x.id));

describe('TURN-057 my templates', () => {
  it('AC1 AC2 saving keeps rev and undo, and leaves outside links out', () => {
    const project = buildSampleProject();
    const before = serializeProject(project);
    const rev = project.revision;
    const captured = captureUnitTemplate(project, 'U-S2');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    expect(captured.captured.notice).toBe('빠짐: 시퀀스 단계 3, 바깥 연결 2, 자재 경로 1');
    expect(captured.captured.devices.map((d) => d.id).sort()).toEqual(['BCR-02', 'STP-02']);
    expect(captured.captured.signals.length).toBeGreaterThan(0);
    expect(captured.captured.actions.length).toBe(3);
    expect(captured.captured.connections.map((c) => c.id)).toEqual(['SIGC-1']);
    expect(captured.captured.unit.capacity.maxWeight.value).toBe(5);
    expect(captured.captured.unit.layout.w).toBe(project.units.find((u) => u.id === 'U-S2')!.layout.w);
    const kv = new MemoryKV();
    const saved = saveTemplate(kv, captured.captured, '식별 틀', { now: new Date('2026-11-23T00:00:00.000Z') });
    expect(saved.ok).toBe(true);
    expect(project.revision).toBe(rev);
    expect(serializeProject(project)).toBe(before);
    expect(readTemplates(kv).templates).toHaveLength(1);
    expect(readTemplates(kv).templates[0].name).toBe('식별 틀');
    expect(kv.getItem('ecd.v1.project.prj-sample-5step')).toBeNull();
  });

  it('AC4 AC5 AC8 a place mints ids, refuses a missing asset, and is one undo', () => {
    const project = buildSampleProject();
    const captured = captureUnitTemplate(project, 'U-S2');
    if (!captured.ok) throw new Error('capture');
    const kv = new MemoryKV();
    const saved = saveTemplate(kv, captured.captured, project.units.find((u) => u.id === 'U-S2')!.name);
    if (!saved.ok) throw new Error(saved.reason);
    const blank = emptyProject('빈');
    const first = placeUserTemplate(blank, saved.template, { x: 40, y: 80 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const history = applyEdit(initHistory(blank), first, '내 템플릿 놓기', false);
    expect(history.history.past).toHaveLength(1);
    expect(history.history.present.revision).toBe(blank.revision + 1);
    const undone = undo(history.history, false);
    expect(undone.history.present.units).toHaveLength(0);
    const locked = applyEdit(history.history, placeUserTemplate(history.history.present, saved.template, { x: 40, y: 80 }), '내 템플릿 놓기', true);
    expect(locked.error).toContain('차단');
    expect(locked.history).toBe(history.history);

    const placed = history.history.present;
    const old = idsOf({
      units: [saved.template.unit], devices: saved.template.devices, signals: saved.template.signals,
      actions: saved.template.actions, connections: saved.template.connections,
    });
    const fresh = idsOf(placed);
    for (const id of fresh) expect(old.has(id)).toBe(false);
    const unit = placed.units[0];
    expect(unit.lineage?.fromTemplate).toEqual({ id: saved.template.id, name: saved.template.name });
    expect(templateOriginText(saved.template.name)).toBe(`내 템플릿 〈${saved.template.name}〉에서`);
    expect(unit.templateRef).toBeUndefined();
    for (const action of placed.actions) {
      for (const cond of [...action.pre, ...action.post]) {
        if (cond.kind === 'signal') expect(placed.signals.some((s) => s.id === cond.signalId)).toBe(true);
        if (cond.kind === 'materialAt') expect(cond.unitId).toBe(unit.id);
      }
    }
    for (const link of placed.connections) {
      expect(placed.devices.some((d) => d.id === link.from.nodeId)).toBe(true);
      expect(placed.signals.some((s) => s.id === link.from.signalId)).toBe(true);
    }
    const second = placeUserTemplate(placed, saved.template, { x: 40, y: 80 });
    if (!second.ok) throw new Error(second.reason);
    expect(second.project.units).toHaveLength(2);
    expect(new Set(second.project.units.map((u) => u.id)).size).toBe(2);
    expect(second.project.units.map((u) => u.name).sort()).toEqual([saved.template.unit.name, `${saved.template.unit.name} 2`].sort());
    expect(rectsOverlap(second.project.units[0].layout, second.project.units[1].layout)).toBe(false);
    const names = second.project.devices.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);

    const broken = structuredClone(saved.template);
    broken.devices[0].definitionRef = { assetId: 'asset.missing', version: '0' };
    const refused = placeUserTemplate(blank, broken, { x: 10, y: 10 });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain('asset.missing');
    expect(blank.units).toHaveLength(0);
  });

  it('AC6 AC7 AC9 a template is shared storage, and a file round-trips', () => {
    const captured = captureUnitTemplate(buildSampleProject(), 'U-S1');
    if (!captured.ok) throw new Error('capture');
    const kv = new MemoryKV();
    const saved = saveTemplate(kv, captured.captured, '투입 틀');
    if (!saved.ok) throw new Error(saved.reason);
    const other = emptyProject('다른 프로젝트');
    const placed = placeUserTemplate(other, saved.template, { x: 30, y: 70 });
    if (!placed.ok) throw new Error(placed.reason);
    const snapshot = serializeProject(placed.project);
    const renamed = renameTemplate(kv, saved.template.id, '투입 틀 2');
    expect(renamed.ok).toBe(true);
    expect(deleteTemplate(kv, saved.template.id).ok).toBe(true);
    expect(readTemplates(kv).templates).toHaveLength(0);
    expect(serializeProject(placed.project)).toBe(snapshot);

    const again = saveTemplate(kv, captured.captured, '투입 틀');
    if (!again.ok) throw new Error(again.reason);
    const text = exportTemplateText(again.template);
    const back = parseTemplateFile(text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.template).toEqual(again.template);
    expect(back.template.format).toBe(TEMPLATE_FORMAT);
    expect(back.template.formatVersion).toBe(TEMPLATE_FORMAT_VERSION);
    const empty = new MemoryKV();
    const imported = saveTemplate(empty, {
      ...captured.captured,
      notice: '',
    }, back.template.name, { id: back.template.id, now: new Date(back.template.savedAt) });
    if (!imported.ok) throw new Error(imported.reason);
    expect(imported.template.unit).toEqual(again.template.unit);
    expect(imported.template.devices).toEqual(again.template.devices);
    expect(imported.template.connections).toEqual(again.template.connections);
    expect(parseTemplateFile('{').ok).toBe(false);
    expect(parseTemplateFile(JSON.stringify({ format: 'nope' })).ok).toBe(false);
    expect(parseTemplateFile(JSON.stringify({ format: TEMPLATE_FORMAT, formatVersion: '9.9.9' })).ok).toBe(false);
    expect(readTemplates(empty).templates).toHaveLength(1);
  });

  it('AC10 a broken stored item is skipped', () => {
    const captured = captureUnitTemplate(buildSampleProject(), 'U-S1');
    if (!captured.ok) throw new Error('capture');
    const kv = new MemoryKV();
    const saved = saveTemplate(kv, captured.captured, '살아 있는 틀');
    if (!saved.ok) throw new Error(saved.reason);
    const index = JSON.parse(kv.getItem(TEMPLATES_INDEX_KEY)!) as { ids: string[] };
    index.ids.push('bad');
    kv.setItem(TEMPLATES_INDEX_KEY, JSON.stringify(index));
    kv.setItem(templateBodyKey('bad'), '{');
    const list = readTemplates(kv);
    expect(list.templates.map((t) => t.name)).toEqual(['살아 있는 틀']);
    expect(list.skipped).toBe(1);
    kv.setItem(TEMPLATES_INDEX_KEY, '{');
    const scanned = readTemplates(kv);
    expect(scanned.templates.map((t) => t.name)).toEqual(['살아 있는 틀']);
    expect(scanned.skipped).toBeGreaterThan(0);
  });

  it('AC11 a placed S1 runs to completion in a new project', () => {
    const captured = captureUnitTemplate(buildSampleProject(), 'U-S1');
    if (!captured.ok) throw new Error('capture');
    const kv = new MemoryKV();
    const saved = saveTemplate(kv, captured.captured, 'S1 투입');
    if (!saved.ok) throw new Error(saved.reason);
    const placed = placeUserTemplate(emptyProject('실행'), saved.template, { x: 40, y: 70 });
    if (!placed.ok) throw new Error(placed.reason);
    const withMat = addMaterial(placed.project);
    if (!withMat.ok) throw new Error(withMat.reason);
    const material = withMat.project.materials[0];
    const ready = updateMaterial(withMat.project, material.id, { states: ['대기', '투입됨'], initialState: '대기', initialLocation: withMat.project.units[0].id });
    if (!ready.ok) throw new Error(ready.reason);
    const pusher = ready.project.actions.find((a) => a.name.includes('푸셔'));
    expect(pusher).toBeTruthy();
    const stepped = addStep(ready.project, pusher!.id);
    if (!stepped.ok) throw new Error(stepped.reason);
    const ran = runToEnd(createRuntime(stepped.project));
    expect(ran.state.status, ran.state.log.map((l) => l.message).join('\n')).toBe('completed');
    const file = serializeProject(stepped.project);
    expect(file).toContain(FILE_FORMAT_VERSION);
    const opened = parseProjectFile(file);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.project.units[0].lineage?.fromTemplate?.name).toBe('S1 투입');
  });
});
