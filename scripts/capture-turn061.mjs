// TURN-061 screenshots. Viewport 1280×800, device scale 1. Not a user test.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'docs/turns';
const tag = process.argv[3] ?? 'after';
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
await page.evaluate(() => {
  const start = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '시작하기');
  start?.click();
});
await page.waitForTimeout(400);

async function measure() {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const bars = [...document.querySelectorAll('.header, .toolbar, .diagram-tools, .stage-head .tool-pills, .subtabs, .ui-tabs')].map((el) => ({
      cls: el.className.toString().slice(0, 80),
      sw: el.scrollWidth,
      cw: el.clientWidth,
      overflow: el.scrollWidth - el.clientWidth,
    }));
    return {
      scrollWidth: doc.scrollWidth,
      scrollHeight: doc.scrollHeight,
      bars: bars.filter((b) => b.overflow > 1),
    };
  });
}

async function shot(name) {
  const m = await measure();
  await page.screenshot({ path: `${out}/TURN-061-${tag}-${name}.png` });
  console.log(JSON.stringify({ tag, name, scrollWidth: m.scrollWidth, scrollHeight: m.scrollHeight, overflow: m.bars }));
}

async function appearance(mode) {
  await page.getByRole('radio', { name: mode === 'dark' ? '다크 테마' : '라이트 테마' }).click();
  await page.waitForTimeout(200);
}

const steps = [['library', 's1'], ['canvas', 's2'], ['attributes', 's3'], ['sequence', 's4'], ['check', 's5'], ['run', 's6']];

for (const mode of ['light', 'dark']) {
  await appearance(mode);
  for (const [id, name] of steps) {
    await page.evaluate((id) => document.querySelector(`.stepper [data-stepid="${id}"] .st-go`)?.dispatchEvent(new MouseEvent('click', { bubbles: true })), id);
    await page.waitForTimeout(300);
    if (id === 'canvas') {
      await page.evaluate(() => document.querySelector('#layout-tab-diagram')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await page.waitForTimeout(400);
    }
    await shot(`${name}-${mode}-1280`);
  }
  await page.evaluate(() => document.querySelector('.stepper [data-stepid="canvas"] .st-go')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.evaluate(() => document.querySelector('#layout-tab-diagram')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.waitForTimeout(300);
  await page.locator('[data-id="U-S1"] .rf-unit').click({ button: 'right' });
  await page.waitForSelector('[data-ctx-menu]');
  await shot(`menu-${mode}-1280`);
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('[aria-label="명령 찾기"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.waitForSelector('[aria-label="명령 찾기"][role="dialog"]');
  await shot(`palette-${mode}-1280`);
  await page.keyboard.press('Escape');
}

if (errors.length) console.log('CONSOLE', JSON.stringify(errors.slice(0, 8)));
await browser.close();
