// TURN-091 screenshots. Viewport 1280×800, device scale 1. Real Chrome pointer and keyboard.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'docs/turns';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });

async function clickLabel(label) {
  const node = page.locator(`button, [role="radio"], [role="tab"]`).filter({ hasText: label }).first();
  if (await node.count()) { await node.click(); return; }
  await page.getByRole('button', { name: label }).click();
}

async function fillLabel(label, value) {
  const input = page.locator(`[aria-label="${label}"]`);
  await input.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(value);
  await page.keyboard.press('Tab');
}

async function appearance(mode) {
  await page.getByRole('radio', { name: mode === 'dark' ? '다크 테마' : '라이트 테마' }).click();
  await page.waitForTimeout(250);
}

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

const notes = [];
await page.locator('[data-sample-open="sample"]').click();
await page.locator('.stepper [data-stepid="sequence"] .st-go').click();
await page.locator('button', { hasText: '자재·Flow' }).click();
await page.getByRole('button', { name: '자재 정의 추가' }).click();

const mark = page.locator('[aria-label="B 표식"]');
await mark.click();
await page.keyboard.press('Control+A');
await page.keyboard.press('Backspace');
await page.keyboard.press('Tab');
const cleared = await page.locator('[aria-label="B 표식"]').evaluate((el) => ({
  value: el.value,
  placeholder: el.placeholder,
  stored: el.getAttribute('data-mark-stored'),
}));
notes.push({ cleared });

await fillLabel('자재 화면 투입 개수', '6');
await fillLabel('투입 순서', 'A, A, B');
const mix = await page.evaluate(() => ({
  tokens: [...document.querySelectorAll('[data-material-def]')].map((n) => n.getAttribute('data-mat-token')),
  patterns: [...document.querySelectorAll('[data-material-def]')].map((n) => n.getAttribute('data-mat-pattern')),
  preview: document.querySelector('[data-feed-preview]')?.textContent ?? '',
}));
notes.push({ mix });

const materialLight = await shot('TURN-091-material-light-1280.png');
await appearance('dark');
const materialDark = await shot('TURN-091-material-dark-1280.png');
await appearance('light');

await page.locator('.stepper [data-stepid="run"] .st-go').click();
await fillLabel('투입 간격', '1');
await page.getByRole('button', { name: '▶ 실행' }).click();
await page.waitForFunction(() => {
  const marks = [...document.querySelectorAll('.rf-mat')].map((n) => n.getAttribute('data-mark'));
  return marks.includes('A') && marks.includes('B');
}, { timeout: 25000 });
await page.getByRole('button', { name: '일시정지' }).click();
const live = await page.evaluate(() => [...document.querySelectorAll('.rf-mat')].map((n) => ({
  mark: n.getAttribute('data-mark'),
  token: n.getAttribute('data-mat-token'),
  pattern: n.getAttribute('data-mat-pattern'),
})));
notes.push({ live });
const diagramLight = await shot('TURN-091-diagram-light-1280.png');
await appearance('dark');
const diagramDark = await shot('TURN-091-diagram-dark-1280.png');

await page.getByRole('button', { name: '자세히 펼치기' }).click();
await page.getByRole('tab', { name: '타이밍 차트' }).click();
await page.locator('[data-timing-lane="piece"]').click();
const timing = await page.evaluate(() => ({
  legend: [...document.querySelectorAll('.timing-legend [data-kind-legend]')].map((n) => n.getAttribute('data-kind-legend')),
  rows: [...document.querySelectorAll('[data-timing-row][data-mat-mark]')].map((n) => ({
    mark: n.getAttribute('data-mat-mark'),
    token: n.getAttribute('data-mat-token'),
    pattern: n.getAttribute('data-mat-pattern'),
  })),
}));
notes.push({ timing });
const timingDark = await shot('TURN-091-timing-dark-1280.png');
await appearance('light');
const timingLight = await shot('TURN-091-timing-light-1280.png');

await page.getByRole('radio', { name: '3D' }).click();
await page.waitForTimeout(600);
const scene = await page.locator('[data-scene-kind]').getAttribute('data-scene-kind');
notes.push({ scene });
const sceneLight = await shot('TURN-091-3d-light-1280.png');
await appearance('dark');
const sceneDark = await shot('TURN-091-3d-dark-1280.png');

console.log(JSON.stringify({
  errors,
  boxes: { materialLight, materialDark, diagramLight, diagramDark, timingLight, timingDark, sceneLight, sceneDark },
  notes,
}, null, 2));
await browser.close();
