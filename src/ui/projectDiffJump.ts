// TURN-081. Where a diff row goes. View only — the model stays as it is.
import { walk } from '../model/flow';
import type { DiffRow } from '../model/projectDiff';
import type { FlowNode, Project } from '../model/types';
import type { ItemJump } from './wizard';

function hasFlow(nodes: FlowNode[] | undefined, id: string): boolean {
  if (!nodes) return false;
  let found = false;
  walk(nodes, (n) => { if (n.kind !== 'step' && n.id === id) found = true; });
  return found;
}

/** Null when the row was deleted, or the open model has nowhere to show it. */
export function diffJump(project: Project, row: DiffRow): ItemJump | null {
  if (row.change === 'removed') return null;
  const id = row.id;
  switch (row.kind) {
    case 'unit':
      return project.units.some((u) => u.id === id) ? { step: 'canvas', selectId: id, field: `unit:${id}` } : null;
    case 'device':
      return project.devices.some((d) => d.id === id) ? { step: 'canvas', selectId: id, field: `device:${id}` } : null;
    case 'signal': {
      const signal = project.signals.find((s) => s.id === id);
      return signal ? { step: 'attributes', selectId: signal.deviceId, rightTab: 'signals', field: `signal:${id}` } : null;
    }
    case 'position': {
      const position = project.positions.find((s) => s.id === id);
      return position ? { step: 'attributes', selectId: position.deviceId, rightTab: 'positions', field: `position:${id}` } : null;
    }
    case 'action': {
      const action = project.actions.find((a) => a.id === id);
      if (!action) return null;
      const field = row.field === '동작 시간' ? `duration:${id}` : row.field === '타임아웃' ? `timeout:${id}` : `timeout:${id}`;
      return { step: 'attributes', selectId: action.deviceId, rightTab: 'actions', actionId: id, field };
    }
    case 'connection': {
      const connection = project.connections.find((c) => c.id === id);
      if (!connection) return null;
      const nodeId = connection.from.nodeId;
      const unit = project.units.some((u) => u.id === nodeId);
      return unit
        ? { step: 'canvas', selectId: nodeId, field: `unit:${nodeId}` }
        : { step: 'canvas', selectId: nodeId, field: `device:${nodeId}` };
    }
    case 'material':
      return project.materials.some((m) => m.id === id)
        ? { step: 'sequence', sub: 'material', selectId: id, field: `material:${id}` }
        : null;
    case 'sequence':
      if (project.sequence.id === id) return { step: 'sequence', sub: 'sequence', field: 'sequence-steps' };
      return (project.substationSequences ?? []).some((q) => q.id === id)
        ? { step: 'sequence', sub: 'subseq', field: 'sequence-steps' }
        : null;
    case 'step':
      if (project.sequence.steps.some((s) => s.id === id)) return { step: 'sequence', sub: 'sequence', field: `step:${id}` };
      return (project.substationSequences ?? []).some((q) => q.steps.some((s) => s.id === id))
        ? { step: 'sequence', sub: 'subseq', field: `step:${id}` }
        : null;
    case 'flow':
      if (hasFlow(project.sequence.flow, id)) return { step: 'sequence', sub: 'sequence', field: `flow:${id}` };
      return (project.substationSequences ?? []).some((q) => hasFlow(q.flow, id))
        ? { step: 'sequence', sub: 'subseq', field: `flow:${id}` }
        : null;
    case 'interlock':
    case 'constraint': {
      const rule = project.constraints.find((c) => c.id === id);
      if (!rule) return null;
      const deviceId = rule.relatedIds.find((rid) => project.devices.some((d) => d.id === rid));
      return { step: 'attributes', selectId: deviceId, rightTab: 'check', field: `interlock:${id}` };
    }
    case 'candidate':
      return project.candidates.some((c) => c.id === id)
        ? { step: 'library', sub: 'input', field: `candidate:${id}` }
        : null;
    case 'background':
      return project.diagramBackground ? { step: 'canvas', field: 'background' } : null;
    case 'lock':
      if (id === 'background') return project.diagramBackground ? { step: 'canvas', field: 'background' } : null;
      return project.units.some((u) => u.id === id) ? { step: 'canvas', selectId: id, field: `unit:${id}` } : null;
    default:
      return null;
  }
}
