import { describe, expect, it } from 'vitest';
import { signalMatchesName } from '../src/import/signalMatch';

describe('signalMatchesName', () => {
  it('returns false when wanted is empty or whitespace only', () => {
    expect(signalMatchesName('DEV', { name: '', portKey: '' }, [], '')).toBe(false);
    expect(signalMatchesName('DEV', { name: '', portKey: '' }, [], '   ')).toBe(false);
  });

  it('matches when signal.name equals wanted exactly', () => {
    expect(signalMatchesName('DEV', { name: 'Extend', portKey: '' }, [], 'Extend')).toBe(true);
  });

  it('trims surrounding whitespace of wanted before comparing', () => {
    expect(signalMatchesName('DEV', { name: 'Extend', portKey: '' }, [], ' Extend ')).toBe(true);
  });

  it('matches when signal.name equals deviceName.wanted', () => {
    expect(signalMatchesName('CYL1', { name: 'CYL1.Extend', portKey: '' }, [], 'Extend')).toBe(true);
  });

  it('matches by the port label of the matching port', () => {
    expect(signalMatchesName('DEV', { name: '', portKey: 'p1' }, [{ key: 'p1', label: 'Extend' }], 'Extend')).toBe(true);
  });

  it('matches by the port key of the matching port', () => {
    expect(signalMatchesName('DEV', { name: '', portKey: 'p1' }, [{ key: 'p1', label: 'Extend' }], 'p1')).toBe(true);
  });

  it('returns false when label/key belongs to a different port', () => {
    const ports = [
      { key: 'p1', label: 'Retract' },
      { key: 'p2', label: 'Extend' },
    ];
    expect(signalMatchesName('DEV', { name: '', portKey: 'p1' }, ports, 'Extend')).toBe(false);
    expect(signalMatchesName('DEV', { name: '', portKey: 'p1' }, ports, 'p2')).toBe(false);
  });

  it('returns false when no port matches and name does not match', () => {
    expect(signalMatchesName('DEV', { name: 'Retract', portKey: 'p1' }, [{ key: 'p2', label: 'Extend' }], 'Extend')).toBe(false);
  });

  it('comparison is case-sensitive', () => {
    expect(signalMatchesName('DEV', { name: 'Extend', portKey: '' }, [], 'extend')).toBe(false);
  });
});
