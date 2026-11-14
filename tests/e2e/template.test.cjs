// 성공 기준 6 — 기존 양식 유지: 표가 든 HWPX를 열어 집필에서 문단을 추가·수정·삭제해도
// 표의 줄·칸 수와 셀 내용이 그대로다.
const assert = require('assert');
const path = require('path');
const h = require('./helpers.cjs');

h.main('template', async ({ page }) => {
  const original = h.tables(h.sectionXml(path.join(h.FIXTURES, 'sample.hwpx')));
  assert.strictEqual(original.length, 1, '시험 파일에 표가 하나 있어야 함');

  await h.openFixture(page, 'sample.hwpx');
  const before = await h.texts(page);
  assert.deepStrictEqual(before, ['{{TITLE}}', '{{SUBTITLE}}', '{{H1}}', '{{ITEM}}', '[잠금]', '{{H2}}']);

  // 맨 앞에 문단 추가
  await h.setCaret(page, 0, 0);
  await page.keyboard.type('맨 앞에 넣은 문단');
  await page.keyboard.press('Enter');
  // {{H1}} 끝에 덧붙이기
  await h.setCaret(page, 3);
  await page.keyboard.type(' 고침');
  // {{ITEM}} 문단 삭제(글자를 지우고 한 번 더 지워 문단을 없앤다)
  await h.selectPara(page, 4);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  // 표 바로 앞과 바로 뒤에 새 문단(표와 맞닿은 자리)
  await h.setCaret(page, 3);
  await page.keyboard.press('Enter');
  await page.keyboard.type('표 바로 앞');
  await h.setCaret(page, 6, 0);
  await page.keyboard.type('표 바로 뒤');
  await page.keyboard.press('Enter');
  // 표 뒤 문단 다음에 새 문단
  await h.setCaret(page, (await h.texts(page)).length - 1);
  await page.keyboard.press('Enter');
  await page.keyboard.type('맨 끝에 넣은 문단');
  await h.saved(page);

  const expected = ['맨 앞에 넣은 문단', '{{TITLE}}', '{{SUBTITLE}}', '{{H1}} 고침', '표 바로 앞', '[잠금]', '표 바로 뒤', '{{H2}}', '맨 끝에 넣은 문단'];
  assert.deepStrictEqual(await h.texts(page), expected);

  // 편집 화면을 다녀와도 같다
  await h.toEdit(page);
  await h.toWrite(page);
  assert.deepStrictEqual(await h.texts(page), expected);

  const file = await h.exportTo(page, 'template.hwpx');
  assert.deepStrictEqual(h.tables(h.sectionXml(file)), original, '표의 줄·칸·셀 글자가 원본과 같음');
  const text = await h.inspect(page, file, (doc) =>
    Array.from({ length: doc.getParagraphCount(0) }, (_, p) => doc.getTextRange(0, p, 0, doc.getParagraphLength(0, p))));
  assert.deepStrictEqual(text, expected.map((t) => (t === '[잠금]' ? '' : t)), '내보낸 파일의 문단 순서와 글');
});
