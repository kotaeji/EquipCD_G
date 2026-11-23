// TURN-076 screenshots. Viewport 1280×800, device scale 1. Not a user test.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'docs/turns';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(process.env.ECD_URL ?? 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '시작하기' }).click();
await page.waitForTimeout(300);

async function appearance(mode) {
  await page.getByRole('radio', { name: mode === 'dark' ? '다크 테마' : '라이트 테마' }).click();
  await page.waitForTimeout(200);
}

async function step(id) {
  await page.locator(`.stepper [data-stepid="${id}"] .st-go`).click();
  await page.waitForTimeout(250);
}

async function sub(label) {
  await page.locator('.subtabs').getByRole('button', { name: label }).click();
  await page.waitForTimeout(250);
}

const pasted = [
  'Unit\t코드\tDevice\tType\tSignal\tDirection\t역할\tAddress\t주소 상태\tMemo',
  'S1 투입\tCYL-01\tCYL-01\t실린더\t전진 명령\t출력\t명령\tY101\t확인\t보조',
  'S6 검사\tSEN-99\tSEN-99\t센서\t감지\t입력\t센서\tX1\t미지정\t',
].join('\n');

async function showPaste() {
  await step('library');
  await sub('자료 입력');
  const area = page.getByLabel('표 붙여넣기');
  await area.fill(pasted);
  await page.getByRole('button', { name: '표 읽기' }).click();
  await page.waitForSelector('[data-xlsx-preview]');
  const preview = await page.locator('[data-xlsx-preview]').innerText();
  if (!preview.includes('SEN-99') || !preview.includes('CYL-01')) throw new Error(`preview missing rows: ${preview.slice(0, 180)}`);
  const deviceRole = await page.locator('select[aria-label="C 열 역할"]').inputValue();
  if (deviceRole !== 'deviceName') throw new Error(`device column mapped to ${deviceRole}`);
  await page.locator('.csv-paste').scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
}

for (const mode of ['light', 'dark']) {
  await appearance(mode);
  await showPaste();
  await page.screenshot({ path: `${out}/TURN-076-paste-${mode}-1280.png` });
  await sub('입력 후보표');
  await page.locator('[data-io-export]').scrollIntoViewIfNeeded();
  const exportText = await page.locator('[data-io-export]').first().innerText();
  if (!exportText.includes('IO 리스트 내보내기')) throw new Error(exportText);
  await page.screenshot({ path: `${out}/TURN-076-export-${mode}-1280.png` });
  await step('check');
  await sub('Export 미리보기');
  await page.locator('[data-io-export]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/TURN-076-export-s5-${mode}-1280.png` });
}

const downloadPromise = page.waitForEvent('download');
await step('library');
await sub('입력 후보표');
await page.locator('[data-io-export]').click();
const download = await downloadPromise;
const name = download.suggestedFilename();
if (!name.endsWith('_IO리스트.csv')) throw new Error(name);
const rev = await page.locator('.statusbar').innerText();
console.log(JSON.stringify({ file: name, status: rev.slice(0, 180), errors }));
await browser.close();
if (errors.length) process.exit(1);
