// 통합 테스트 공용 도우미
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8080/';
const OUT = path.join(__dirname, '..', 'out');
const FIXTURES = path.join(__dirname, '..', 'fixtures');
fs.mkdirSync(OUT, { recursive: true });

/** 브라우저를 띄우고 서재 화면까지 간다. 콘솔 오류는 errors에 모은다. */
async function launch(contextOptions = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true, ...contextOptions });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE);
  await page.waitForSelector('#library:not([hidden])', { timeout: 60000 });
  return { browser, ctx, page, errors };
}

const texts = (page) => page.$$eval('#page > p', (ps) => ps.map((p) => (p.classList.contains('locked') ? '[잠금]' : p.textContent)));
const saved = (page, timeout = 30000) =>
  page.waitForFunction(() => document.querySelector('#status').textContent === '저장됨', null, { timeout });
/** 쓰는 동안 숨은 도구 막대를 다시 보이게 한다. */
const wake = (page) => page.keyboard.press('Escape');

async function newDoc(page) {
  await page.click('#btnNew');
  await page.waitForSelector('#work:not([hidden])');
  await page.click('#page');
}

async function openFixture(page, name) {
  await page.setInputFiles('#fileInput', path.join(FIXTURES, name));
  await page.waitForSelector('#work:not([hidden])');
}

/** 편집 화면으로 가서 편집기 iframe을 돌려준다. */
async function toEdit(page) {
  await wake(page);
  await page.click('#tabEdit');
  await page.waitForFunction(() => document.body.dataset.mode === 'edit' && window.__jipilsil.S.studioFresh === true, null, { timeout: 90000 });
  return page.frameLocator('#edit iframe');
}

async function toWrite(page) {
  await page.click('#tabWrite');
  await page.waitForFunction(() => document.body.dataset.mode === 'write', null, { timeout: 30000 });
}

/** 내보내기를 눌러 받은 HWPX의 경로를 돌려준다. */
async function exportTo(page, name) {
  await wake(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnExport')]);
  const file = path.join(OUT, name);
  await dl.saveAs(file);
  return file;
}

/**
 * 내보낸 파일을 앱과 별개로 엔진에 다시 열어 fn(doc)의 결과를 돌려준다.
 * fn은 브라우저 안에서 실행되므로 바깥 변수를 쓸 수 없다. arg로 넘길 것.
 */
function inspect(page, file, fn, arg) {
  return page.evaluate(async ({ b64, src, arg }) => {
    const { openDocument } = await import('./js/engine.js');
    const doc = openDocument(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    try { return (0, eval)(`(${src})`)(doc, arg); } finally { doc.free(); }
  }, { b64: fs.readFileSync(file).toString('base64'), src: fn.toString(), arg });
}

/** 테스트 본문을 실행하고, 실패하거나 콘솔 오류가 있으면 종료 코드 1. */
async function main(name, body, contextOptions) {
  const env = await launch(contextOptions);
  try {
    await body(env);
    if (env.errors.length) throw new Error(`콘솔 오류:\n${env.errors.join('\n')}`);
    console.log(`통과: ${name}`);
  } catch (err) {
    await env.page.screenshot({ path: path.join(OUT, `FAIL-${name}.png`) }).catch(() => {});
    console.error(`실패: ${name}\n`, err);
    process.exitCode = 1;
  } finally {
    await env.browser.close();
  }
}

module.exports = { BASE, OUT, FIXTURES, launch, texts, saved, wake, newDoc, openFixture, toEdit, toWrite, exportTo, inspect, main };

/** HWPX(zip) 안의 본문 XML을 엔진을 거치지 않고 직접 읽는다(엔진과 독립된 확인용). */
function sectionXml(file, index = 0) {
  return require('child_process').execFileSync('unzip', ['-p', file, `Contents/section${index}.xml`], { encoding: 'utf8', maxBuffer: 1 << 28 });
}

/** 본문 XML에서 표들을 [[셀 글, ...], ...](줄 단위) 목록으로 뽑는다. 중첩 표는 다루지 않는다. */
function tables(xml) {
  return [...xml.matchAll(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g)].map(([tbl]) =>
    [...tbl.matchAll(/<hp:tr\b[\s\S]*?<\/hp:tr>/g)].map(([tr]) =>
      [...tr.matchAll(/<hp:tc\b[\s\S]*?<\/hp:tc>/g)].map(([tc]) =>
        [...tc.matchAll(/<hp:t\b[^>]*>([^<]*)<\/hp:t>/g)].map((m) => m[1]).join(''))));
}

module.exports.sectionXml = sectionXml;
module.exports.tables = tables;

/** 집필 화면의 n번째 문단, offset번째 글자 앞에 커서를 둔다(offset 생략 시 문단 끝). */
function setCaret(page, index, offset) {
  return page.evaluate(({ index, offset }) => {
    const p = document.querySelectorAll('#page > p')[index];
    const node = p.firstChild && p.firstChild.nodeType === 3 ? p.firstChild : p;
    const range = document.createRange();
    range.setStart(node, node.nodeType === 3 ? (offset ?? node.length) : 0);
    range.collapse(true);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.querySelector('#page').focus();
  }, { index, offset });
}

/** 집필 화면의 n번째 문단 전체를 선택한다. */
function selectPara(page, index) {
  return page.evaluate((index) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelectorAll('#page > p')[index]);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }, index);
}

module.exports.setCaret = setCaret;
module.exports.selectPara = selectPara;
