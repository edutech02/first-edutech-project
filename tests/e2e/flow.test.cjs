// 전체 흐름 점검. 실행: npm run test:e2e
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const BASE = process.env.BASE || 'http://localhost:8080/';
const OUT = process.env.OUT || path.join(__dirname, '..', 'out');
fs.mkdirSync(OUT, { recursive: true });

const texts = (page) => page.$$eval('#page > p', (ps) => ps.map((p) => (p.classList.contains('locked') ? '[잠금]' : p.textContent)));
const saved = (page) => page.waitForFunction(() => document.querySelector('#status').textContent === '저장됨', null, { timeout: 30000 });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(BASE);
  await page.waitForSelector('#library:not([hidden])', { timeout: 60000 });

  // 1) 새 문서에 글쓰기
  await page.click('#btnNew');
  await page.waitForSelector('#work:not([hidden])');
  await page.click('#page');
  await page.keyboard.type('첫 문단입니다.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('둘째 문단 😀 끝.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('셋째');
  await saved(page);
  assert.deepStrictEqual(await texts(page), ['첫 문단입니다.', '둘째 문단 😀 끝.', '셋째']);
  assert.strictEqual(await page.evaluate(() => document.body.classList.contains('typing')), true, '쓰는 동안 도구 막대 숨김');
  await page.screenshot({ path: path.join(OUT, '1-write.png') });

  // 2) 편집 화면으로 갔다가 돌아오기
  await page.keyboard.press('Escape'); // 도구 막대 다시 보이기
  await page.click('#tabEdit');
  await page.waitForFunction(() => window.__jipilsil.S.studioFresh === true, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, '2-edit.png') });
  await page.click('#tabWrite');
  await page.waitForFunction(() => document.body.dataset.mode === 'write', null, { timeout: 30000 });
  assert.deepStrictEqual(await texts(page), ['첫 문단입니다.', '둘째 문단 😀 끝.', '셋째']);

  // 3) 서재로 돌아갔다 다시 열기(자동 저장 확인)
  await page.keyboard.press('Escape');
  await page.click('#btnBack');
  await page.waitForSelector('#library:not([hidden])');
  await page.screenshot({ path: path.join(OUT, '3-library.png') });
  await page.click('.doc-open');
  await page.waitForSelector('#work:not([hidden])');
  assert.deepStrictEqual(await texts(page), ['첫 문단입니다.', '둘째 문단 😀 끝.', '셋째']);
  await page.click('#btnBack');
  await page.waitForSelector('#library:not([hidden])');

  // 4) 기존 HWPX(표 포함) 열어서 고치기
  await page.setInputFiles('#fileInput', path.join(__dirname, '..', 'fixtures', 'sample.hwpx'));
  await page.waitForSelector('#work:not([hidden])');
  const before = await texts(page);
  console.log('원본 문단:', JSON.stringify(before));
  assert.ok(before.includes('[잠금]'), '표 문단은 잠금 표시');
  // 첫 문단 앞에 새 문단, 셋째 문단 수정, 넷째 문단 삭제
  await page.evaluate(() => {
    const ps = document.querySelectorAll('#page > p');
    const sel = getSelection();
    const r = document.createRange(); r.setStart(ps[0].firstChild, 0); r.collapse(true);
    sel.removeAllRanges(); sel.addRange(r);
  });
  await page.keyboard.type('맨 앞에 넣은 문단');
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    const ps = document.querySelectorAll('#page > p');
    const t = ps[3].firstChild; // 원래 셋째({{H1}})
    const r = document.createRange(); r.setStart(t, t.length); r.collapse(true);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  });
  await page.keyboard.type(' 고침');
  await page.evaluate(() => {
    const ps = document.querySelectorAll('#page > p');
    const r = document.createRange(); r.selectNodeContents(ps[4]); // 원래 넷째({{ITEM}})
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  });
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await saved(page);
  const edited = await texts(page);
  console.log('고친 문단:', JSON.stringify(edited));
  const expected = ['맨 앞에 넣은 문단', before[0], before[1], before[2] + ' 고침', ...before.slice(4)];
  assert.deepStrictEqual(edited, expected);

  // 엔진에 실제로 반영됐는지: 편집 화면 왕복 후에도 같아야 한다
  await page.keyboard.press('Escape'); // 도구 막대 다시 보이기
  await page.click('#tabEdit');
  await page.waitForFunction(() => window.__jipilsil.S.studioFresh === true, null, { timeout: 90000 });
  // 편집기 안에서: 전체 선택 → 굵게, 줄 간격 200%, 그리고 글자 입력
  const studio = page.frameLocator('#edit iframe');
  await studio.locator('canvas.document-page-canvas').first().click({ position: { x: 300, y: 120 } });
  await page.keyboard.press('Control+a');
  // 제목이 이미 굵은 글씨라 첫 클릭은 "굵게 해제", 둘째 클릭이 "전체 굵게"가 된다.
  await studio.locator('#btn-bold').click();
  await studio.locator('#btn-bold').click();
  const fonts = await studio.locator('#font-name option').allTextContents();
  console.log('글꼴 선택지(일부):', fonts.slice(0, 8).join(', '), `… 총 ${fonts.length}개`);
  const spacing = studio.locator('#linespacing-select');
  const spacingOptions = await spacing.locator('option').allTextContents();
  console.log('줄 간격 선택지:', spacingOptions.join(', '));
  await spacing.selectOption({ label: spacingOptions.find((t) => t.includes('200')) });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, '4-edit-sample.png') });
  await page.click('#tabWrite');
  await page.waitForFunction(() => document.body.dataset.mode === 'write', null, { timeout: 30000 });
  assert.deepStrictEqual(await texts(page), expected);

  // 5) 내보내기
  await page.keyboard.press('Escape');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnExport')]);
  const file = path.join(OUT, 'exported.hwpx');
  await dl.saveAs(file);
  console.log('내보낸 파일:', dl.suggestedFilename(), fs.statSync(file).size, 'bytes');
  // 편집기에서 준 서식(굵게·줄 간격 200%)이 내보낸 파일에 들어 있는지 엔진으로 다시 열어 확인
  const fmt = await page.evaluate(async (b64) => {
    const { openDocument } = await import('./js/engine.js');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const d = openDocument(bytes);
    try {
      const n = d.getParagraphCount(0);
      const rows = [];
      for (let i = 0; i < n; i++) {
        if (!d.getParagraphLength(0, i)) continue;
        rows.push({ bold: JSON.parse(d.getCharPropertiesAt(0, i, 1)).bold, spacing: JSON.parse(d.getParaPropertiesAt(0, i)).lineSpacing });
      }
      return rows;
    } finally { d.free(); }
  }, fs.readFileSync(file).toString('base64'));
  console.log('내보낸 파일의 문단별 서식:', JSON.stringify(fmt));
  assert.ok(fmt.every((r) => r.bold === true), '굵게가 저장됨');
  assert.ok(fmt.every((r) => r.spacing === 200), '줄 간격 200%가 저장됨');

  await page.screenshot({ path: path.join(OUT, '5-write-sample.png') });
  await browser.close();
  if (errors.length) { console.log('콘솔 오류:\n' + errors.join('\n')); process.exitCode = 1; }
  else console.log('통과');
})().catch((e) => { console.error(e); process.exit(1); });
