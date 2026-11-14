// 성공 기준 5 — 표 편집: 편집에서 표를 만들고, 줄을 추가하고, 셀에 글자를 넣고 내보내면
// 파일의 표가 그 줄 수와 글자를 갖고 있다.
const assert = require('assert');
const h = require('./helpers.cjs');

h.main('table', async ({ page }) => {
  await h.newDoc(page);
  await page.keyboard.type('표 위 문단');
  await h.saved(page);

  const studio = await h.toEdit(page);
  await studio.locator('canvas.document-page-canvas').first().click({ position: { x: 300, y: 300 } });

  // 표 만들기: 도구막대의 표 단추 → 격자에서 2줄 3칸 고르기
  await studio.locator('button[data-cmd="table:create"]').click();
  // 격자 칸은 단추 바로 아래 18px 간격으로 놓인다(편집기 0.9.0 기준). 2줄째·3칸째 칸을 누른다.
  const box = await studio.locator('button[data-cmd="table:create"]').boundingBox();
  await page.mouse.click(box.x + 8 + 2 * 18, box.y + 106 + 1 * 18);
  await page.waitForTimeout(600);

  // 첫 셀에 글자, 아래에 줄 하나 추가, 다음 셀로 가서 글자
  await page.keyboard.type('셀A');
  await studio.locator('.menu-item[data-menu="table"]').click();
  await studio.locator('.md-item[data-cmd="table:insert-row-col"]').click();
  await studio.locator('.modal-overlay input[value="row-below"]').check();
  await studio.locator('.modal-overlay input[type="number"]').fill('1');
  await studio.locator('.modal-overlay .dialog-btn-primary').click();
  await page.waitForTimeout(600);
  await page.keyboard.press('Tab');
  await page.keyboard.type('셀B');
  await page.waitForTimeout(400);

  // 집필 화면에서는 표가 자리 표시로 보이고, 표 위 문단은 그대로다
  await h.toWrite(page);
  const lines = await page.$$eval('#page > p', (ps) => ps.map((p) => p.textContent));
  assert.strictEqual(lines[0], '표 위 문단');
  assert.ok(lines.some((t) => t.includes('표 3×3')), `집필 화면에 표 3×3 자리 표시가 있어야 함: ${JSON.stringify(lines)}`);

  // 내보낸 파일을 직접 열어 확인
  const file = await h.exportTo(page, 'table.hwpx');
  const found = h.tables(h.sectionXml(file));
  console.log('내보낸 파일의 표:', JSON.stringify(found));
  assert.strictEqual(found.length, 1, '표가 하나');
  assert.strictEqual(found[0].length, 3, '줄 3개(2줄로 만들고 1줄 추가)');
  assert.ok(found[0].every((row) => row.length === 3), '줄마다 칸 3개');
  assert.strictEqual(found[0][0][0], '셀A');
  assert.strictEqual(found[0][0][1], '셀B');
});
