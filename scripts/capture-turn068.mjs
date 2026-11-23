// TURN-068 screenshots. Viewport 1280×800, device scale 1. Not a user test.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'docs/turns';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/local/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function boot() {
  await page.goto(process.env.ECD_URL ?? 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const start = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '시작하기');
    start?.click();
  });
  await page.waitForTimeout(300);
}

async function appearance(mode) {
  await page.getByRole('radio', { name: mode === 'dark' ? '다크 테마' : '라이트 테마' }).click();
  await page.waitForTimeout(150);
}

async function step(id) {
  await page.evaluate((stepId) => {
    document.querySelector(`.stepper [data-stepid="${stepId}"] .st-go`)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, id);
  await page.waitForTimeout(200);
}

async function clickText(label) {
  await page.evaluate((name) => {
    const button = [...document.querySelectorAll('button')].find((item) => (item.textContent ?? '').trim() === name);
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, label);
  await page.waitForTimeout(150);
}

async function measure() {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const next = [...document.querySelectorAll('.statusbar button')].find((item) => (item.textContent ?? '').includes('다음 단계'));
    const cards = [...document.querySelectorAll('.toast-card')];
    const nextBox = next?.getBoundingClientRect();
    const hits = cards.filter((card) => {
      const box = card.getBoundingClientRect();
      if (!nextBox) return false;
      return box.left < nextBox.right && box.right > nextBox.left && box.top < nextBox.bottom && box.bottom > nextBox.top;
    }).length;
    return {
      scrollWidth: doc.scrollWidth,
      scrollHeight: doc.scrollHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      toasts: cards.length,
      coversNext: hits,
    };
  });
}

async function shot(name) {
  const m = await measure();
  await page.screenshot({ path: `${out}/TURN-068-${name}.png` });
  console.log(JSON.stringify({ name, ...m }));
  if (m.scrollWidth !== 1280 || m.scrollHeight !== 800 || m.scrollX !== 0 || m.scrollY !== 0) {
    throw new Error(`${name} document scroll ${m.scrollWidth}x${m.scrollHeight} at ${m.scrollX},${m.scrollY}`);
  }
  if (m.coversNext) throw new Error(`${name} toast covers 다음 단계`);
  return m;
}

for (const mode of ['light', 'dark']) {
  await boot();
  await appearance(mode);
  await step('sequence');
  await page.evaluate(() => document.querySelector('table[aria-label="Station 흐름"]')?.scrollIntoView({ block: 'nearest' }));
  await shot(`flow-${mode}-1280`);

  await step('run');
  await clickText('▶ 실행');
  await page.waitForTimeout(200);
  await clickText('끝까지');
  await page.waitForTimeout(300);
  await clickText('자세히');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const body = document.querySelector('.run-details-body');
    const table = document.querySelector('.run-summary-table');
    if (body && table) body.scrollTop = Math.max(0, table.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 8);
  });
  await shot(`summary-${mode}-1280`);

  await boot();
  await appearance(mode);
  await step('canvas');
  await page.evaluate(() => {
    document.querySelector('#layout-tab-board')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const flow = [...document.querySelectorAll('button')].find((item) => (item.textContent ?? '').trim() === '물류 연결');
    flow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    document.querySelector('.station-card')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await step('check');
  await clickText('재분석');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  const stacked = await shot(`toasts-${mode}-1280`);
  if (stacked.toasts !== 3) throw new Error(`${mode} expected 3 toasts, saw ${stacked.toasts}`);

  for (let i = 0; i < 3; i++) await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  await clickText('알림');
  await page.waitForTimeout(150);
  await shot(`log-${mode}-1280`);
}

if (errors.length) {
  console.log('CONSOLE', JSON.stringify(errors.slice(0, 12)));
  throw new Error('console errors');
}
await browser.close();
