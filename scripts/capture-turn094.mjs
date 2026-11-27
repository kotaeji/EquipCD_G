// TURN-094 screenshots. Viewport 1280×800, device scale 1. Real Chrome pointer and keyboard.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'docs/turns';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(process.env.ECD_URL ?? 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });

async function appearance(mode) {
  await page.getByRole('radio', { name: mode === 'dark' ? '다크 테마' : '라이트 테마' }).click();
  await page.waitForTimeout(200);
}

async function shot(name) {
  const box = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  if (box.scrollWidth !== 1280 || box.scrollHeight !== 800) throw new Error(`scroll ${box.scrollWidth}x${box.scrollHeight}`);
  await page.screenshot({ path: `${out}/${name}` });
  return box;
}

await page.getByRole('button', { name: '시작하기' }).click();
await page.locator('[data-jump="save"]').click();
await page.locator('.stepper [data-stepid="check"] .st-go').click();
await page.locator('.subtabs button', { hasText: '진단·저장·AML' }).click();
await page.locator('[data-save-points]').waitFor();

await page.keyboard.press('Control+k');
const search = page.locator('[aria-label="명령 검색"]');
await search.waitFor();
await page.keyboard.type('저장 지점');
await page.locator('[data-command="save-point"]').click();
const name = page.locator('[aria-label="저장 지점 이름"]');
await name.waitFor();
await name.click();
await page.keyboard.type('출하 전');
await page.keyboard.press('Tab');
await page.keyboard.type('포장기 전');
await page.getByRole('button', { name: '만들기', exact: true }).click();
await page.locator('[data-save-point-name]', { hasText: '출하 전' }).waitFor();

await page.getByRole('button', { name: '저장 지점 만들기' }).click();
await page.locator('[aria-label="저장 지점 이름"]').click();
await page.keyboard.type('포장 후');
await page.keyboard.press('Enter');
await page.locator('[data-save-point-name]', { hasText: '포장 후' }).waitFor();

const meta = await page.locator('[data-save-point]').first().innerText();
if (!meta.includes('포장 후') || !meta.includes('rev')) throw new Error(`list ${meta}`);
const clock = await page.locator('[data-save-point] time').first().evaluate((node) => ({
  text: node.textContent,
  title: node.getAttribute('title'),
  dateTime: node.getAttribute('dateTime'),
}));
if (!clock.text?.includes('(UTC')) throw new Error(`clock ${clock.text}`);
if (clock.title !== clock.dateTime) throw new Error(`title ${clock.title}`);

const dismiss = async () => {
  const closers = page.getByRole('button', { name: '알림 닫기' });
  while (await closers.count()) {
    await closers.first().click();
    await page.waitForTimeout(50);
  }
};
await dismiss();
await page.locator('[data-save-points]').scrollIntoViewIfNeeded();
const boxes = {};
for (const mode of ['light', 'dark']) {
  await appearance(mode);
  await page.locator('[data-save-points]').scrollIntoViewIfNeeded();
  boxes[mode] = await shot(`TURN-094-list-${mode}-1280.png`);
}

const revAtPoints = (await page.locator('.work-rev').innerText()).replace(/\s+/g, ' ');
await page.getByRole('button', { name: '포장 후 이 지점으로 되돌리기' }).click();
const ask = page.locator('[data-save-point-restore]');
await ask.waitFor();
const count = await ask.getAttribute('data-change-count');
if (count !== '0') throw new Error(`unchanged model should differ by 0, got ${count}`);
await page.locator('[data-save-point-restore-cancel]').click();

await page.getByRole('button', { name: /프로젝트 상세$/ }).click();
await page.getByRole('button', { name: /이름 변경$/ }).click();
const rename = page.locator('[role=dialog] input');
await rename.click();
await page.keyboard.press('Control+a');
await page.keyboard.type('이름만 바꿈');
await page.getByRole('button', { name: '이름 변경', exact: true }).click();
await page.locator('.work-crumb[data-project-name="이름만 바꿈"]').waitFor();
await page.keyboard.press('Escape');
const revRenamed = (await page.locator('.work-rev').innerText()).replace(/\s+/g, ' ');

await page.locator('.stepper [data-stepid="check"] .st-go').click();
await page.locator('.subtabs button', { hasText: '진단·저장·AML' }).click();
await dismiss();
let changes = 0;
for (const mode of ['light', 'dark']) {
  await appearance(mode);
  await page.getByRole('button', { name: '포장 후 이 지점으로 되돌리기' }).click();
  await ask.waitFor();
  changes = Number(await ask.getAttribute('data-change-count'));
  if (!(changes > 0)) throw new Error(`change count ${changes}`);
  const askText = await ask.innerText();
  if (!askText.includes('바뀌는 항목') || !askText.includes('실행 취소 한 번')) throw new Error(askText);
  await page.locator('.modal-bg').waitFor();
  await page.waitForTimeout(250);
  boxes[`restore-${mode}`] = await shot(`TURN-094-restore-${mode}-1280.png`);
  if (mode === 'light') await page.locator('[data-save-point-restore-cancel]').click();
}

await page.locator('[data-save-point-restore-confirm]').click();
await page.locator('.work-crumb[data-project-name]').waitFor();
const restored = await page.locator('.work-crumb[data-project-name]').getAttribute('data-project-name');
if (!restored || restored === '이름만 바꿈') throw new Error(`name stayed ${restored}`);
const revAfter = (await page.locator('.work-rev').innerText()).replace(/\s+/g, ' ');
await page.keyboard.press('Escape');
await page.locator('[aria-label="실행 취소"]').click();
const undone = await page.locator('.work-crumb[data-project-name]').getAttribute('data-project-name');
if (undone !== '이름만 바꿈') throw new Error(`undo name ${undone}`);
const revUndo = (await page.locator('.work-rev').innerText()).replace(/\s+/g, ' ');
if (revUndo !== revRenamed) throw new Error(`undo rev ${revUndo} wanted ${revRenamed}`);
if (revAfter === revRenamed) throw new Error(`restore did not bump rev ${revAfter}`);

if (errors.length) throw new Error(errors.join('\n'));
console.log(JSON.stringify({
  clock, revAtPoints, revRenamed, revAfter, revUndo, changes, boxes, errors,
}, null, 2));
await browser.close();
