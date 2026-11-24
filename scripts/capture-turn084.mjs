// TURN-084 screenshots. Viewport 1280×800, device scale 1. Not a user test.
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
await page.locator('.stepper [data-stepid="canvas"] .st-go').click();
await page.locator('#layout-tab-diagram').click();
await page.locator('.diagram-canvas .react-flow__node').first().waitFor();

async function appearance(mode) {
  await page.getByRole('radio', { name: mode === 'dark' ? '다크 테마' : '라이트 테마' }).click();
  await page.waitForTimeout(200);
}

async function resetDiagram() {
  await page.locator('.diagram-canvas .react-flow__pane').click({ position: { x: 8, y: 8 } });
  await page.waitForTimeout(100);
}

async function shot(name) {
  const box = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    place: document.querySelector('[data-kbd-place]')?.textContent ?? '',
  }));
  if (box.scrollWidth !== 1280 || box.scrollHeight !== 800) throw new Error(`scroll ${box.scrollWidth}x${box.scrollHeight}`);
  await page.screenshot({ path: `${out}/${name}` });
  return box.place;
}

const places = {};
for (const mode of ['light', 'dark']) {
  await appearance(mode);
  await resetDiagram();
  await page.locator('.diagram-canvas .rf-host').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const picked = await shot(`TURN-084-unit-${mode}-1280.png`);
  if (!picked.includes('S2 식별')) throw new Error(`place ${picked}`);
  await page.keyboard.press('KeyL');
  const linking = await shot(`TURN-084-link-${mode}-1280.png`);
  if (!linking.includes('물류 연결')) throw new Error(`link ${linking}`);
  await page.keyboard.press('Escape');
  places[mode] = { picked, linking };
}

console.log(JSON.stringify({ places, errors }));
await browser.close();
if (errors.length) process.exit(1);
