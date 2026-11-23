// TURN-074 screenshots. Viewport 1280×800, device scale 1.
// Clicks go through the DOM so a glossary tip does not open under the pointer.
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

async function clickSelector(selector) {
  await page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (!node) throw new Error(`missing ${sel}`);
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, selector);
}

async function clickLabel(label) {
  await page.evaluate((name) => {
    const node = document.querySelector(`[aria-label="${name}"]`);
    if (!node) throw new Error(`missing ${name}`);
    if (node instanceof HTMLInputElement && node.type === 'checkbox') node.click();
    else node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, label);
}

async function choose(label, value) {
  await page.evaluate(([name, next]) => {
    const select = document.querySelector(`[aria-label="${name}"]`);
    if (!(select instanceof HTMLSelectElement)) throw new Error(`missing ${name}`);
    const option = [...select.options].find((item) => item.value === next || (item.textContent ?? '').includes(next));
    if (!option) throw new Error(`missing option ${next}`);
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, [label, value]);
}

async function fill(label, value) {
  await page.evaluate(([name, next]) => {
    const input = document.querySelector(`[aria-label="${name}"]`);
    if (!(input instanceof HTMLInputElement)) throw new Error(`missing ${name}`);
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    proto?.set?.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, [label, value]);
}

await page.evaluate(() => {
  const start = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '시작하기');
  start?.click();
});
await page.waitForTimeout(300);
await clickSelector('.stepper [data-stepid="attributes"] .st-go');
await page.waitForSelector('[data-bulk-edit]');

await clickLabel('S3 가공 실린더 전진(가상 작업) 체크');
await clickLabel('S1 푸셔 투입 체크');
await choose('동작 시간 방식', 'scale');
await fill('동작 시간 값', '0.5');
await page.evaluate(() => document.querySelector('[data-bulk-edit]')?.scrollIntoView({ block: 'start' }));
await page.waitForTimeout(200);

async function theme(mode) {
  await clickSelector(`[data-theme-choice="${mode}"]`);
  await page.waitForTimeout(200);
}

async function measure() {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const bulk = document.querySelector('[data-bulk-edit]');
    const preview = document.querySelector('[data-bulk-preview]');
    return {
      scrollWidth: doc.scrollWidth,
      scrollHeight: doc.scrollHeight,
      bulkTop: bulk ? Math.round(bulk.getBoundingClientRect().top) : null,
      previewTop: preview ? Math.round(preview.getBoundingClientRect().top) : null,
      previewText: (preview?.textContent ?? '').slice(0, 180),
    };
  });
}

async function shot(name) {
  const m = await measure();
  await page.screenshot({ path: `${out}/TURN-074-${name}.png` });
  console.log(JSON.stringify({ name, ...m, errors: errors.length }));
}

for (const mode of ['light', 'dark']) {
  await theme(mode);
  await shot(`table-${mode}-1280`);
}

await choose('동작 시간 방식', 'none');
await choose('타임아웃 방식', 'set');
await fill('타임아웃 값', '0.2');
await page.evaluate(() => document.querySelector('[data-bulk-preview]')?.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(200);

for (const mode of ['light', 'dark']) {
  await theme(mode);
  await shot(`preview-${mode}-1280`);
}

if (errors.length) console.log('CONSOLE', JSON.stringify(errors.slice(0, 6)));
await browser.close();
