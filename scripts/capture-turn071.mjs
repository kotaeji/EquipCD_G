// TURN-071 screenshots. Viewport 1280×800, device scale 1. Not a user test.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const out = 'docs/turns';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (err) => errors.push(String(err)));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

await page.goto(process.env.ECD_URL ?? 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '흐름 예제' }).click();
await page.locator('.stepper [data-stepid="run"] .st-go').click();
await page.getByLabel('투입 개수').fill('3');
await page.getByLabel('투입 개수').blur();
await page.getByLabel('투입 간격').fill('0');
await page.getByLabel('투입 간격').blur();

async function shot(name) {
  const box = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    time: document.querySelector('[data-run-time]')?.textContent ?? '',
    pieces: document.querySelector('[data-material]')?.textContent ?? '',
    cycle: document.querySelector('[data-cycle-time]')?.textContent ?? '',
    bottleneck: document.querySelector('[data-bottleneck]')?.textContent ?? '',
  }));
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name, JSON.stringify(box));
}

const clockMs = (text) => {
  const match = /(\d+):(\d+)\.(\d+)/.exec(text ?? '');
  if (!match) return 0;
  return Number(match[1]) * 60000 + Number(match[2]) * 1000 + Number(match[3]);
};
await page.locator('[data-jump="run-start"]').click();
await page.getByRole('button', { name: '일시정지' }).click();
if (clockMs(await page.locator('[data-run-time]').textContent()) > 12000) {
  await page.getByRole('button', { name: '초기화' }).click();
  await page.locator('[data-jump="run-start"]').click();
  await page.getByRole('button', { name: '일시정지' }).click();
}
for (let i = 0; i < 120; i++) {
  const time = await page.locator('[data-run-time]').textContent();
  const fed = await page.locator('[data-material]').textContent();
  if (clockMs(time) >= 6000 && (fed ?? '').includes('투입 2')) break;
  await page.getByRole('button', { name: '+0.1s' }).click();
}
await shot('TURN-071-run-light-1280');
await page.getByRole('radio', { name: '다크 테마' }).click();
await shot('TURN-071-run-dark-1280');
await page.getByRole('radio', { name: '라이트 테마' }).click();

await page.getByRole('button', { name: '재개' }).click();
await page.getByRole('button', { name: '끝까지' }).click();
await page.getByRole('button', { name: '자세히 펼치기' }).click();
await page.getByRole('tab', { name: '실행 결과 요약' }).click();
await page.evaluate(() => {
  const body = document.querySelector('.run-details-body');
  const table = document.querySelector('.run-summary-table');
  if (body && table) body.scrollTop = table.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
});
await shot('TURN-071-summary-light-1280');
await page.getByRole('radio', { name: '다크 테마' }).click();
await shot('TURN-071-summary-dark-1280');

console.log('errors', errors.filter((line) => !line.includes('favicon')));
await browser.close();
