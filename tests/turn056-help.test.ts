// TURN-056 help copy and glossary. Reads the manual file; no jsdom.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GLOSSARY, GLOSSARY_ORDER, splitTerms } from '../src/ui/glossary';
import { HELP_ROOT_IDS, HELP_TOPICS, STEP_TABS, helpTopic, resolveHelpId } from '../src/ui/helpCopy';
import { STEPS, type StepId } from '../src/ui/wizard';
import { MemoryKV, VIEW_KEY } from '../src/storage/localStore';
import { loadView } from '../src/ui/viewSettings';

const manual = readFileSync('docs/user-manual/USER-MANUAL.ko.md', 'utf8');

function headings(md: string): { section: string; title: string }[] {
  return md.split('\n').flatMap((line) => {
    const m = /^#{2,3} (\d+(?:\.\d+)?)(?:\.)? (.+)$/.exec(line);
    return m ? [{ section: m[1], title: m[2] }] : [];
  });
}

function appendix(md: string): Record<string, string> {
  const start = md.indexOf('## 부록 B. 용어');
  const end = md.indexOf('## 부록 C.');
  const out: Record<string, string> = {};
  for (const line of md.slice(start, end).split('\n')) {
    const m = /^\| ([^|]+) \| ([^|]+) \|$/.exec(line);
    if (!m || m[1].trim() === '용어') continue;
    out[m[1].trim()] = m[2].trim();
  }
  return out;
}

const REQUIRED = [
  ...HELP_ROOT_IDS,
  ...STEPS.flatMap((s) => STEP_TABS[s.id].map((tab) => `${s.id}:${tab}`)),
];

describe('TURN-056 help copy', () => {
  it('AC2 every step tab, the start screen, and Workspace · Project have a full topic', () => {
    const ids = new Set(HELP_TOPICS.map((t) => t.id));
    for (const id of REQUIRED) {
      expect(ids.has(id), id).toBe(true);
      const t = helpTopic(id);
      expect(t.does.length, id).toBeGreaterThan(12);
      expect(t.tasks.length, id).toBeGreaterThanOrEqual(3);
      expect(t.tasks.length, id).toBeLessThanOrEqual(6);
      expect(t.stuck.length, id).toBeGreaterThanOrEqual(1);
      expect(t.stuck.length, id).toBeLessThanOrEqual(3);
      expect(t.manual.section, id).toMatch(/^\d+(\.\d+)?$/);
      expect(t.manual.title.length, id).toBeGreaterThan(0);
      for (const line of [...t.tasks, ...t.stuck]) expect(line.length, id).toBeGreaterThan(4);
    }
    expect(helpTopic('library:detail').tasks.length).toBeGreaterThanOrEqual(3);
    expect(helpTopic('run:blocked').tasks.length).toBeGreaterThanOrEqual(3);
  });

  it('AC4 each cited manual section and title is a real heading', () => {
    const found = headings(manual);
    for (const t of HELP_TOPICS) {
      const hit = found.some((h) => h.section === t.manual.section && h.title === t.manual.title);
      expect(hit, `${t.id} → ${t.manual.section} ${t.manual.title}`).toBe(true);
    }
  });

  it('follows the step, the tab, the explorer, and a blocked run', () => {
    const base = {
      scope: 'main' as const, home: false, explorer: 'project' as const, step: 'library' as StepId,
      sub: 'cards', layout: 'board' as const, right: 'props', runView: 'diagram' as const, runBlocked: false, libDetail: false,
    };
    expect(resolveHelpId({ ...base, home: true })).toBe('home');
    expect(resolveHelpId({ ...base, scope: 'explorer', explorer: 'workspace' })).toBe('workspace');
    expect(resolveHelpId({ ...base, scope: 'explorer' })).toBe('project');
    expect(resolveHelpId(base)).toBe('library:cards');
    expect(resolveHelpId({ ...base, libDetail: true })).toBe('library:detail');
    expect(resolveHelpId({ ...base, sub: 'aml' })).toBe('library:aml');
    expect(resolveHelpId({ ...base, step: 'canvas', layout: 'diagram' })).toBe('canvas:diagram');
    expect(resolveHelpId({ ...base, step: 'attributes', right: 'check' })).toBe('attributes:check');
    expect(resolveHelpId({ ...base, step: 'sequence', sub: 'sfc' })).toBe('sequence:sfc');
    expect(resolveHelpId({ ...base, step: 'check', sub: 'export' })).toBe('check:export');
    expect(resolveHelpId({ ...base, step: 'run', runView: '3d' })).toBe('run:3d');
    expect(resolveHelpId({ ...base, step: 'run', runBlocked: true })).toBe('run:blocked');
  });
});

describe('TURN-056 glossary', () => {
  it('AC7 lists every required term with a non-empty line', () => {
    const labels = GLOSSARY_ORDER.map((id) => GLOSSARY[id].label);
    for (const word of ['Station', 'Substation', 'Unit', 'Device', 'Action', 'Signal', 'Position', 'Interlock', '물류 연결', '신호 연결', '사전조건', '완료조건', '타임아웃', '가정', '미정', 'Gap', 'rev', '가상 시간', '사이클', 'SFC', 'AML', 'Workspace', '임시 저장']) {
      expect(labels, word).toContain(word);
    }
    for (const id of GLOSSARY_ORDER) expect(GLOSSARY[id].line.trim().length, id).toBeGreaterThan(8);
  });

  it('keeps appendix B lines for the terms that table defines', () => {
    const rows = appendix(manual);
    const same: [string, keyof typeof GLOSSARY][] = [
      ['Station', 'station'], ['Substation', 'substation'], ['Device', 'device'], ['Action', 'action'],
      ['가상 시간', 'virtualTime'], ['rev', 'rev'], ['Workspace', 'workspace'],
      ['AML / CAEX', 'aml'], ['[예시] 가정값', 'assumption'],
    ];
    for (const [label, id] of same) expect(GLOSSARY[id].line, label).toBe(rows[label]);
  });

  it('marks a label without swallowing a longer word', () => {
    const parts = splitTerms('Substation 시퀀스 · 신호 연결 · Action');
    expect(parts.filter((p) => p.id).map((p) => p.text)).toEqual(['Substation', '신호 연결', 'Action']);
    expect(splitTerms('rev 1').filter((p) => p.id).map((p) => p.id)).toEqual(['rev']);
    expect(splitTerms('미리보기').some((p) => p.id)).toBe(false);
  });
});

describe('TURN-056 view defaults', () => {
  it('AC6 help starts closed and term hints start on, including views saved before this turn', () => {
    expect(loadView(null).helpOpen).toBe(false);
    expect(loadView(null).termHints).toBe(true);
    const kv = new MemoryKV();
    kv.setItem(VIEW_KEY, JSON.stringify({ home: false, step: 'run' }));
    expect(loadView(kv).helpOpen).toBe(false);
    expect(loadView(kv).termHints).toBe(true);
    const off = new MemoryKV();
    off.setItem(VIEW_KEY, JSON.stringify({ helpOpen: true, termHints: false }));
    expect(loadView(off).helpOpen).toBe(true);
    expect(loadView(off).termHints).toBe(false);
  });
});
