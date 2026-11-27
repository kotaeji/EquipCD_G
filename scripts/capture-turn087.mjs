// TURN-087 screenshots and keyboard check. Viewport 1280×800, device scale 1.
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

const place = () => page.locator('[data-kbd-place]').innerText();
const xy = (text) => {
  const m = /\((\d+),\s*(\d+)\)/.exec(text);
  if (!m) throw new Error(`no coordinates in ${text}`);
  return { x: Number(m[1]), y: Number(m[2]) };
};

await page.locator('.diagram-canvas .rf-host').focus();
await page.keyboard.press('Tab');
await page.keyboard.press('Enter');
const device = await place();
if (!device.includes('CYL-01')) throw new Error(`device ${device}`);
await page.keyboard.press('Control+d');
await page.locator('.diagram-canvas .rf-host').focus();
await page.keyboard.press('ArrowRight');
const copyMoved = xy(await place());
await page.keyboard.press('Control+z');
const copyBack = xy(await place());
if (copyBack.x !== copyMoved.x - 10 || copyBack.y !== copyMoved.y) throw new Error(`copy undo ${copyBack.x} from ${copyMoved.x}`);
await page.keyboard.press('Control+z');
const cleared = await place();
if (cleared !== '') throw new Error(`expected empty place, got ${cleared}`);

await page.locator('.diagram-canvas .rf-host').focus();
await page.keyboard.press('Tab');
await page.keyboard.press('ArrowRight');
const moved = xy(await place());
await page.keyboard.press('Control+z');
const undone = xy(await place());
if (undone.x !== moved.x - 10 || undone.y !== moved.y) throw new Error(`undo ${JSON.stringify(undone)} from ${JSON.stringify(moved)}`);
await page.keyboard.press('Control+y');
const redone = xy(await place());
if (redone.x !== moved.x || redone.y !== moved.y) throw new Error(`redo ${JSON.stringify(redone)}`);

const body = page.locator('.react-flow__node[data-id="U-S1"] .rf-unit');
const box = await body.boundingBox();
if (!box) throw new Error('unit box');
await page.mouse.move(box.x + 40, box.y + 40);
await page.mouse.down();
await page.mouse.move(box.x + 100, box.y + 40, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(150);
const dragged = xy(await place());
if (dragged.x === redone.x && dragged.y === redone.y) throw new Error(`drag did not move the status line ${JSON.stringify(dragged)}`);
await page.keyboard.press('Control+z');

await page.getByRole('button', { name: '프로젝트 추가' }).click();
await page.getByRole('menuitem', { name: '흐름 예제' }).click();
await page.locator('[data-jump="save"]').click();
await page.locator('.stepper [data-stepid="sequence"] .st-go').click();
await page.locator('table[aria-label="Station 흐름"]').waitFor();
await page.locator('table[aria-label="Station 흐름"] tbody tr').nth(1).getByRole('button', { name: '아래로' }).click();
await page.getByRole('button', { name: '신호 기다림 추가' }).click();
await page.locator('.stepper [data-stepid="check"] .st-go').click();
const landed = await page.locator('.app').getAttribute('data-step');
if (landed !== 'check') {
  const dialog = await page.locator('[role=dialog]').allInnerTexts();
  throw new Error(`step ${landed} dialogs ${JSON.stringify(dialog)}`);
}
await page.locator('.subtabs button', { hasText: '진단·저장·AML' }).click();
const order = page.locator('[data-diff-order]');
await order.first().waitFor();
const orderText = (await order.allInnerTexts()).join(' | ');
if (!orderText.includes('더함:') || !orderText.includes('신호 기다림')) throw new Error(`order ${orderText}`);
if (/flow-|STEP-|s[0-9]/.test(orderText)) throw new Error(`id leaked ${orderText}`);
const closers = page.getByRole('button', { name: '알림 닫기' });
while (await closers.count()) {
  await closers.first().click();
  await page.waitForTimeout(50);
}

async function appearance(mode) {
  await page.getByRole('radio', { name: mode === 'dark' ? '다크 테마' : '라이트 테마' }).click();
  await page.waitForTimeout(200);
}

async function shot(name) {
  const box = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  if (box.scrollWidth !== 1280 || box.scrollHeight !== 800) throw new Error(`scroll ${box.scrollWidth}x${box.scrollHeight}`);
  await page.screenshot({ path: `${out}/${name}` });
}

for (const mode of ['light', 'dark']) {
  await appearance(mode);
  await shot(`TURN-087-order-${mode}-1280.png`);
}

console.log(JSON.stringify({
  device, copyMoved, copyBack, cleared,
  moved, undone, redone, dragged, orderText, errors,
}, null, 2));
await browser.close();
if (errors.length) process.exit(1);
