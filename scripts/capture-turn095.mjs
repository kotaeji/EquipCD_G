// TURN-095. Chrome pointer, keyboard, print-to-PDF. Viewport 1280×800, device scale 1.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const out = process.argv[2] ?? 'docs/turns';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const notes = [];
async function clickLabel(label) {
  const node = page.getByRole('button', { name: label }).first();
  await node.click();
}

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.locator('[data-sample-open="sample"]').click();
await page.locator('.stepper [data-stepid="sequence"] .st-go').click();
await page.locator('button', { hasText: '자재·Flow' }).click();
await page.getByRole('button', { name: '자재 정의 추가' }).click();
notes.push({ added: await page.locator('[data-material-def]').count() });

await page.locator('.stepper [data-stepid="run"] .st-go').click();
await page.getByRole('button', { name: '▶ 실행' }).click();
await page.getByRole('button', { name: '끝까지' }).click();
await page.waitForFunction(() => document.querySelector('[data-run-status]')?.getAttribute('data-run-status') === 'completed');
const details = page.locator('[aria-label="자세히 펼치기"]');
if (await details.count()) await details.click();

const exportBtn = page.locator('[data-report-export]');
await exportBtn.click();
const htmlItem = page.locator('[data-report-kind="html"]');
await htmlItem.focus();
const downloadPromise = page.waitForEvent('download');
await page.keyboard.press('Enter');
const download = await downloadPromise;
const reportPath = `${out}/TURN-095-report.html`;
await download.saveAs(reportPath);
notes.push({ reportFile: download.suggestedFilename() });

const report = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
report.on('pageerror', (e) => errors.push(String(e)));
await report.goto(`file://${resolve(reportPath)}`, { waitUntil: 'load' });
const reportAlign = await report.locator('td.ecd-num').first().evaluate((el) => getComputedStyle(el).textAlign);
const reportHead = await report.locator('.doc-runhead').evaluate((el) => getComputedStyle(el).display);
notes.push({ reportAlign, reportHeadScreen: reportHead });
await report.locator('.doc-cover').screenshot({ path: `${out}/TURN-095-report-cover-light-1280.png` });
await report.locator('table.doc-table', { hasText: '단계 이름' }).screenshot({ path: `${out}/TURN-095-report-table-light-1280.png` });
await report.locator('[data-kind-legend]').screenshot({ path: `${out}/TURN-095-report-kinds-light-1280.png` });

await report.emulateMedia({ media: 'print' });
const reportHeadPrint = await report.locator('.doc-runhead').evaluate((el) => getComputedStyle(el).display);
notes.push({ reportHeadPrint });
await report.screenshot({ path: `${out}/TURN-095-report-print-preview-1280.png` });
const reportPdf = await report.pdf({ printBackground: true, preferCSSPageSize: true });
writeFileSync(`${out}/TURN-095-report.pdf`, reportPdf);

await page.bringToFront();
await page.getByRole('button', { name: '내보내기', exact: true }).click();
await page.getByRole('menuitem', { name: '인쇄용 보기' }).click();
await page.locator('[data-print-view]').waitFor();
const sheet = page.locator('[data-print-sheet]');
notes.push({
  sheetWhite: (await sheet.getAttribute('style'))?.includes('#ffffff'),
  orient: await page.locator('[data-print-view]').getAttribute('data-orientation'),
});
await page.locator('.doc-cover').screenshot({ path: `${out}/TURN-095-print-cover-light-1280.png` });
await page.locator('[data-print-section="structure"] table.doc-table').screenshot({ path: `${out}/TURN-095-print-table-light-1280.png` });
await page.locator('[data-print-section="diagram"] .mat-kinds').screenshot({ path: `${out}/TURN-095-print-kinds-light-1280.png` });
await page.locator('[data-print-section="notes"] table[aria-label="Gap"]').screenshot({ path: `${out}/TURN-095-print-status-light-1280.png` });

await page.locator('[data-print-orient="portrait"]').focus();
await page.keyboard.press('Enter');
notes.push({ afterKey: await page.locator('[data-print-view]').getAttribute('data-orientation') });
await page.locator('[data-print-orient="landscape"]').focus();
await page.keyboard.press('Enter');

await page.emulateMedia({ media: 'print' });
const printHead = await page.locator('.doc-runhead').evaluate((el) => getComputedStyle(el).display);
notes.push({ printHead });
await page.screenshot({ path: `${out}/TURN-095-print-preview-1280.png` });
const client = await page.context().newCDPSession(page);
const printed = await client.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
writeFileSync(`${out}/TURN-095-print.pdf`, Buffer.from(printed.data, 'base64'));

await page.emulateMedia({ media: 'screen' });
await page.keyboard.press('Escape');
notes.push({ closed: await page.locator('[data-print-view]').count() === 0 });

writeFileSync(`${out}/TURN-095-capture-notes.json`, JSON.stringify({ notes, errors }, null, 2));
console.log(JSON.stringify({ notes, errors }, null, 2));
await browser.close();
