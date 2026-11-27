// @vitest-environment jsdom
// TURN-088. The clocks people read, with the stored ISO instant on the tooltip.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSampleProject } from '../src/model/sample';
import type { ConfirmationEntry, Project } from '../src/model/types';
import { ConfirmationLog } from '../src/ui/ConfirmationLog';
import { ConfirmerDialog } from '../src/ui/ConfirmerDialog';
import { formatLocalClock } from '../src/ui/localClock';
import { NoticeLog } from '../src/ui/Notices';
import type { NoticeItem } from '../src/ui/noticeModel';
import { PrintView } from '../src/ui/PrintView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AT = '2026-11-27T13:46:32.000Z';

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
});

async function render(node: ReactNode) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(node); });
  return el;
}

function withLog(at: string): Project {
  const p = buildSampleProject();
  const entry: ConfirmationEntry = {
    at, by: '김검토', name: 'IL-01', from: '미확인', to: '확인됨', target: { kind: 'interlock', id: 'IL-01' },
  };
  return { ...p, confirmationLog: [entry] };
}

describe('TURN-088 clocks on screen', () => {
  it('AC1 the confirmation table shows local time and keeps the ISO value on the tooltip', async () => {
    const el = await render(<ConfirmationLog p={withLog(AT)} onJump={() => {}} />);
    const cell = el.querySelector('[data-confirmation-log] tbody td') as HTMLTableCellElement;
    expect(cell.textContent).toBe(formatLocalClock(AT));
    expect(cell.getAttribute('title')).toBe(AT);
    expect(cell.textContent).toMatch(/\(UTC(?:[+-]\d{1,2}(?::\d{2})?)?\)$/);
  });

  it('AC1 the confirmer window shows the same clock', async () => {
    const el = await render(<ConfirmerDialog onSubmit={() => {}} onCancel={() => {}} />);
    const clock = el.querySelector('[data-confirm-clock] time') as HTMLTimeElement;
    const iso = clock.getAttribute('title') ?? '';
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(clock.getAttribute('dateTime')).toBe(iso);
    expect(clock.textContent).toBe(formatLocalClock(iso));
  });

  it('AC2 the print cover uses the report clock and titles the ISO instant', async () => {
    const el = await render(<PrintView project={buildSampleProject()} onClose={() => {}} />);
    const cell = el.querySelector('[data-print-date]') as HTMLTableCellElement;
    const iso = cell.getAttribute('title') ?? '';
    expect(cell.textContent).toBe(formatLocalClock(iso));
    expect(iso).toMatch(/Z$/);
    const row = [...el.querySelectorAll('[data-print-cover] tr')].find((tr) => tr.querySelector('[data-print-date]'));
    expect(row?.querySelector('th')?.textContent).toBe('시각');
  });

  it('AC3 the notice log uses the same clock with seconds, and the tooltip is ISO', async () => {
    const at = Date.parse(AT);
    const item: NoticeItem = { id: 1, kind: 'success', at, deadline: at, text: '저장했습니다' };
    const el = await render(<NoticeLog items={[item]} onClose={() => {}} />);
    const clock = el.querySelector('[data-notice-log] time') as HTMLTimeElement;
    expect(clock.textContent).toBe(formatLocalClock(at, { seconds: true }));
    expect(clock.getAttribute('title')).toBe(new Date(at).toISOString());
    expect(clock.getAttribute('dateTime')).toBe(new Date(at).toISOString());
  });
});
