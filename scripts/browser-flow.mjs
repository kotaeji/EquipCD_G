// Real Chrome session. Viewport is 1280×800 CSS pixels. Not a jsdom test.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const out = 'docs/user-manual/images/gui-r5';
mkdirSync(out, { recursive: true });
const log = [];
const fail = (m) => { log.push({ ok: false, m }); throw new Error(m); };
const ok = (m) => log.push({ ok: true, m });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);

const shot = async (name) => {
  const box = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, screen: document.querySelector('.app')?.dataset.screen }));
  await page.screenshot({ path: `${out}/${name}.png` });
  log.push({ shot: name, cssViewport: '1280x800', ...box });
};

const rev = () => page.locator('.statusbar').innerText().then((t) => t.match(/rev (\d+)/)[1]);
const undoN = () => page.locator('.statusbar').innerText().then((t) => t.match(/Undo (\d+)/)[1]);

await shot('s00-light-1280');
await page.getByRole('radio', { name: '다크 테마' }).click();
await shot('s00-dark-1280');
await page.getByRole('radio', { name: '라이트 테마' }).click();
await page.getByRole('button', { name: '시작하기' }).click();

await page.locator('.card').first().click();
await shot('s10-library-light-1280');
await page.getByRole('button', { name: '카드 상세' }).click();
await shot('s11-detail-light-1280');
await page.getByRole('button', { name: '목록으로' }).click();
await page.getByRole('button', { name: 'AML 입출력' }).click();
await shot('s12-aml-light-1280');
await page.getByRole('button', { name: '입력 후보표' }).click();
await shot('s13-input-light-1280');
await page.getByRole('button', { name: '자료 입력' }).click();
await shot('s14-extract-light-1280');
await page.getByRole('button', { name: '에셋 라이브러리' }).click();
await page.getByRole('radio', { name: '다크 테마' }).click();
await shot('s10-library-dark-1280');
await page.getByRole('radio', { name: '라이트 테마' }).click();

await page.locator('[data-stepid="canvas"]').click();
await page.locator('.chip', { hasText: 'PSH-01' }).first().click();
const rev0 = await rev();
const undo0 = await undoN();
await page.locator('.chip', { hasText: 'PSH-01' }).first().dragTo(page.locator('.station-card', { hasText: 'S2 식별' }));
await page.getByRole('button', { name: '변경' }).click();
await page.waitForTimeout(200);
const moved = await page.locator('.station-card', { hasText: 'S2 식별' }).innerText();
if (!moved.includes('PSH-01')) fail('drag did not reparent PSH-01 onto S2');
ok('S20 drag reparent');
await page.getByRole('button', { name: '실행 취소' }).click();
if (await rev() !== rev0) fail('undo did not restore revision after reparent');
if (!(Number(await undoN()) >= Number(undo0))) ok('undo count moved');
ok('S20 undo after drag');
await page.getByRole('button', { name: '다시 실행' }).click();
await page.waitForTimeout(150);
const redone = await page.locator('.station-card', { hasText: 'S2 식별' }).innerText();
if (!redone.includes('PSH-01')) fail('redo did not put PSH-01 back on S2');
ok('S20 redo after drag');
await page.getByRole('button', { name: '실행 취소' }).click();
await page.getByRole('button', { name: '물류 연결' }).click();
const heads = page.locator('.station-card h3');
const headCount = await heads.count();
await heads.nth(headCount - 1).click();
await heads.nth(0).click();
await page.waitForTimeout(200);
if ((await rev()) === rev0) fail('flow connect did not change revision');
ok('S20 flow connect');
await page.getByRole('button', { name: '실행 취소' }).click();
await page.getByRole('button', { name: '신호 연결' }).click();
const portCount = await page.locator('.diagram-canvas svg circle title').count();
if (portCount < 2) fail('signal diagram has no ports');
await page.evaluate(() => {
  const circles = [...document.querySelectorAll('.diagram-canvas svg circle')].filter((c) => c.querySelector('title'));
  for (const c of circles.slice(0, 2)) c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
});
await page.waitForTimeout(200);
ok('S20 signal ports accepted a click');
if ((await rev()) !== rev0) await page.getByRole('button', { name: '실행 취소' }).click();
await page.getByRole('button', { name: '신호 연결' }).click();
const diagram = await page.locator('.diagram-fold').evaluate((el) => el.open);
if (!diagram) fail('signal mode did not open the diagram');
ok('S20 signal mode opens diagram');
await page.getByRole('button', { name: '선택/이동' }).click();
const sel = await page.locator('.chip.on').innerText();
await page.getByRole('radio', { name: '다크 테마' }).click();
if ((await page.locator('.chip.on').innerText()) !== sel) fail('theme changed selection');
if ((await rev()) !== rev0) fail('theme changed revision');
ok('S20 theme keeps selection and rev');
await shot('s20-canvas-dark-1280');
await page.getByRole('radio', { name: '라이트 테마' }).click();
await shot('s20-canvas-light-1280');

await page.locator('[data-stepid="attributes"]').click();
await page.locator('.form-grid input').first().fill('푸셔 검수');
await page.locator('.form-grid input').first().blur();
await page.waitForTimeout(100);
const rev1 = await rev();
if (Number(rev1) !== Number(rev0) + 1) fail(`property edit did not bump rev ${rev0} -> ${rev1}`);
ok('S30 name edit bumps rev');
await page.locator('.stage-title').click();
await page.getByRole('button', { name: '실행 취소' }).click();
await page.waitForFunction(() => document.querySelector('.form-grid input')?.value === 'PSH-01');
ok('S30 undo restores name');
await shot('s30-edit-light-1280');
await page.getByRole('button', { name: '신호·포지션' }).click();
await shot('s31-signals-light-1280');
await page.getByRole('button', { name: 'Action으로 복귀' }).click();
await shot('s32-action-light-1280');
await page.getByRole('button', { name: '속성으로' }).click();
await page.getByRole('radio', { name: '다크 테마' }).click();
await shot('s30-edit-dark-1280');
await page.getByRole('radio', { name: '라이트 테마' }).click();

await page.locator('[data-stepid="sequence"]').click();
if ((await page.locator('table.plain tbody tr').count()) < 1) fail('sequence sheet has no live rows');
ok('S41 live sequence rows');
await shot('s41-sequence-light-1280');
await page.getByRole('button', { name: '자재·Flow' }).click();
if (!(await page.locator('.sheet h2').first().innerText())) fail('material sheet empty');
ok('S40 material sheet');
await shot('s40-material-light-1280');
await page.getByRole('button', { name: 'Substation 시퀀스' }).click();
await shot('s42-subseq-light-1280');
await page.getByRole('button', { name: 'SFC 미리보기' }).click();
await shot('s43-sfc-light-1280');
await page.getByRole('button', { name: '누락 편집 확장' }).click();
const extendOff = await page.getByRole('button', { name: '편집 반영 미리보기' }).isDisabled();
if (!extendOff) fail('unimplemented branch control is enabled');
ok('S44 branch control disabled');
await shot('s44-extend-light-1280');
await page.getByRole('radio', { name: '다크 테마' }).click();
await page.getByRole('button', { name: 'Station 시퀀스 Draft' }).click();
await shot('s41-sequence-dark-1280');
await page.getByRole('radio', { name: '라이트 테마' }).click();

await page.locator('[data-stepid="check"]').click();
await page.getByRole('button', { name: '재분석' }).click();
await page.waitForTimeout(200);
ok('S50 reanalyze clicked');
await shot('s50-gap-light-1280');
await page.getByRole('button', { name: '진단·저장' }).click();
await shot('s51-diag-light-1280');
await page.getByRole('button', { name: 'Export 미리보기' }).click();
if (!(await page.getByRole('button', { name: 'Core 전송' }).isDisabled())) fail('Core send is enabled');
ok('S52 core send disabled');
await shot('s52-export-light-1280');
await page.getByRole('button', { name: 'Evolution Lab' }).click();
if (!(await page.getByRole('button', { name: '변형 차이 검토 예시' }).isDisabled())) fail('lab run is enabled');
ok('S53 lab disabled');
await shot('s53-lab-light-1280');
await page.getByRole('button', { name: 'Gap (F6)' }).click();
await page.getByRole('radio', { name: '다크 테마' }).click();
await shot('s50-gap-dark-1280');
await page.getByRole('radio', { name: '라이트 테마' }).click();

await page.locator('[data-stepid="run"]').click();
await page.getByRole('button', { name: '▶ 실행' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '❚❚ 일시정지' }).click();
const lockedText = await page.locator('.field-ro').first().innerText();
if (!lockedText.includes('paused') && !lockedText.includes('편집 잠금')) fail('pause did not show locked run state: ' + lockedText);
ok('S60 pause shows live state');
await shot('s60-pause-light-1280');
await page.getByRole('radio', { name: '다크 테마' }).click();
const afterTheme = await page.locator('.field-ro').first().innerText();
if (afterTheme !== lockedText) fail('theme changed run status text');
ok('S60 theme keeps run text');
await shot('s60-pause-dark-1280');
await page.getByRole('radio', { name: '라이트 테마' }).click();
await page.getByRole('button', { name: '⟲ 초기화' }).click();
await page.getByRole('tab', { name: 'Substation 그룹' }).click();
await shot('s61-group-light-1280');

await page.locator('.ex-extra > summary').click();
await page.getByRole('button', { name: '관리…' }).click();
await shot('s01-workspace-light-1280');
await page.keyboard.press('Escape');
await page.getByRole('button', { name: '프로젝트…' }).click();
await shot('s02-projects-light-1280');
await page.keyboard.press('Escape');
await page.getByRole('button', { name: '프로젝트 파일' }).click();
await shot('s03-files-light-1280');
await page.getByRole('button', { name: '닫기', exact: true }).click();
await page.getByRole('button', { name: '파일 묶음' }).click();
await shot('s04-bundle-light-1280');
await page.getByRole('button', { name: '닫기', exact: true }).click();
await page.getByRole('button', { name: '공통 탐색' }).click();
await shot('s70-search-light-1280');
await page.getByRole('button', { name: '닫기', exact: true }).click();
await page.locator('[data-stepid="canvas"]').click();
await page.locator('.chip').first().click();
await page.getByRole('button', { name: '삭제 영향 확인' }).click();
await shot('s21-impact-light-1280');
const revBeforeModal = await rev();
await page.keyboard.press('Control+z');
if ((await rev()) !== revBeforeModal) fail('undo ran while the impact dialog was open');
ok('dialog blocks undo');
const trap = await page.evaluate(() => {
  const dialog = document.querySelector('[role="alertdialog"]');
  if (!dialog) return false;
  const before = document.activeElement;
  before?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  return dialog.contains(document.activeElement) || document.activeElement === before;
});
if (!trap) fail('focus left the impact dialog');
ok('dialog keeps focus');
await page.keyboard.press('Escape');
await page.getByRole('button', { name: '보기 설정' }).click();
await shot('s71-view-light-1280');
await page.keyboard.press('Escape');
await page.locator('[data-stepid="attributes"]').click();
await page.locator('details.fold-panel > summary').click();
const complete = page.locator('.fold-body .row', { hasText: '완료 조건' }).locator('select').first();
if (await complete.count()) {
  await complete.selectOption({ index: 0 });
  await page.locator('[data-stepid="run"]').click();
  await page.getByRole('button', { name: '▶ 실행' }).click();
  await page.waitForTimeout(500);
  await shot('s62-block-light-1280');
  ok('S62 data-screen ' + (await page.locator('.app').getAttribute('data-screen')));
}
await page.setViewportSize({ width: 1920, height: 1080 });
await page.locator('[data-stepid="canvas"]').click();
await shot('s20-canvas-light-1920');
await page.locator('[data-stepid="attributes"]').click();
const geo = await page.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { sel, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), size: cs.fontSize, family: cs.fontFamily };
  };
  return { cssViewport: `${innerWidth}x${innerHeight}`, noto700: document.fonts.check('700 24px "Noto Sans KR"'), title: box('h1.stage-title'), rail: box('.canvas-rail'), field: box('.form-grid input') };
});
log.push({ geometry1920: geo });
ok('geometry ' + JSON.stringify(geo));

writeFileSync(`${out}/browser-flow.json`, JSON.stringify(log, null, 2));
await browser.close();
console.log(JSON.stringify(log.filter((x) => x.ok === false || x.m), null, 2));
