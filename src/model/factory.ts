import { getAsset } from '../assets/library';
import type { Action, AssetKind, Device, Layout, Position, Project, Quantity, Signal, Unit } from './types';
import { q } from './types';

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  const rnd = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}${rnd}`;
}

export interface DeviceBundle { device: Device; signals: Signal[]; positions: Position[]; actions: Action[] }

const DEFAULT_SIZE: Record<string, [number, number]> = {
  cylinder: [56, 80], pusher: [80, 48], barcodeReader: [56, 44], conveyor: [150, 36],
  stopper: [40, 44], gantry: [150, 70], picker: [48, 60], sensor: [36, 32],
  photoelectricSensor: [40, 30], proximitySensor: [40, 28], limitSwitch: [36, 32],
};
export const sizeOf = (kind: AssetKind): [number, number] => DEFAULT_SIZE[kind] ?? [56, 44];

/** Instantiate an asset definition into a Device (+ conceptual signals, default actions). Pure apart from id generation. */
export function instantiateDevice(
  kind: AssetKind, unitId: string, at: { x: number; y: number }, name?: string,
  idOf: (p: string) => string = newId, templateChild?: string,
): DeviceBundle {
  const def = getAsset(kind);
  if (def.template) throw new Error(`${kind} is a unit template — use addUnitFromTemplate`);
  const deviceId = idOf('dev');
  const [w, h] = sizeOf(kind);
  const properties: Record<string, Quantity> = {};
  for (const p of def.properties) properties[p.key] = q(p.defaultValue, p.unit, true, { method: 'asset-default', note: `${def.id}@${def.version}` });
  const signals: Signal[] = def.ports.filter((port) => port.role !== 'flow').map((port) => ({
    id: idOf('sig'), name: `${name ?? def.name}.${port.label}`, deviceId, portKey: port.key,
    direction: port.direction, valueType: 'bool', role: port.role as Signal['role'], address: null, addressStatus: 'unassigned',
  }));
  const sigByPort = (k: string | null) => (k ? signals.find((s) => s.portKey === k)?.id ?? null : null);
  const actions: Action[] = def.actions.map((t) => ({
    id: idOf('act'), name: `${name ?? def.name} ${t.label}`, unitId, deviceId, kind: t.kind, params: {},
    duration: q(t.durationS, 's', true, { method: 'asset-default' }),
    timeout: q(t.timeoutS, 's', true, { method: 'asset-default' }),
    commandSignalId: sigByPort(t.commandPort), completeSignalId: sigByPort(t.completePort),
    targetPositionId: null, pre: [], post: [], effect: {},
  }));
  const device: Device = {
    id: deviceId, name: name ?? def.name, kind, definitionRef: { assetId: def.id, version: def.version }, unitId,
    layout: { x: at.x, y: at.y, w, h }, properties, ...(templateChild ? { templateChild } : {}),
  };
  return { device, signals, positions: [], actions };
}

export function makeUnit(name: string, code: string, layout: Layout, idOf: (p: string) => string = newId): Unit {
  return {
    id: idOf('unit'), name, code, deviceIds: [], layout,
    capacity: { maxMaterials: q(1, 'ea', true), maxWeight: q(null, 'kg', true) },
  };
}

export function emptyProject(name: string, idOf: (p: string) => string = newId): Project {
  const eqId = idOf('eq');
  return {
    id: idOf('prj'), name, revision: 0,
    equipment: { id: eqId, name: '장비', unitIds: [] },
    units: [], devices: [], signals: [], positions: [], actions: [], materials: [], connections: [], constraints: [],
    sequence: { id: idOf('seq'), name: '시퀀스', steps: [], unresolved: [] },
    candidates: [], simSettings: { faults: { neverTrueSignalIds: [], readFailActionIds: [] }, speed: 1 }, gapReview: {},
    assumptionsNote: [],
  };
}
