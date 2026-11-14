// 글을 잃거나 엉뚱한 곳에 쓰게 되는 상황들(코드 리뷰에서 나온 재현 사례).
const assert = require('assert');
const h = require('./helpers.cjs');

h.main('safety', async ({ page, errors }) => {
  // 1) 화면을 다시 그려야 하는 저장 뒤에도 커서가 제자리에 있다.
  //    쪽 설정이 든 첫 문단은 지울 수 없어 "전체 선택 후 새로 쓰기"는 다시 그리기를 일으킨다.
  await h.openFixture(page, 'sample.hwpx');
  await page.click('#page');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Z');
  await h.saved(page);
  await page.keyboard.type('Y');
  await h.saved(page);
  const afterRewrite = await h.texts(page);
  assert.strictEqual(afterRewrite[0], 'ZY', `저장 뒤 이어 친 글자가 같은 자리에 붙는다: ${JSON.stringify(afterRewrite)}`);
  assert.ok(afterRewrite.includes('[잠금]'), '화면에서 지워진 표 자리 표시가 되살아난다');

  // 2) 표 자리 표시 바로 뒤 문단의 맨 앞에서 Backspace를 눌러도 글이 표 앞으로 넘어가지 않는다.
  await h.wake(page);
  await page.click('#btnBack');
  await page.waitForSelector('#library:not([hidden])');
  await h.openFixture(page, 'sample.hwpx');
  const before = await h.texts(page);
  await h.setCaret(page, 5, 0); // 표 뒤의 {{H2}} 맨 앞
  await page.keyboard.press('Backspace');
  assert.deepStrictEqual(await h.texts(page), before, '표 뒤 문단 맨 앞에서 Backspace는 아무것도 바꾸지 않음');
  await h.setCaret(page, 3); // 표 앞의 {{ITEM}} 맨 끝
  await page.keyboard.press('Delete');
  assert.deepStrictEqual(await h.texts(page), before, '표 앞 문단 맨 끝에서 Delete는 아무것도 바꾸지 않음');

  // 3) 저장이 실패하면 "저장됨"이라고 하지 않고, 서재로 나가려 할 때 물어본다.
  await page.evaluate(() => {
    window.__realPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new DOMException('저장 공간 부족(테스트)', 'QuotaExceededError'); };
  });
  await h.setCaret(page, 5);
  await page.keyboard.type(' 저장 안 된 글');
  await page.waitForFunction(() => document.querySelector('#status').textContent === '저장 실패', null, { timeout: 15000 });
  const dialogs = [];
  page.once('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await h.wake(page);
  await page.click('#btnBack');
  await page.waitForTimeout(1500);
  assert.strictEqual(dialogs.length, 1, '닫기 전에 확인 창이 뜬다');
  assert.strictEqual(await page.$eval('#work', (el) => el.hidden), false, '취소하면 작업 화면에 남는다');
  assert.strictEqual((await h.texts(page))[5], '{{H2}} 저장 안 된 글', '쓴 글이 화면에 그대로 있다');

  // 저장이 다시 되면 정상으로 돌아온다
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.__realPut; });
  await h.setCaret(page, 5);
  await page.keyboard.type('!');
  await h.saved(page);
  await h.wake(page);
  await page.click('#btnBack');
  await page.waitForSelector('#library:not([hidden])');
  await page.click('.doc-open');
  await page.waitForSelector('#work:not([hidden])');
  assert.strictEqual((await h.texts(page))[5], '{{H2}} 저장 안 된 글!', '다시 저장된 글이 남아 있다');

  // 4) 쉬지 않고 계속 써도(2.5초 이상 멈추지 않아도) 15초쯤마다는 저장된다.
  await page.evaluate(() => {
    window.__puts = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) { window.__puts++; return put.apply(this, args); };
  });
  await h.setCaret(page, 5);
  for (let i = 0; i < 19; i++) {
    await page.keyboard.type('가');
    await page.waitForTimeout(1000);
  }
  assert.ok(await page.evaluate(() => window.__puts) >= 1, '19초 동안 1초 간격으로 쓰는 사이에 저장이 한 번은 일어난다');

  // 5) 개발 서버는 숨김 파일을 내주지 않는다(같은 와이파이의 기기가 .git을 읽지 못하게).
  const status = await page.evaluate(async () => (await fetch('.git/HEAD')).status);
  assert.strictEqual(status, 403);

  // 일부러 낸 저장 실패와 403의 콘솔 오류는 이 테스트에서 정상이다.
  errors.length = 0;
});
