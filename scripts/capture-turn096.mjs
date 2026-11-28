// TURN-096 screenshots. Viewport 1280×800, device scale 1. Real Chrome pointer and keyboard.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

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

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });

async function shot(name) {
  const box = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight,
  }));
  await page.screenshot({ path: `${out}/${name}` });
  return box;
}

async function appearance(mode) {
  await page.getByRole('radio', { name: mode === 'dark' ? '다크 테마' : '라이트 테마' }).click();
  await page.waitForTimeout(200);
}

async function fit() {
  await page.locator('.rf-host').click({ position: { x: 8, y: 8 } });
  await page.keyboard.press('0');
  await page.waitForTimeout(250);
}

async function tool(name) {
  const row = page.locator('.diagram-tools');
  const direct = row.getByRole('button', { name, exact: true });
  if (await direct.count() && await direct.first().isVisible()) {
    await direct.first().click();
    return 'button';
  }
  await row.getByRole('button', { name: '더 보기' }).click();
  await page.getByRole('menuitem', { name }).click();
  return 'more';
}

await page.locator('[data-sample-open="sample"]').click();
await page.locator('.stepper [data-stepid="canvas"] .st-go').click();
await page.locator('#layout-tab-diagram').click();
await fit();

await page.locator('[data-tree-id="U-S2"] > .tnode').click();
const selectedBefore = await page.locator('.prop-sheet h2').innerText();
if (!selectedBefore.includes('S2')) throw new Error(`expected S2, got ${selectedBefore}`);
const beforeLight = await shot('TURN-096-before-light-1280.png');
await appearance('dark');
const beforeDark = await shot('TURN-096-before-dark-1280.png');
await appearance('light');

const duplicateHow = await tool('복제');
await page.waitForTimeout(200);
await fit();
const copyLight = await shot('TURN-096-copy-light-1280.png');
await appearance('dark');
const copyDark = await shot('TURN-096-copy-dark-1280.png');
await appearance('light');

const unitsAfter = await page.evaluate(() => document.querySelectorAll('.react-flow__node .rf-unit').length);

await page.locator('[aria-label="실행 취소"]').click();
await page.locator('.stepper [data-stepid="library"] .st-go').click();
await page.locator('[data-kind="sensor"]').click();
await page.locator('.prop-col select, .section select').last().selectOption({ label: 'S1 투입' });
await page.getByRole('button', { name: '프로젝트에 추가' }).click();
await page.waitForTimeout(200);
await page.locator('.stepper [data-stepid="canvas"] .st-go').click();
await page.locator('#layout-tab-diagram').click();
await fit();
await page.locator('[data-tree-id="PSH-01"]').click();
await page.keyboard.press('Control+A');
await page.waitForTimeout(150);
const arrangeHow = await tool('배치 ▾');
const gapItem = page.locator('#arrange-menu').getByRole('menuitem', { name: '가로 간격 같게' });
const gapTitle = await gapItem.getAttribute('title');
if (await gapItem.isDisabled()) throw new Error(`gap disabled: ${gapTitle}`);
await gapItem.click();
await page.waitForTimeout(200);
const zoomLabel = page.locator('.zoom-pill span').first();
for (let i = 0; i < 10 && !((await zoomLabel.innerText()).includes('150')); i++) {
  await page.getByRole('button', { name: '확대' }).click();
}
const pan = await page.evaluate(() => {
  const host = document.querySelector('.rf-host')?.getBoundingClientRect();
  const s1 = document.querySelector('.react-flow__node[data-id="U-S1"]')?.getBoundingClientRect();
  if (!host || !s1) return null;
  let spot = null;
  for (let y = host.bottom - 24; y > host.top + 8 && !spot; y -= 16) {
    for (let x = host.left + 70; x < host.right - 16; x += 28) {
      const el = document.elementFromPoint(x, y);
      if (!el || !el.closest('.react-flow__pane')) continue;
      if (el.closest('.react-flow__node, .react-flow__controls, .react-flow__minimap, .react-flow__edge')) continue;
      spot = { x, y };
      break;
    }
  }
  if (!spot) return null;
  return {
    spot,
    dx: (host.left + host.width / 2) - (s1.left + s1.width / 2),
    dy: (host.top + host.height / 2) - (s1.top + s1.height / 2),
  };
});
if (pan) {
  await page.mouse.move(pan.spot.x, pan.spot.y);
  await page.mouse.down();
  await page.mouse.move(pan.spot.x + pan.dx, pan.spot.y + pan.dy, { steps: 14 });
  await page.mouse.up();
}
await page.locator('.toast button, .notice button').first().click({ timeout: 1000 }).catch(() => {});
const gapLight = await shot('TURN-096-gap-light-1280.png');
await appearance('dark');
const gapDark = await shot('TURN-096-gap-dark-1280.png');

const gapState = await page.evaluate(() => ({
  toast: document.querySelector('.toast')?.textContent ?? '',
  selected: [...document.querySelectorAll('.is-sel')].map((n) => n.closest('[data-id]')?.getAttribute('data-id')),
}));

const ids = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map((n) => n.getAttribute('data-id')));
console.log(JSON.stringify({
  errors, beforeLight, beforeDark, copyLight, copyDark, gapLight, gapDark, unitsAfter, ids, gapState, duplicateHow, arrangeHow, selectedBefore,
}, null, 2));
await browser.close();
