// UserView (user-local, NOT design data). Stored under a separate key; never serialized into project files.
import { VIEW_KEY, type KV } from '../storage/localStore';
import { STEPS, type StepId } from './wizard';

export type ThemeId = 'A' | 'B' | 'C';
export const THEMES: Record<ThemeId, { label: string; vars: Record<string, string> }> = {
  A: { label: 'A 밝은 엔지니어링', vars: { bg: '#F3F5F8', panel: '#FFFFFF', canvas: '#F8FAFC', border: '#DCE3EC', text: '#172B4D', muted: '#64748B', accent: '#2563EB', selected: '#DBEAFE', success: '#287D54', warning: '#A66515', danger: '#B42318', grid: '#E8EDF4', rowh: '32px', pad: '12px', scheme: 'light', 'on-accent': '#FFFFFF' } },
  B: { label: 'B 어두운 관제', vars: { bg: '#0D1728', panel: '#132237', canvas: '#0F1D30', border: '#2B3D53', text: '#E3ECF5', muted: '#9AADC2', accent: '#4DAFA9', selected: '#203F49', success: '#6BBF93', warning: '#D5AF67', danger: '#E5806F', grid: '#1A2D43', rowh: '30px', pad: '12px', scheme: 'dark', 'on-accent': '#0D1728' } },
  C: { label: 'C 따뜻하고 차분함', vars: { bg: '#F1F0EB', panel: '#FCFBF7', canvas: '#F7F6F1', border: '#D9DDD5', text: '#283D3B', muted: '#73807B', accent: '#3E807A', selected: '#DFECE6', success: '#487D5E', warning: '#9E7B43', danger: '#A4473A', grid: '#E7E9E1', rowh: '36px', pad: '14px', scheme: 'light', 'on-accent': '#FFFFFF' } },
};
export const THEME_ORDER: ThemeId[] = ['A', 'B', 'C'];
export function nextTheme(t: ThemeId): ThemeId { return THEME_ORDER[(THEME_ORDER.indexOf(t) + 1) % THEME_ORDER.length]; }

export type LayerId = 'background' | 'units' | 'axis' | 'io' | 'positions' | 'flow';
export interface UserView {
  theme: ThemeId;
  visualMode: 'schematic' | 'photo';
  layers: Record<LayerId, boolean>;
  zoom: number;
  /** C10: current wizard step = current central workspace (menu and center view always derived from this one value) */
  step: StepId;
  /** per project id: step → confirmed fingerprint (UserView only; never in project files) */
  confirmed: Record<string, Partial<Record<StepId, string>>>;
  libraryFilter: { q: string; category: string };
  /** TURN-002: per project id → ids of collapsed tree rows (Station = equipment id, Substation = unit id). UserView only. */
  treeCollapsed: Record<string, string[]>;
}
export const DEFAULT_VIEW: UserView = { theme: 'A', visualMode: 'schematic', layers: { background: true, units: true, axis: true, io: true, positions: true, flow: true }, zoom: 1,
  step: 'library', confirmed: {}, libraryFilter: { q: '', category: '' }, treeCollapsed: {} };

function cleanCollapsed(v: unknown): Record<string, string[]> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, ids] of Object.entries(v as Record<string, unknown>)) if (Array.isArray(ids)) out[k] = ids.filter((x): x is string => typeof x === 'string');
  return out;
}

export function loadView(kv: KV | null): UserView {
  if (!kv) return DEFAULT_VIEW;
  try {
    const v = kv.getItem(VIEW_KEY); if (!v) return DEFAULT_VIEW;
    const o = JSON.parse(v);
    return { ...DEFAULT_VIEW, ...o, layers: { ...DEFAULT_VIEW.layers, ...(o.layers ?? {}) }, theme: THEME_ORDER.includes(o.theme) ? o.theme : 'A',
      // broken/unknown UserView step → first valid step (model is never reset because of view data)
      step: STEPS.some((s) => s.id === o.step) ? o.step : 'library',
      visualMode: o.visualMode === 'photo' ? 'photo' : 'schematic',
      confirmed: o.confirmed && typeof o.confirmed === 'object' ? o.confirmed : {},
      libraryFilter: { ...DEFAULT_VIEW.libraryFilter, ...(o.libraryFilter ?? {}) },
      treeCollapsed: cleanCollapsed(o.treeCollapsed) };
  } catch { return DEFAULT_VIEW; }
}
export function saveView(kv: KV | null, v: UserView) { if (!kv) return; try { kv.setItem(VIEW_KEY, JSON.stringify(v)); } catch { /* ignore */ } }
