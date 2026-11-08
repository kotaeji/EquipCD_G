// Real Chrome captures for the Aurora shell. Not a jsdom check.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.env.GUI_URL ?? 'http://127.0.0.1:5173/';
const out = process.env.GUI_OUT ?? 'docs/user-manual/images/gui-r5';
mkdirSync(out, { recursive: true });
const shots = [];
const notes = [];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

function overflow(page) {
  return page.evaluate(() => [...document.querySelectorAll('.header, .tabbar, .stepper, .statusbar, .explorer, .workspace')].map((n) => ({
    cls: n.className, sw: n.scrollWidth, cw: n.clientWidth, sh: n.scrollHeight, ch: n.clientHeight,
  })));
}

async function shot(page, name) {
  const path = `${out}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  shots.push(path);
  const box = await overflow(page);
  const spill = box.filter((b) => b.sw > b.cw + 2 || b.sh > b.ch + 2);
  if (spill.length) notes.push({ name, spill });
}

async function ready(page) {
  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('text=어떤 장비를 설계할까요');
}

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await ready(page);
const font = await page.evaluate(() => getComputedStyle(document.querySelector('.title')).fontFamily);
notes.push({ font });
await shot(page, 's00-light-1280');

const before = await page.evaluate(() => {
  const app = document.querySelector('.app');
  return { screen: app.dataset.screen, step: app.dataset.step, theme: app.dataset.theme, rev: document.querySelector('.statusbar').textContent.match(/rev \d+/)[0], homeTitle: document.querySelector('h1')?.textContent ?? '' };
});
await page.getByRole('radio', { name: '다크 테마' }).click();
const after = await page.evaluate(() => {
  const app = document.querySelector('.app');
  return { screen: app.dataset.screen, step: app.dataset.step, theme: app.dataset.theme, appearance: app.dataset.appearance, rev: document.querySelector('.statusbar').textContent.match(/rev \d+/)[0], homeTitle: document.querySelector('h1')?.textContent ?? '' };
});
if (after.screen !== before.screen || after.step !== before.step || after.rev !== before.rev || after.homeTitle !== before.homeTitle || after.theme !== 'B' || after.appearance !== 'dark') {
  throw new Error('theme toggle changed more than color: ' + JSON.stringify({ before, after }));
}
const paint = await page.evaluate(() => ({
  accent: getComputedStyle(document.querySelector('.app')).getPropertyValue('--accent').trim(),
  dark: getComputedStyle(document.querySelector('[data-theme-choice=dark]')).backgroundColor,
  light: getComputedStyle(document.querySelector('[data-theme-choice=light]')).backgroundColor,
}));
notes.push({ paint });
await shot(page, 's00-dark-1280');
await page.getByRole('radio', { name: '라이트 테마' }).click();

await page.getByRole('button', { name: '시작하기' }).click();
await page.waitForSelector('.cards .card');
await shot(page, 's10-library-light-1280');
await page.locator('.card[data-kind="pusher"]').click();
await shot(page, 's11-detail-light-1280');
const slot = await page.locator('.card[data-kind="pusher"] .slot-diagram img').evaluate((img) => ({ w: img.getBoundingClientRect().width, h: img.getBoundingClientRect().height, attrW: img.getAttribute('width'), attrH: img.getAttribute('height') }));
if (slot.w !== 100 || slot.h !== 48) throw new Error('pusher slot geometry ' + JSON.stringify(slot));
notes.push({ slot });

await page.locator('[data-stepid="canvas"]').click();
await page.waitForSelector('.station-card');
const fontCheck = await page.evaluate(async () => {
  await document.fonts.ready;
  const title = getComputedStyle(document.querySelector('.stage-title'));
  const body = getComputedStyle(document.querySelector('.station-card h3'));
  return {
    titleFamily: title.fontFamily,
    titleSize: title.fontSize,
    titleWeight: title.fontWeight,
    cardSize: body.fontSize,
    noto: document.fonts.check('700 24px "Noto Sans KR"') && document.fonts.check('700 18px "Noto Sans KR"'),
  };
});
notes.push({ fontCheck });
if (!fontCheck.noto) throw new Error('Noto Sans KR is not loaded: ' + JSON.stringify(fontCheck));
if (fontCheck.titleSize !== '24px') throw new Error('stage title is not 24px: ' + fontCheck.titleSize);
await page.locator('.chip', { hasText: 'PSH-01' }).first().click();
await shot(page, 's20-canvas-light-1280');
await page.getByRole('radio', { name: '다크 테마' }).click();
await shot(page, 's20-canvas-dark-1280');
await page.getByRole('radio', { name: '라이트 테마' }).click();

await page.locator('.tree [role=treeitem]').nth(2).click();
await page.locator('[data-stepid="attributes"]').click();
await shot(page, 's30-edit-light-1280');

await page.locator('[data-stepid="sequence"]').click();
await shot(page, 's41-sequence-light-1280');
await page.getByRole('button', { name: '자재·Flow (F4)' }).click();
await shot(page, 's40-material-light-1280');

await page.locator('[data-stepid="check"]').click();
await shot(page, 's50-gap-light-1280');
await page.getByRole('button', { name: 'Evolution Lab (F7)' }).click();
const labDisabled = await page.getByRole('button', { name: '평가 실행' }).isDisabled();
if (!labDisabled) throw new Error('lab action should stay disabled');
await shot(page, 's53-lab-light-1280');

await page.locator('[data-stepid="run"]').click();
await page.getByRole('button', { name: '▶ 실행' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '❚❚ 일시정지' }).click();
await page.waitForSelector('text=시뮬 paused');
const runRev = await page.locator('.statusbar').innerText();
await shot(page, 's60-pause-light-1280');
await page.getByRole('radio', { name: '다크 테마' }).click();
const runRevDark = await page.locator('.statusbar').innerText();
if (!runRevDark.includes('paused') || runRev.match(/rev \d+/)[0] !== runRevDark.match(/rev \d+/)[0]) throw new Error('run state changed with theme');
await shot(page, 's60-pause-dark-1280');
await page.getByRole('radio', { name: '라이트 테마' }).click();

await page.locator('.ex-extra > summary').click();
await page.getByRole('button', { name: '관리…' }).click();
await page.getByRole('button', { name: '+ 새 Workspace' }).click();
await page.getByRole('dialog').last().locator('input').fill('화면검수 공간');
await page.getByRole('button', { name: '만들기' }).click();
await page.getByRole('button', { name: '닫기', exact: true }).click();
await page.getByRole('button', { name: '⟲ 초기화' }).click();
await page.waitForSelector('text=시뮬 idle');
const rename = page.getByRole('button', { name: /이름 변경$/ }).first();
await rename.click();
await page.getByRole('dialog').locator('input').fill('이름 바꾼 라인');
await page.getByRole('button', { name: '이름 변경', exact: true }).click();
await page.waitForSelector('text=이름 바꾼 라인');
const undoBefore = (await page.locator('.statusbar').innerText()).match(/Undo \d+/)[0];
await page.locator('select[aria-label="Workspace 선택"]').selectOption({ label: '화면검수 공간' });
await page.waitForSelector('text=저장하러 돌아가기');
await shot(page, 'dirty-modal-light-1280');
const trap = await page.evaluate(() => {
  const dlg = [...document.querySelectorAll('[role=alertdialog], [role=dialog]')].at(-1);
  const buttons = [...dlg.querySelectorAll('button')].filter((b) => !b.disabled);
  buttons.at(-1).focus();
  buttons.at(-1).dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  const first = document.activeElement === buttons[0];
  const undo = document.querySelector('.statusbar').textContent.match(/Undo \d+/)[0];
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  const undoAfter = document.querySelector('.statusbar').textContent.match(/Undo \d+/)[0];
  return { first, undo, undoAfter, modal: !!document.querySelector('.modal-bg') };
});
if (!trap.first || trap.undo !== trap.undoAfter || trap.undo !== undoBefore) throw new Error('modal trap/shortcut failed ' + JSON.stringify(trap));
await page.keyboard.press('Escape');
await page.waitForSelector('.modal-bg', { state: 'hidden' });
await page.getByRole('radio', { name: '다크 테마' }).click();
if ((await page.locator('.statusbar').innerText()).match(/Undo \d+/)[0] !== undoBefore) throw new Error('theme changed undo');
await page.locator('select[aria-label="Workspace 선택"]').selectOption({ label: '화면검수 공간' });
await page.waitForSelector('text=저장하러 돌아가기');
await shot(page, 'dirty-modal-dark-1280');
await page.keyboard.press('Escape');
await page.waitForSelector('.modal-bg', { state: 'hidden' });

await page.locator('input[type=file]').setInputFiles({ name: 'broken.ecd.json', mimeType: 'application/json', buffer: Buffer.from('{') });
await page.waitForSelector('text=가져오기 거부');
await shot(page, 'import-error-light-1280');
await page.evaluate(() => document.querySelector('[data-theme-choice="dark"]').click());
const errStill = await page.locator('text=가져오기 거부').count();
if (!errStill) throw new Error('theme click dismissed the import error');
await shot(page, 'import-error-dark-1280');
await page.keyboard.press('Escape');
await page.waitForSelector('.modal-bg', { state: 'hidden' });

await page.setViewportSize({ width: 1920, height: 800 });
await page.getByRole('tab', { name: '작업 시작' }).click();
await page.getByRole('radio', { name: '라이트 테마' }).click();
await shot(page, 's00-light-1920');
await page.getByRole('radio', { name: '다크 테마' }).click();
await shot(page, 's00-dark-1920');
await page.getByRole('button', { name: '시작하기' }).click();
await page.locator('[data-stepid="library"]').click();
await page.waitForSelector('.libdetail');
await shot(page, 's10-library-dark-1920');
const wide = await page.evaluate(() => {
  const nav = document.querySelector('.explorer').getBoundingClientRect().width;
  const detail = document.querySelector('.libdetail')?.getBoundingClientRect().width ?? 0;
  return { nav, detail, font: getComputedStyle(document.querySelector('.title')).fontSize };
});
notes.push({ wide });
if (Math.round(wide.nav) !== 224) notes.push({ navWidth: wide.nav });
if (wide.font !== '20px') throw new Error('title scaled at 1920: ' + wide.font);

writeFileSync(`${out}/capture-report.json`, JSON.stringify({ shots, notes }, null, 2));
await browser.close();
console.log(JSON.stringify({ shots: shots.length, notes }, null, 2));
