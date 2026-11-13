// 집필실 — 집필(집중해서 글만 쓰기) ↔ 편집(rhwp 편집기로 서식·표 다듬기)을 오가는 앱 본체.
import { initEngine, openDocument, blankDocumentBytes, readSections, syncSection } from './engine.js';
import { listDocs, getDoc, putDoc, deleteDoc, newId, requestPersistence } from './store.js';
import { STUDIO_URL } from './config.js';
import { createEditor } from '../vendor/rhwp-editor/index.js';

const $ = (sel) => document.querySelector(sel);
const page = $('#page');
const writeBox = $('#write');

const S = {
  id: null,          // 열려 있는 문서의 서재 ID
  name: '',
  doc: null,         // 엔진 문서 객체(집필 화면의 원본)
  orig: [],          // 마지막으로 엔진에서 읽은 구역별 문단 목록
  mode: 'write',
  writeDirty: false, // 집필 화면에 엔진으로 아직 안 넘긴 변경이 있음
  studio: null,      // rhwp 편집기(iframe)
  studioFresh: false,// 편집기가 지금 문서와 같은 내용을 들고 있음
  composing: false,  // 한글 조합 중
  chars: 0,
};

/* ── 공통 도우미 ─────────────────────────────────────────── */

let chain = Promise.resolve();
/** 문서를 건드리는 작업은 한 번에 하나씩 순서대로 실행한다. */
const serial = (fn) => (chain = chain.catch(() => {}).then(fn));

let toastTimer = 0;
function toast(msg, ms = 3200) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function fail(what, err) {
  console.error(what, err);
  toast(`${what}: ${err?.message || err}`, 6000);
}

function show(screen) {
  document.body.dataset.screen = screen;
  $('#loading').hidden = screen !== 'loading';
  $('#library').hidden = screen !== 'library';
  $('#work').hidden = screen !== 'work';
}

const setStatus = (text) => { $('#status').textContent = text; };

/* ── 집필 화면: 문서 → 화면 ─────────────────────────────── */

function renderWrite() {
  const keepScroll = writeBox.scrollTop;
  const frag = document.createDocumentFragment();
  S.orig.forEach((paras, s) => {
    paras.forEach((para, i) => {
      const p = document.createElement('p');
      p.dataset.k = `${s}:${i}`;
      if (para.lock) {
        p.className = 'locked';
        p.contentEditable = 'false';
        p.textContent = `▦ ${para.lock} — 편집 화면에서 고칠 수 있습니다`;
      } else if (para.text) {
        p.textContent = para.text;
      } else {
        p.appendChild(document.createElement('br'));
      }
      frag.appendChild(p);
    });
  });
  page.replaceChildren(frag);
  writeBox.scrollTop = keepScroll;
  updateCount();
}

/* ── 집필 화면: 화면 → 문서 ─────────────────────────────── */

/** 화면의 문단들을 순서대로 모은다. 브라우저가 만든 엉뚱한 구조(div 중첩 등)도 문단으로 풀어낸다. */
function collectParas(root, out = []) {
  for (const node of root.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.data.trim()) out.push({ el: null, text: node.data });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.tagName === 'BR') {
        if (root === page) out.push({ el: null, text: '' });
      } else if (node.querySelector(':scope > p, :scope > div')) {
        collectParas(node, out);
      } else {
        out.push({ el: node, text: node.textContent, locked: node.classList.contains('locked') });
      }
    }
  }
  return out;
}

function parseKey(el) {
  const m = /^(\d+):(\d+)$/.exec(el?.dataset?.k || '');
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** 집필 화면의 변경을 엔진 문서에 반영한다. */
function commitWrite() {
  if (!S.writeDirty || !S.doc) return;
  const items = collectParas(page);
  const perSec = S.orig.map(() => []);
  let sec = 0;
  for (const it of items) {
    const key = it.el ? parseKey(it.el) : null;
    if (key && key[0] >= sec && key[0] < perSec.length) {
      sec = key[0];
      perSec[sec].push({ k: key[1], text: it.text });
    } else if (!it.locked) {
      perSec[sec].push({ k: null, text: it.text });
    }
  }
  // 뒤 구역부터 반영(구역 사이에는 번호가 섞이지 않지만 순서를 고정해 둔다).
  for (let s = perSec.length - 1; s >= 0; s--) syncSection(S.doc, s, S.orig[s], perSec[s]);

  S.orig = readSections(S.doc);
  S.writeDirty = false;
  S.studioFresh = false;

  // 화면의 문단과 문서의 문단이 1:1로 맞으면 번호표만 새로 붙이고(커서 유지), 아니면 다시 그린다.
  const flat = S.orig.flatMap((paras, s) => paras.map((para, i) => ({ para, k: `${s}:${i}` })));
  const same = flat.length === items.length && flat.every(({ para }, n) => {
    const it = items[n];
    return it.el && (para.lock ? it.locked : !it.locked && it.text === para.text);
  });
  if (same) flat.forEach(({ k }, n) => { items[n].el.dataset.k = k; });
  else renderWrite();
}

/* ── 저장 ───────────────────────────────────────────────── */

async function currentBytes() {
  if (S.mode === 'edit' && S.studio) return new Uint8Array(await S.studio.exportHwpx());
  commitWrite();
  return S.doc.exportHwpx();
}

async function saveNow() {
  if (!S.id) return;
  setStatus('저장 중…');
  try {
    const bytes = await currentBytes();
    await putDoc({ id: S.id, name: S.name, updated: Date.now(), chars: S.chars, bytes });
    if (S.mode === 'edit' && S.studio) await S.studio.notifySaved().catch(() => {});
    setStatus('저장됨');
  } catch (err) {
    setStatus('저장 실패');
    fail('저장하지 못했습니다', err);
  }
}

let saveTimer = 0;
function scheduleSave(delay = 2500) {
  setStatus('고치는 중…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (S.composing) { scheduleSave(800); return; }
    serial(saveNow);
  }, delay);
}

function flushSave() {
  clearTimeout(saveTimer);
  return serial(saveNow);
}

/* ── 문서 열기·닫기 ─────────────────────────────────────── */

function loadIntoWrite(bytes) {
  const doc = openDocument(bytes); // 열 수 없는 파일이면 여기서 예외
  S.doc?.free();
  S.doc = doc;
  S.orig = readSections(doc);
  S.writeDirty = false;
  renderWrite();
}

async function openFromLibrary(id) {
  const rec = await getDoc(id);
  if (!rec) throw new Error('문서를 찾을 수 없습니다');
  loadIntoWrite(rec.bytes);
  S.id = rec.id;
  S.name = rec.name;
  S.studioFresh = false;
  $('#title').value = rec.name;
  setMode('write');
  show('work');
  setStatus('저장됨');
  document.body.classList.remove('typing');
  writeBox.scrollTop = 0;
}

async function createAndOpen(name, bytes) {
  openDocument(bytes).free(); // 먼저 열리는지 확인
  const id = newId();
  await putDoc({ id, name, updated: Date.now(), chars: 0, bytes });
  await openFromLibrary(id);
}

async function closeToLibrary() {
  clearTimeout(saveTimer);
  await saveNow(); // 이미 순서 대기열 안에서 실행 중이므로 flushSave()를 부르면 서로 기다리게 된다
  S.id = null;
  S.doc?.free();
  S.doc = null;
  page.replaceChildren();
  $('#look').hidden = true;
  await refreshLibrary();
  show('library');
}

/* ── 집필 ↔ 편집 전환 ───────────────────────────────────── */

function setMode(mode) {
  S.mode = mode;
  document.body.dataset.mode = mode;
  $('#tabWrite').setAttribute('aria-selected', String(mode === 'write'));
  $('#tabEdit').setAttribute('aria-selected', String(mode === 'edit'));
  $('#edit').hidden = mode !== 'edit';
  $('#look').hidden = true;
  if (mode === 'edit') document.body.classList.remove('typing');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 편집기가 쪽을 실제로 그렸는지(같은 출처의 iframe이라 들여다볼 수 있다). */
function studioRendered() {
  try {
    return !!$('#edit iframe')?.contentDocument?.querySelector('canvas.document-page-canvas');
  } catch {
    return true; // 들여다볼 수 없으면 그려진 것으로 본다
  }
}

/**
 * 문서를 편집기에 넘긴다. 편집기가 막 켜진 직후에는 넘긴 문서가 화면에 그려지지 않는
 * 경우가 있어(rhwp 0.9.0의 시작 타이밍 문제), 그려졌는지 확인하고 안 됐으면 다시 넘긴다.
 */
async function loadIntoStudio() {
  for (let attempt = 0; attempt < 4; attempt++) {
    await S.studio.loadFile(S.doc.exportHwpx(), `${S.name || '문서'}.hwpx`, { skipUnsavedGuard: true });
    for (let i = 0; i < 15; i++) {
      if (studioRendered()) return;
      await sleep(100);
    }
  }
  throw new Error('편집기가 문서를 화면에 그리지 못했습니다. 집필 화면으로 갔다가 다시 시도해 주세요');
}

async function enterEdit() {
  if (S.mode === 'edit') return;
  commitWrite();
  setStatus('편집기 여는 중…');
  setMode('edit'); // 편집기는 화면에 보이는 상태에서 만들어야 크기를 제대로 잡는다
  try {
    if (!S.studio) {
      S.studio = await createEditor($('#edit'), { studioUrl: STUDIO_URL });
      S.studio.onDocumentChanged?.(() => { if (S.mode === 'edit') scheduleSave(3000); });
    }
    if (!S.studioFresh) {
      await loadIntoStudio();
      S.studioFresh = true;
    }
    setStatus('저장됨');
  } catch (err) {
    setMode('write');
    fail('편집기를 열지 못했습니다', err);
  }
}

async function enterWrite() {
  if (S.mode === 'write') return;
  clearTimeout(saveTimer);
  setStatus('집필 화면으로…');
  try {
    // 편집기에서 다듬은 결과를 통째로 받아 집필 화면의 원본으로 삼는다.
    const bytes = new Uint8Array(await S.studio.exportHwpx());
    loadIntoWrite(bytes);
    await putDoc({ id: S.id, name: S.name, updated: Date.now(), chars: S.chars, bytes });
    await S.studio.notifySaved().catch(() => {});
    setMode('write');
    setStatus('저장됨');
  } catch (err) {
    fail('집필 화면으로 돌아오지 못했습니다', err);
  }
}

/* ── 내보내기 ───────────────────────────────────────────── */

function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function exportFile() {
  const bytes = await currentBytes();
  const file = new File([bytes], `${S.name || '문서'}.hwpx`, { type: 'application/vnd.hancom.hwpx' });
  // 아이패드에서는 공유 시트가 떠서 "파일에 저장"이나 다른 앱으로 보낼 수 있다.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return; // 사용자가 취소
    }
  }
  download(file);
  toast('HWPX 파일을 내려받았습니다');
}

/* ── 서재 ───────────────────────────────────────────────── */

const dateFmt = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });

async function refreshLibrary() {
  const docs = await listDocs();
  const list = $('#docList');
  list.replaceChildren();
  for (const d of docs) {
    const li = document.createElement('li');
    const open = document.createElement('button');
    open.className = 'doc-open';
    const name = document.createElement('span');
    name.className = 'doc-name';
    name.textContent = d.name || '제목 없음';
    const meta = document.createElement('span');
    meta.className = 'doc-meta';
    meta.textContent = `${dateFmt.format(d.updated)} · ${(d.chars || 0).toLocaleString('ko-KR')}자`;
    open.append(name, meta);
    open.addEventListener('click', () => serial(() => openFromLibrary(d.id)).catch((e) => fail('문서를 열지 못했습니다', e)));
    const del = document.createElement('button');
    del.className = 'doc-del';
    del.textContent = '삭제';
    del.setAttribute('aria-label', `${d.name} 삭제`);
    del.addEventListener('click', async () => {
      if (!confirm(`"${d.name}" 문서를 이 기기에서 삭제할까요?\n내보내지 않은 내용은 되돌릴 수 없습니다.`)) return;
      await deleteDoc(d.id);
      refreshLibrary();
    });
    li.append(open, del);
    list.appendChild(li);
  }
  $('#emptyHint').hidden = docs.length > 0;
}

function untitledName() {
  const d = new Date();
  return `새 글 ${d.getMonth() + 1}-${d.getDate()}`;
}

/* ── 집필 화면의 동작(집중·타자기 스크롤·글자 수) ───────── */

function updateCount() {
  let n = 0;
  for (const p of page.children) if (!p.classList.contains('locked')) n += Array.from(p.textContent).length;
  S.chars = n;
  $('#count').textContent = `${n.toLocaleString('ko-KR')}자`;
}

function currentPara() {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount || !page.contains(sel.anchorNode)) return null;
  let node = sel.anchorNode;
  while (node && node.parentNode !== page) node = node.parentNode;
  return node && node.nodeType === Node.ELEMENT_NODE ? node : null;
}

function markCurrent() {
  const cur = currentPara();
  if (!cur || cur.classList.contains('cur')) return;
  page.querySelector('p.cur')?.classList.remove('cur');
  cur.classList.add('cur');
}

/** 타자기 스크롤: 커서가 있는 줄을 늘 화면의 같은 높이에 둔다. */
function typewriterScroll() {
  if (!prefs.typewriter) return;
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed || !page.contains(sel.anchorNode)) return;
  let rect = sel.getRangeAt(0).getClientRects()[0];
  if (!rect) rect = currentPara()?.getBoundingClientRect();
  if (!rect) return;
  const viewH = window.visualViewport?.height || window.innerHeight; // 화면 키보드를 뺀 높이
  const delta = rect.top - viewH * 0.42;
  if (Math.abs(delta) > 6) writeBox.scrollTop += delta;
}

let countTimer = 0;
page.addEventListener('input', () => {
  if (!page.firstChild) page.innerHTML = '<p><br></p>'; // 전부 지워도 문단 하나는 남긴다
  S.writeDirty = true;
  document.body.classList.add('typing');
  typewriterScroll();
  clearTimeout(countTimer);
  countTimer = setTimeout(updateCount, 250);
  scheduleSave();
});
page.addEventListener('compositionstart', () => { S.composing = true; });
page.addEventListener('compositionend', () => { S.composing = false; });

page.addEventListener('beforeinput', (e) => {
  // 집필 화면은 글자만 다룬다: 굵게 같은 서식 명령과 문단 안 줄바꿈은 받지 않는다.
  if (e.inputType.startsWith('format')) e.preventDefault();
  if (e.inputType === 'insertLineBreak') {
    e.preventDefault();
    document.execCommand('insertParagraph');
  }
});

page.addEventListener('paste', (e) => {
  e.preventDefault();
  const text = (e.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n');
  if (!text) return;
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (i > 0) document.execCommand('insertParagraph');
    if (line) document.execCommand('insertText', false, line);
  });
});

page.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    document.execCommand('insertText', false, '\t');
  }
});

document.addEventListener('selectionchange', () => {
  if (S.mode !== 'write' || document.body.dataset.screen !== 'work') return;
  markCurrent();
});

// 도구 막대 다시 보이기: 글 바깥을 누르거나, 마우스를 움직이거나, Esc.
const wake = () => document.body.classList.remove('typing');
document.addEventListener('pointerdown', (e) => { if (!page.contains(e.target)) wake(); });
let lastMove = null;
document.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  if (lastMove && Math.hypot(e.clientX - lastMove[0], e.clientY - lastMove[1]) > 12) wake();
  lastMove = [e.clientX, e.clientY];
});
$('#barHandle').addEventListener('click', wake);

document.addEventListener('keydown', (e) => {
  if (document.body.dataset.screen !== 'work') return;
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === 'Escape') { wake(); $('#look').hidden = true; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); flushSave(); }
  if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); serial(S.mode === 'write' ? enterEdit : enterWrite); }
});

/* ── 집필 화면 설정 ─────────────────────────────────────── */

const PREF_KEY = 'jipilsil.prefs';
const prefs = { theme: 'paper', font: 'serif', size: 19, lead: 1.9, width: 36, typewriter: true, focus: true };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); } catch { /* 저장소 사용 불가 */ }

function applyPrefs() {
  const root = document.documentElement.style;
  document.body.dataset.theme = prefs.theme;
  root.setProperty('--w-font', prefs.font === 'sans' ? 'var(--sans)' : 'var(--serif)');
  root.setProperty('--w-size', `${prefs.size}px`);
  root.setProperty('--w-lead', String(prefs.lead));
  root.setProperty('--w-width', `${prefs.width}em`);
  document.body.classList.toggle('focus-para', !!prefs.focus);
  const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim();
  if (bg) document.querySelector('meta[name="theme-color"]').content = bg;
  for (const b of $('#optTheme').children) b.classList.toggle('on', b.dataset.v === prefs.theme);
  for (const b of $('#optFont').children) b.classList.toggle('on', b.dataset.v === prefs.font);
  $('#optSize').value = prefs.size;
  $('#optLead').value = prefs.lead;
  $('#optWidth').value = prefs.width;
  $('#optTypewriter').checked = !!prefs.typewriter;
  $('#optFocus').checked = !!prefs.focus;
}

function setPref(key, value) {
  prefs[key] = value;
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* 저장소 사용 불가 */ }
  applyPrefs();
}

$('#optTheme').addEventListener('click', (e) => { if (e.target.dataset.v) setPref('theme', e.target.dataset.v); });
$('#optFont').addEventListener('click', (e) => { if (e.target.dataset.v) setPref('font', e.target.dataset.v); });
$('#optSize').addEventListener('input', (e) => setPref('size', Number(e.target.value)));
$('#optLead').addEventListener('input', (e) => setPref('lead', Number(e.target.value)));
$('#optWidth').addEventListener('input', (e) => setPref('width', Number(e.target.value)));
$('#optTypewriter').addEventListener('change', (e) => setPref('typewriter', e.target.checked));
$('#optFocus').addEventListener('change', (e) => setPref('focus', e.target.checked));
$('#btnLook').addEventListener('click', () => { $('#look').hidden = !$('#look').hidden; });
document.addEventListener('pointerdown', (e) => {
  if (!$('#look').hidden && !$('#look').contains(e.target) && e.target !== $('#btnLook')) $('#look').hidden = true;
});

/* ── 버튼 연결 ──────────────────────────────────────────── */

$('#btnNew').addEventListener('click', () =>
  serial(() => createAndOpen(untitledName(), blankDocumentBytes()))
    .then(() => page.focus())
    .catch((e) => fail('새 문서를 만들지 못했습니다', e)));

$('#btnOpen').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = file.name.replace(/\.(hwpx|hwp)$/i, '');
    await serial(() => createAndOpen(name, bytes));
    if (/\.hwp$/i.test(file.name)) toast('HWP 파일을 열었습니다. 내보낼 때는 HWPX로 저장됩니다.', 5000);
  } catch (err) {
    fail('열 수 없는 파일입니다(HWPX·HWP만 지원)', err);
  }
});

$('#btnBack').addEventListener('click', () => serial(closeToLibrary).catch((e) => fail('서재로 돌아가지 못했습니다', e)));
$('#tabWrite').addEventListener('click', () => serial(enterWrite));
$('#tabEdit').addEventListener('click', () => serial(enterEdit));
$('#btnExport').addEventListener('click', () => serial(exportFile).catch((e) => fail('내보내지 못했습니다', e)));
$('#title').addEventListener('change', (e) => {
  S.name = e.target.value.trim() || '제목 없음';
  e.target.value = S.name;
  scheduleSave(300);
});
$('#title').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

// 앱이 뒤로 가거나 닫히기 직전에 저장한다.
document.addEventListener('visibilitychange', () => { if (document.hidden && S.id) flushSave(); });
window.addEventListener('pagehide', () => { if (S.id) flushSave(); });

/* ── 시작 ───────────────────────────────────────────────── */

applyPrefs();
(async () => {
  try {
    await initEngine();
    requestPersistence();
    await refreshLibrary();
    show('library');
  } catch (err) {
    $('#loadingText').textContent = `시작하지 못했습니다: ${err?.message || err}`;
    console.error(err);
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();

// 자동 테스트에서 상태를 들여다볼 수 있게 한다.
window.__jipilsil = { S, serial, flushSave };
