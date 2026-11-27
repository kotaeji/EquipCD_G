// TURN-092 screenshots. Viewport 1280×800, device scale 1.
// Pointer clicks and keyboard input in headless Chrome.
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
await page.locator('[data-sample-open="flow"]').click();
await page.locator('[data-project-name]').filter({ hasText: '흐름' }).waitFor();
await page.locator('.stepper [data-stepid="sequence"] .st-go').click();
await page.locator('select[aria-label="반복 방식"]').waitFor();
const mode = page.locator('select[aria-label="반복 방식"]');
await mode.scrollIntoViewIfNeeded();
await mode.selectOption('while');
const cond = page.locator('select[aria-label="반복 조건"]');
const typeValue = await cond.evaluate((el) => [...el.options].find((o) => (o.textContent ?? '').includes('자재 종류'))?.value ?? '');
if (!typeValue) throw new Error('material type option missing');
await cond.selectOption(typeValue);
const limit = page.locator('input[aria-label="반복 상한"]');
await limit.click();
await page.keyboard.press('Control+A');
await page.keyboard.type('2');
await page.keyboard.press('Tab');
await page.waitForTimeout(150);
const typed = await limit.inputValue();
if (typed !== '2') throw new Error(`limit is ${typed}`);

async function theme(name) {
  await page.getByRole('radio', { name }).click();
  await page.waitForTimeout(200);
}

async function shot(name) {
  const box = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    mode: document.querySelector('select[aria-label="반복 방식"]')?.value ?? '',
    tag: document.querySelector('[data-sfc-loop]')?.getAttribute('data-sfc-loop-tag') ?? '',
    error: document.querySelector('[data-run-error]')?.getAttribute('data-run-error') ?? '',
    what: document.querySelector('[data-problem-what]')?.textContent ?? '',
    why: document.querySelector('[data-problem-why]')?.textContent ?? '',
    how: document.querySelector('[data-problem-how]')?.textContent ?? '',
  }));
  if (box.scrollWidth !== 1280 || box.scrollHeight !== 800) {
    throw new Error(`scroll ${box.scrollWidth}x${box.scrollHeight} at ${name}`);
  }
  await page.screenshot({ path: `${out}/${name}` });
  return box;
}

const notes = [];
await theme('라이트 테마');
await mode.scrollIntoViewIfNeeded();
notes.push(await shot('TURN-092-flow-light-1280.png'));
await theme('다크 테마');
notes.push(await shot('TURN-092-flow-dark-1280.png'));

await page.getByRole('button', { name: 'SFC 미리보기' }).first().click();
await page.locator('[data-sfc-loop]').waitFor();
await theme('라이트 테마');
notes.push(await shot('TURN-092-sfc-light-1280.png'));
await theme('다크 테마');
notes.push(await shot('TURN-092-sfc-dark-1280.png'));

await page.locator('.stepper [data-stepid="run"] .st-go').click();
await page.locator('[data-jump="run-start"]').click();
await page.getByRole('button', { name: '끝까지' }).click();
await page.locator('[data-run-error="LOOP_LIMIT"]').waitFor();
await theme('라이트 테마');
notes.push(await shot('TURN-092-limit-light-1280.png'));
await theme('다크 테마');
notes.push(await shot('TURN-092-limit-dark-1280.png'));

await page.locator('[data-run-error="LOOP_LIMIT"] button', { hasText: '이동' }).click();
await page.locator('tr.jump-flash, .jump-flash').first().waitFor();
const jumped = await page.evaluate(() => document.querySelector('.jump-flash')?.getAttribute('data-flow-kind') ?? document.querySelector('.jump-flash')?.closest('tr')?.getAttribute('data-flow-kind') ?? '');

console.log(JSON.stringify({ notes, jumped, errors }, null, 2));
if (errors.length) throw new Error(errors.join('\n'));
await browser.close();
