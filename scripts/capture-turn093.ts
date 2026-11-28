// TURN-093 screenshots and Chrome pointer / keyboard checks. Viewport device scale 1.
import { mkdirSync } from 'node:fs';
import { chromium, type Page } from 'playwright-core';
import { buildSampleProject } from '../src/model/sample';
import { saveProject, type KV } from '../src/storage/localStore';

const out = process.argv[2] ?? 'docs/turns';
mkdirSync(out, { recursive: true });

function memoryKv(): KV & { dump: () => [string, string][] } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    dump: () => [...map.entries()],
  };
}

function seeded() {
  const p = buildSampleProject();
  const steps = p.sequence.steps;
  const first = p.actions.find((a) => a.id === steps[0].actionId)!;
  const second = p.actions.find((a) => a.id === steps[1].actionId)!;
  first.timeout = { ...first.timeout, value: null };
  second.timeout = { ...second.timeout, value: null };
  const other = p.actions.find((a) => a.id !== first.id && a.id !== second.id && a.duration.value !== null && a.timeout.value !== null && a.timeout.value >= (a.duration.value ?? 0))!;
  other.timeout = { ...other.timeout, value: Math.max(0, (other.duration.value ?? 1) - 0.5) };
  const kv = memoryKv();
  if (!saveProject(kv, p).ok) throw new Error('seed save failed');
  return { pairs: kv.dump(), timeoutField: `timeout:${first.id}`, stepName: steps[0].name };
}

const seed = seeded();
const errors: string[] = [];

async function boot(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(process.env.ECD_URL ?? 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '시작하기' }).click();
  await page.locator('.stepper [data-stepid="run"] .st-go').click();
  await page.locator('[data-readiness-summary]').waitFor();
}

async function theme(page: Page, mode: 'light' | 'dark') {
  await page.getByRole('radio', { name: mode === 'dark' ? '다크 테마' : '라이트 테마' }).click();
  await page.waitForTimeout(150);
}

async function showChecklist(page: Page) {
  await page.locator('.run-conditions').evaluate((el) => {
    const summary = el.querySelector('[data-readiness-summary]');
    summary?.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(100);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await page.addInitScript((pairs: [string, string][]) => {
  for (const [key, value] of pairs) localStorage.setItem(key, value);
}, seed.pairs);
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await boot(page, 1280, 800);
const summary = (await page.locator('[data-readiness-summary]').textContent())?.trim();
if (summary !== '차단 2 · 경고 3') throw new Error(`summary ${summary}`);

const row = page.locator('.readiness-row').first();
await row.locator('.readiness-what').click();
const opened = await row.locator('[data-readiness-detail]').evaluate((el) => !(el as HTMLElement).hidden);
await row.focus();
await page.keyboard.press('Escape');
const closed = await row.locator('[data-readiness-detail]').evaluate((el) => (el as HTMLElement).hidden);
await row.focus();
await page.keyboard.press('Enter');
const reopened = await row.locator('[data-readiness-detail]').evaluate((el) => !(el as HTMLElement).hidden);
const lines = await row.locator('[data-problem]').evaluate((el) => ({
  what: el.querySelector('[data-problem-what]')?.textContent ?? '',
  why: el.querySelector('[data-problem-why]')?.textContent ?? '',
  how: el.querySelector('[data-problem-how]')?.textContent ?? '',
}));

await row.locator('[data-readiness-jump]').click();
const step = await page.locator('.app').getAttribute('data-step');
const flashed = await page.locator(`[data-jump="${seed.timeoutField}"]`).first().evaluate((el) => el.classList.contains('jump-flash'));
await page.locator('.stepper [data-stepid="run"] .st-go').click();
await page.locator('[data-readiness-summary]').waitFor();
await row.locator('.readiness-what').click();

const box1280 = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  scrollHeight: document.documentElement.scrollHeight,
}));

for (const mode of ['light', 'dark'] as const) {
  await theme(page, mode);
  await showChecklist(page);
  await page.screenshot({ path: `${out}/TURN-093-list-${mode}-1280.png` });
}

await page.setViewportSize({ width: 1024, height: 700 });
await page.waitForTimeout(200);
const folded = await page.locator('.run-conditions').evaluate((el) => el.classList.contains('is-folded'));
const strip = await page.locator('[data-strip-blockers]').evaluate((el) => ({
  text: el.textContent,
  hidden: (el as HTMLElement).hidden,
}));
const box1024 = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  scrollHeight: document.documentElement.scrollHeight,
}));
for (const mode of ['light', 'dark'] as const) {
  await theme(page, mode);
  await page.screenshot({ path: `${out}/TURN-093-strip-${mode}-1024.png` });
}
await page.getByRole('button', { name: '가동 조건 펼치기' }).click();
await page.locator('[data-readiness-summary]').waitFor();
await showChecklist(page);
for (const mode of ['light', 'dark'] as const) {
  await theme(page, mode);
  await showChecklist(page);
  await page.screenshot({ path: `${out}/TURN-093-open-${mode}-1024.png` });
}

const report = {
  summary,
  pointer: { opened, closed, reopened, lines, step, flashed },
  strip: { folded, ...strip },
  box1280,
  box1024,
  errors,
};
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (summary !== '차단 2 · 경고 3' || !opened || !closed || !reopened || step !== 'attributes' || !flashed || strip.text !== '2' || strip.hidden || errors.length) {
  process.exit(1);
}
