import type { PortDef, Signal } from '../model/types';

/** A spreadsheet signal name matches an existing device signal or its asset port label. */
export function signalMatchesName(deviceName: string, signal: Pick<Signal, 'name' | 'portKey'>, ports: Pick<PortDef, 'key' | 'label'>[], wanted: string): boolean {
  const name = wanted.trim();
  if (!name) return false;
  if (signal.name === name || signal.name === `${deviceName}.${name}`) return true;
  const port = ports.find((p) => p.key === signal.portKey);
  return !!port && (port.label === name || port.key === name);
}
