// TURN-088 screenshots. Viewport 1280×800, device scale 1. Real pointer clicks.
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

async function shot(name) {
  const box = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  await page.screenshot({ path: `${out}/${name}`, fullPage: false });
  return box;
}

await page.goto(process.env.ECD_URL ?? 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });

await page.locator('[data-sample-open="sample"]').click();
await page.getByRole('button', { name: '보기 설정' }).click();
const name = page.locator('[data-confirmer-name]');
await name.click();
await name.fill('');
await page.keyboard.type('김검토');
await page.getByRole('button', { name: '닫기' }).click();

await page.locator('.stepper [data-stepid="attributes"] .st-go').click();
await page.locator('.form-grid input[type="checkbox"]').first().click();
const interlock = page.locator('[aria-label="IL-01 확인"]').first();
if (await interlock.count()) await interlock.click();

await page.locator('.stepper [data-stepid="check"] .st-go').click();
const names = await page.locator('button').allInnerTexts();
const step = await page.locator('.app').getAttribute('data-step');
const diag = names.map((n) => n.replace(/\s+/g, ' ').trim()).find((n) => n.includes('진단'));
if (!diag) throw new Error(`step ${step}; buttons ${names.map((n) => n.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 60).join(' | ')}`);
await page.getByRole('button', { name: diag }).click();
const log = page.locator('[data-confirmation-log]');
await log.waitFor();
await log.scrollIntoViewIfNeeded();
const clock = await page.locator('[data-confirmation-log] tbody td').first().evaluate((td) => ({
  text: td.textContent,
  title: td.getAttribute('title'),
}));
if (!clock.text?.includes('(UTC+9)')) throw new Error(`confirmation clock ${clock.text}`);
if (!clock.title?.endsWith('Z')) throw new Error(`confirmation title ${clock.title}`);

const appBoxes = {};
for (const mode of ['light', 'dark']) {
  await page.getByRole('radio', { name: mode === 'dark' ? '다크 테마' : '라이트 테마' }).click();
  await page.waitForTimeout(200);
  await log.scrollIntoViewIfNeeded();
  appBoxes[mode] = await shot(`TURN-088-log-${mode}-1280.png`);
}

await page.locator('.stepper [data-stepid="run"] .st-go').click();
const details = page.locator('[aria-label="자세히 펼치기"]');
if (await details.count()) await details.click();
await page.getByRole('button', { name: '▶ 실행' }).click();
await page.getByRole('button', { name: '끝까지' }).click();
await page.waitForSelector('[data-run-status="completed"]');
await page.locator('[data-report-export]').click();
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('[data-report-kind="html"]').click(),
]);
const reportPath = '/tmp/turn088-report.html';
await download.saveAs(reportPath);
const suggested = download.suggestedFilename();
if (!suggested.endsWith('.html')) throw new Error(`downloaded ${suggested}`);

const report = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
report.on('pageerror', (e) => errors.push(String(e)));
await report.goto(`file://${reportPath}`, { waitUntil: 'load' });
const bodyStart = await report.locator('body').innerText().catch(() => '');
if (!bodyStart.includes('내보낸 시각')) throw new Error(`report body ${bodyStart.slice(0, 400)}`);
const stampText = await report.locator('.stamp').innerText();
if (!stampText.includes('(UTC+9)')) throw new Error(`report stamp ${stampText}`);
if (!stampText.includes('내보낸 시각')) throw new Error(stampText);
const iso = await report.locator('.stamp').getAttribute('title');
if (!iso?.endsWith('Z')) throw new Error(`report title ${iso}`);

const reportBoxes = {};
for (const mode of ['light', 'dark']) {
  await report.emulateMedia({ colorScheme: mode });
  await report.locator('header').scrollIntoViewIfNeeded();
  reportBoxes[`head-${mode}`] = await report.screenshot({ path: `${out}/TURN-088-report-head-${mode}-1280.png` }).then(async () => report.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  })));
  await report.locator('.stamp').scrollIntoViewIfNeeded();
  await report.screenshot({ path: `${out}/TURN-088-report-${mode}-1280.png` });
}

console.log(JSON.stringify({ clock, stampText, iso, appBoxes, reportBoxes, errors }, null, 2));
await browser.close();
if (errors.length) process.exit(1);
