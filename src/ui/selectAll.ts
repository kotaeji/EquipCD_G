// TURN-027. Selection only — the model, revision, and history stay put.
import type { Project } from '../model/types';

/** Shown when Ctrl/Cmd+A is pressed on a Unit that has no Device. Selection is left as it is. */
export const NO_DEVICE_IN_UNIT = '이 Unit 에는 Device 가 없습니다';

/** One line added to the step-2 selection hint and the diagram legend. */
export const SELECT_HINT = 'Ctrl + A: Unit 전체 또는 그 Unit의 Device 전체 · Ctrl + 클릭: 선택과 해제';

export type SelectAllResult = { ids: string[] } | { keep: true; message: string };

/**
 * Ctrl/Cmd+A on step 2.
 * Nothing picked → every Unit.
 * One Unit, or Devices that all belong to one Unit → that Unit's Devices (the Unit leaves the selection).
 * An empty Unit → keep the selection and say so.
 * Two or more Units, or a selection that reaches more than one Unit → every Unit.
 * A connection id is ignored. A selection of only connections is treated as empty.
 */
export function selectAll(p: Project, selection: string[]): SelectAllResult {
  const unitById = new Map(p.units.map((u) => [u.id, u]));
  const deviceById = new Map(p.devices.map((d) => [d.id, d]));
  const pickedUnits = selection.filter((id) => unitById.has(id));
  const pickedDevices = selection.flatMap((id) => {
    const d = deviceById.get(id);
    return d ? [d] : [];
  });
  if (pickedUnits.length === 0 && pickedDevices.length === 0) return { ids: p.units.map((u) => u.id) };
  const homes = new Set<string>([...pickedUnits, ...pickedDevices.map((d) => d.unitId)]);
  if (pickedUnits.length >= 2 || homes.size > 1) return { ids: p.units.map((u) => u.id) };
  const unitId = pickedUnits[0] ?? pickedDevices[0]?.unitId;
  const unit = unitId ? unitById.get(unitId) : undefined;
  if (!unit || unit.deviceIds.length === 0) return { keep: true, message: NO_DEVICE_IN_UNIT };
  return { ids: [...unit.deviceIds] };
}

/** Diagram pointer. Shift still only adds. Ctrl/Cmd toggles, and toggling off does not start a drag. */
export function pointerSelection(have: string[], id: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): { ids: string[]; drag: boolean } {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
    if (have.includes(id)) return { ids: have.filter((x) => x !== id), drag: false };
    return { ids: [...have, id], drag: true };
  }
  if (e.shiftKey) return { ids: [...new Set([...have, id])], drag: true };
  if (have.includes(id)) return { ids: have, drag: true };
  return { ids: [id], drag: true };
}

/** Card board. Shift stays a single-item click, which is what the board did before. Ctrl/Cmd toggles. */
export function cardSelection(have: string[], id: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): string[] {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey) return have.includes(id) ? have.filter((x) => x !== id) : [...have, id];
  return [id];
}
