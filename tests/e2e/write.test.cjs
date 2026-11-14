// 성공 기준 2·7 — 글자 보존과 자동 저장: 한글·영문·이모지가 섞인 문단들이 5초 안에 저장되고,
// 새로 고침 뒤에도 한 자도 다르지 않다.
const assert = require('assert');
const h = require('./helpers.cjs');

const LINES = [
  '봄날, 창가에 앉아 첫 문장을 쓴다.',
  'English words & 숫자 1234, 기호 「」… — ~!@#',
  '이모지 😀👍🏽 와 가족 👨‍👩‍👧 도 한 글자처럼.',
  '',
  '  앞뒤 빈칸과	탭 문자  ',
  '마지막 문단',
];

h.main('write', async ({ page }) => {
  await h.newDoc(page);
  for (let i = 0; i < LINES.length; i++) {
    if (i > 0) await page.keyboard.press('Enter');
    // 탭은 키로 눌러야 한다(insertText는 탭 문자를 그대로 넣지 않는다)
    for (const part of LINES[i].split(/(\t)/)) {
      if (part === '\t') await page.keyboard.press('Tab');
      else if (part) await page.keyboard.insertText(part);
    }
  }
  const started = Date.now();
  await h.saved(page, 5000);
  console.log(`입력을 멈춘 뒤 ${Date.now() - started}ms 만에 저장됨`);
  assert.deepStrictEqual(await h.texts(page), LINES);

  // 서재로 나갔다가 다시 열기
  await h.wake(page);
  await page.click('#btnBack');
  await page.waitForSelector('#library:not([hidden])');
  await page.click('.doc-open');
  await page.waitForSelector('#work:not([hidden])');
  assert.deepStrictEqual(await h.texts(page), LINES, '서재에 다녀온 뒤에도 같은 글');

  // 저장 직후 새로 고침 → 서재에서 다시 열기
  await page.reload();
  await page.waitForSelector('#library:not([hidden])', { timeout: 60000 });
  await page.click('.doc-open');
  await page.waitForSelector('#work:not([hidden])');
  assert.deepStrictEqual(await h.texts(page), LINES, '새로 고침 뒤에도 같은 글');

  // 내보낸 파일에도 같은 글이 들어 있다
  const file = await h.exportTo(page, 'write.hwpx');
  const text = await h.inspect(page, file, (doc) =>
    Array.from({ length: doc.getParagraphCount(0) }, (_, p) => doc.getTextRange(0, p, 0, doc.getParagraphLength(0, p))));
  assert.deepStrictEqual(text, LINES, '내보낸 파일의 글');
});
