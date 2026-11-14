// 성공 기준 1 — 집필 집중: 글자를 입력하면 도구 막대가 사라지고, 글 바깥을 누르면 다시 나타난다.
// 쓰는 문단만 또렷하고, 타자기 스크롤이 커서 줄 높이를 유지한다.
const assert = require('assert');
const h = require('./helpers.cjs');

const barVisible = (page) => page.$eval('#bar', (el) => {
  const s = getComputedStyle(el);
  return s.opacity !== '0' && s.pointerEvents !== 'none';
});
const opacity = (page, index) => page.$eval(`#page > p:nth-child(${index + 1})`, (el) => Number(getComputedStyle(el).opacity));
const caretTop = (page) => page.evaluate(() => getSelection().getRangeAt(0).getClientRects()[0]?.top
  ?? document.querySelector('#page > p.cur').getBoundingClientRect().top);

h.main('focus', async ({ page }) => {
  await h.newDoc(page);
  assert.strictEqual(await barVisible(page), true, '쓰기 전에는 도구 막대가 보임');

  await page.keyboard.type('첫 문단');
  await page.keyboard.press('Enter');
  await page.keyboard.type('둘째 문단');
  await page.waitForTimeout(600); // 사라지는 전환(0.35초)이 끝날 때까지
  assert.strictEqual(await barVisible(page), false, '입력하면 도구 막대가 사라짐');
  assert.ok(await opacity(page, 0) < 0.5, '쓰지 않는 문단은 흐려짐');
  assert.strictEqual(await opacity(page, 1), 1, '쓰는 문단은 또렷함');

  // 글 바깥(왼쪽 여백)을 누르면 돌아온다
  await page.mouse.click(20, 500);
  await page.waitForTimeout(600);
  assert.strictEqual(await barVisible(page), true, '글 바깥을 누르면 도구 막대가 다시 보임');
  assert.strictEqual(await opacity(page, 0), 1, '도구 막대가 보이는 동안은 모든 문단이 또렷함');

  // 타자기 스크롤: 화면을 넘길 만큼 써도 커서 줄이 같은 높이에 머문다
  await h.setCaret(page, 1);
  const tops = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(`줄 ${i}`);
    if (i >= 30) tops.push(Math.round(await caretTop(page)));
  }
  const height = page.viewportSize().height;
  console.log('커서 줄의 화면 높이(px):', tops.join(', '), `/ 화면 ${height}`);
  assert.ok(Math.max(...tops) - Math.min(...tops) <= 8, '커서 줄 높이가 유지됨');
  assert.ok(tops[0] > height * 0.3 && tops[0] < height * 0.55, '커서 줄이 화면 가운데 조금 위에 있음');

  // 타자기 스크롤을 끄면 따라 움직이지 않는다
  await page.mouse.click(20, 500);
  await page.click('#btnLook');
  await page.uncheck('#optTypewriter');
  await page.mouse.click(20, 500);
  await page.evaluate(() => { document.querySelector('#write').scrollTop = 0; });
  await h.setCaret(page, 0);
  const scrollBefore = await page.$eval('#write', (el) => el.scrollTop);
  await page.keyboard.type(' 덧붙임');
  assert.strictEqual(await page.$eval('#write', (el) => el.scrollTop), scrollBefore, '끄면 스크롤이 움직이지 않음');
});
