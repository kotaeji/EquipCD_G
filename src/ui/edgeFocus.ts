// TURN-048: which lines stay bright when a device, unit, or line is picked.
// View only — callers must not write this into the project or the undo stack.

export type EdgeTone = 'plain' | 'hot' | 'dim';

export interface FocusGraph {
  selection: readonly string[];
  units: readonly { id: string }[];
  devices: readonly { id: string; unitId: string }[];
  connections: readonly { id: string; kind: 'flow' | 'signal'; from: string; to: string }[];
}

export interface GraphFocus {
  /** A device, unit, or connection is picked. Otherwise every line stays plain. */
  active: boolean;
  hotEdges: Set<string>;
  hotNodes: Set<string>;
}

/** Lines tied to the pick are hot. Every other line is dim. An empty pick leaves the drawing as it is. */
export function graphFocus(graph: FocusGraph): GraphFocus {
  const picked = new Set(graph.selection);
  const unitIds = new Set(graph.units.map((u) => u.id));
  const deviceUnit = new Map(graph.devices.map((d) => [d.id, d.unitId]));
  const byId = new Map(graph.connections.map((c) => [c.id, c]));

  const devices = graph.selection.filter((id) => deviceUnit.has(id));
  const units = graph.selection.filter((id) => unitIds.has(id));
  const lines = graph.selection.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
  const active = devices.length + units.length + lines.length > 0;
  const hotEdges = new Set<string>();
  const hotNodes = new Set<string>();
  if (!active) return { active, hotEdges, hotNodes };

  const deviceSet = new Set(devices);
  const unitSet = new Set(units);
  for (const c of graph.connections) {
    let hot = picked.has(c.id);
    if (c.kind === 'signal') {
      if (deviceSet.has(c.from) || deviceSet.has(c.to)) hot = true;
      const fromUnit = deviceUnit.get(c.from);
      const toUnit = deviceUnit.get(c.to);
      if ((fromUnit && unitSet.has(fromUnit)) || (toUnit && unitSet.has(toUnit))) hot = true;
    } else if (unitSet.has(c.from) || unitSet.has(c.to)) hot = true;
    if (!hot) continue;
    hotEdges.add(c.id);
    hotNodes.add(c.from);
    hotNodes.add(c.to);
  }
  for (const id of devices) hotNodes.add(id);
  for (const id of units) hotNodes.add(id);
  return { active, hotEdges, hotNodes };
}

export function edgeTone(focus: GraphFocus, edgeId: string): EdgeTone {
  if (!focus.active) return 'plain';
  return focus.hotEdges.has(edgeId) ? 'hot' : 'dim';
}

/** Visible stroke. Hot is thicker than dim, and thicker than the plain line. */
export function edgeWidth(kind: 'flow' | 'signal', tone: EdgeTone, selected: boolean): number {
  if (tone === 'hot') return kind === 'flow' ? 4 : 3.5;
  if (tone === 'dim') return kind === 'flow' ? 1.5 : 1.25;
  return selected ? (kind === 'flow' ? 3 : 2.5) : (kind === 'flow' ? 2 : 1.5);
}

/** Dim lines stay on screen. This is not a hide. */
export const DIM_EDGE_OPACITY = 0.42;

/** Port word after the device name. Signal names are stored as `장치.포트`. */
export function portWord(deviceName: string, signalName: string | undefined, portKey: string | null | undefined): string {
  const prefix = `${deviceName}.`;
  if (signalName && deviceName && signalName.startsWith(prefix)) return signalName.slice(prefix.length);
  if (signalName) return signalName;
  return portKey || '포트';
}

export function flowCaption(fromUnit: string, toUnit: string): string {
  return `${fromUnit} → ${toUnit}`;
}

export function signalCaption(fromDevice: string, fromPort: string, toDevice: string, toPort: string): string {
  return `${fromDevice} · ${fromPort} → ${toDevice} · ${toPort}`;
}
