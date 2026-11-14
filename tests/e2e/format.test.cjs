// 성공 기준 3·4 — 편집에서 준 굵게·줄 간격 200%·글꼴이, 집필에서 그 문단의 중간 글자를 고친 뒤에도
// 내보낸 파일에 남아 있다.
const assert = require('assert');
const h = require('./helpers.cjs');

h.main('format', async ({ page }) => {
  await h.newDoc(page);
  await page.keyboard.type('첫째 문단 가나다라마바사');
  await page.keyboard.press('Enter');
  await page.keyboard.type('둘째 문단은 건드리지 않는다');
  await h.saved(page);

  // 편집: 전체 선택 → 굵게, 줄 간격 200%, 글꼴 바꾸기
  const studio = await h.toEdit(page);
  await studio.locator('canvas.document-page-canvas').first().click({ position: { x: 300, y: 300 } });
  await page.keyboard.press('Control+a');
  await studio.locator('#btn-bold').click();
  await studio.locator('#linespacing-select').selectOption({ label: '200 %' });
  const fontOptions = await studio.locator('#font-name option').evaluateAll((os) => os.map((o) => ({ value: o.value, label: o.textContent.trim() })));
  const before = await studio.locator('#font-name').inputValue();
  const target = fontOptions.find((o) => o.label === '나눔고딕' && o.value !== before) || fontOptions.find((o) => o.value !== before && !o.label.startsWith('◆'));
  assert.ok(target, `바꿀 글꼴 선택지가 있어야 함: ${JSON.stringify(fontOptions)}`);
  await studio.locator('#font-name').selectOption(target.value);
  await page.waitForTimeout(600);
  console.log(`글꼴: ${before} → ${target.label}`);

  // 집필: 첫 문단의 중간(셋째 글자 뒤)에 'XY'를 끼우고, 바로 뒤 글자('문')를 지운다
  await h.toWrite(page);
  await h.setCaret(page, 0, 3);
  await page.keyboard.type('XY');
  await page.keyboard.press('Delete');
  await h.saved(page);
  assert.deepStrictEqual(await h.texts(page), ['첫째 XY단 가나다라마바사', '둘째 문단은 건드리지 않는다']);

  const file = await h.exportTo(page, 'format.hwpx');
  const got = await h.inspect(page, file, (doc) => {
    const at = (para, offset) => {
      const c = JSON.parse(doc.getCharPropertiesAt(0, para, offset));
      return { bold: c.bold, font: c.fontFamily };
    };
    const len = (para) => doc.getParagraphLength(0, para);
    return {
      text: [0, 1].map((p) => doc.getTextRange(0, p, 0, len(p))),
      spacing: [0, 1].map((p) => JSON.parse(doc.getParaPropertiesAt(0, p)).lineSpacing),
      // 첫 문단: 앞쪽 원래 글자, 새로 끼운 글자, 뒤쪽 원래 글자 / 둘째 문단: 가운데 글자
      chars: [at(0, 1), at(0, 4), at(0, 5), at(0, len(0) - 1), at(1, 5)],
    };
  });
  console.log('내보낸 파일:', JSON.stringify(got));
  assert.deepStrictEqual(got.text, ['첫째 XY단 가나다라마바사', '둘째 문단은 건드리지 않는다']);
  assert.deepStrictEqual(got.spacing, [200, 200], '줄 간격 200%');
  for (const c of got.chars) {
    assert.strictEqual(c.bold, true, '굵게');
    assert.strictEqual(c.font, target.label, '글꼴');
  }
});
