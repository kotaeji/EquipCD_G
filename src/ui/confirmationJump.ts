// Where a confirmation-log row goes. View navigation only.
import type { ConfirmationEntry, Project } from '../model/types';
import { targetLive } from '../model/confirmationLog';
import type { ItemJump } from './wizard';

export function confirmationJump(p: Project, entry: ConfirmationEntry): ItemJump | null {
  if (!targetLive(p, entry.target)) return null;
  const t = entry.target;
  if (t.kind === 'quantity') {
    const ref = t.ref;
    if (ref.kind === 'action') {
      const deviceId = p.actions.find((a) => a.id === ref.id)?.deviceId;
      return { step: 'attributes', selectId: deviceId, rightTab: 'actions', actionId: ref.id, field: `${ref.field}:${ref.id}` };
    }
    if (ref.kind === 'device') return { step: 'attributes', selectId: ref.id, rightTab: 'props', field: `prop:${ref.id}:${ref.key}` };
    if (ref.kind === 'position') {
      const deviceId = p.positions.find((x) => x.id === ref.id)?.deviceId;
      return { step: 'attributes', selectId: deviceId, rightTab: 'positions', field: `position:${ref.id}` };
    }
    if (ref.kind === 'unitCap') return { step: 'canvas', selectId: ref.id, field: `unitcap:${ref.id}:${ref.field}` };
    if (ref.kind === 'material') {
      const field = ref.field === 'feedInterval' ? 'feed-interval' : `material:${ref.id}:${ref.field}`;
      return { step: 'sequence', sub: 'material', selectId: ref.id, field };
    }
    return { step: 'sequence', sub: 'sequence', field: `step-timeout:${ref.id}` };
  }
  if (t.kind === 'interlock') {
    const k = p.constraints.find((c) => c.id === t.id);
    const dev = k?.relatedIds.find((id) => p.devices.some((d) => d.id === id));
    return { step: 'attributes', selectId: dev, rightTab: 'check', field: `interlock:${t.id}` };
  }
  if (t.kind === 'candidate') return { step: 'library', sub: 'input', field: `candidate:${t.id}` };
  if (t.kind === 'gap') return { step: 'check', sub: 'gap', field: `gap:${t.id}`, gapFilter: 'all' };
  const deviceId = p.signals.find((s) => s.id === t.id)?.deviceId;
  return { step: 'attributes', selectId: deviceId, rightTab: 'signals', field: `signal:${t.id}` };
}
