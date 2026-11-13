// rhwp 엔진(@rhwp/core, Rust+WebAssembly) 래퍼.
// 집필 화면은 문서의 "본문 문단 글자"만 다루고, 서식·표·그림은 엔진이 그대로 보존한다.
import init, { HwpDocument } from '../vendor/rhwp-core/rhwp.js';
import { WASM_URL } from './config.js';

let ready = null;

/** 엔진을 한 번만 초기화한다. */
export function initEngine() {
  if (!ready) {
    // 엔진이 줄바꿈 위치를 계산할 때 브라우저의 글자 폭 측정을 빌려 쓴다(초기화 전에 등록 필수).
    let ctx = null;
    let lastFont = '';
    globalThis.measureTextWidth = (font, text) => {
      if (!ctx) ctx = document.createElement('canvas').getContext('2d');
      if (font !== lastFont) { ctx.font = font; lastFont = font; }
      return ctx.measureText(text).width;
    };
    ready = init({ module_or_path: WASM_URL });
  }
  return ready;
}

/** HWPX/HWP 바이트를 문서 객체로 연다. */
export function openDocument(bytes) {
  return new HwpDocument(bytes);
}

/** 빈 문서(한글 호환 기본 템플릿)의 HWPX 바이트를 만든다. */
export function blankDocumentBytes() {
  const doc = HwpDocument.createEmpty();
  try {
    doc.createBlankDocument();
    return doc.exportHwpx();
  } finally {
    doc.free();
  }
}

const cp = (s) => Array.from(s); // 엔진의 글자 위치는 유니코드 코드포인트 단위

function check(json, what) {
  let r;
  try { r = JSON.parse(json); } catch { return; }
  if (r && r.ok === false) throw new Error(`${what} 실패: ${json}`);
}

function controlCount(doc, sec, para) {
  try { return JSON.parse(doc.getControlTextPositions(sec, para)).length; } catch { return 0; }
}

/** 문단에 표·그림이 들어 있으면 집필 화면에서 잠글 때 쓸 이름표를 돌려준다. */
function objectLabel(doc, sec, para, count) {
  for (let ci = 0; ci < count; ci++) {
    try {
      const d = JSON.parse(doc.getTableDimensions(sec, para, ci));
      return `표 ${d.rowCount}×${d.colCount}`;
    } catch { /* 표가 아님 */ }
    try {
      doc.getPictureProperties(sec, para, ci);
      return '그림';
    } catch { /* 그림이 아님 */ }
  }
  return null;
}

/**
 * 본문을 구역별 문단 목록으로 읽는다.
 * 반환: [[{ text, ctl(컨트롤 보유), lock(표/그림 이름표 또는 null) }, ...], ...]
 */
export function readSections(doc) {
  const sections = [];
  const secCount = doc.getSectionCount();
  for (let s = 0; s < secCount; s++) {
    const paras = [];
    const n = doc.getParagraphCount(s);
    for (let p = 0; p < n; p++) {
      const len = doc.getParagraphLength(s, p);
      const text = len > 0 ? doc.getTextRange(s, p, 0, len) : '';
      const count = controlCount(doc, s, p);
      paras.push({ text, ctl: count > 0, lock: count > 0 ? objectLabel(doc, s, p, count) : null });
    }
    sections.push(paras);
  }
  return sections;
}

function replaceText(doc, sec, para, oldText, newText) {
  if (oldText === newText) return;
  const a = cp(oldText);
  const b = cp(newText);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  // 바뀐 가운데 부분만 지우고 넣는다 → 앞뒤 글자의 서식(굵게·글꼴 등)이 유지된다.
  const del = a.length - pre - suf;
  if (del > 0) check(doc.deleteText(sec, para, pre, del), '글자 삭제');
  const ins = b.slice(pre, b.length - suf).join('').replace(/\r?\n/g, ' ');
  if (ins) check(doc.insertText(sec, para, pre, ins), '글자 입력');
}

/**
 * 집필 화면에서 고친 문단 목록을 한 구역에 반영한다.
 *  orig: readSections()가 준 그 구역의 문단 목록
 *  next: [{ k: 원래 문단 번호 또는 null(새 문단), text }]
 */
export function syncSection(doc, sec, orig, next) {
  const n = orig.length;
  const kept = new Map(); // 원래 문단 번호 → 새 글
  const after = Array.from({ length: n + 1 }, () => []); // after[i+1]: 원래 i번 문단 뒤에 새로 생긴 문단들
  let last = -1;
  for (const item of next) {
    const k = item.k;
    if (Number.isInteger(k) && k > last && k < n) {
      kept.set(k, item.text);
      last = k;
    } else {
      after[last + 1].push(item.text);
    }
  }

  // 뒤에서 앞으로 처리하면 앞쪽 문단 번호가 흔들리지 않는다.
  for (let i = n - 1; i >= 0; i--) {
    const added = after[i + 1];
    for (let j = added.length - 1; j >= 0; j--) {
      check(doc.splitParagraph(sec, i, doc.getParagraphLength(sec, i)), '문단 추가');
      if (added[j]) check(doc.insertText(sec, i + 1, 0, added[j].replace(/\r?\n/g, ' ')), '글자 입력');
    }
    const o = orig[i];
    if (o.lock) continue; // 표·그림 문단은 집필 화면에서 건드리지 않는다
    if (kept.has(i)) {
      replaceText(doc, sec, i, o.text, kept.get(i));
    } else if (o.ctl) {
      // 쪽 설정 같은 숨은 정보가 든 문단은 지우지 않고 글자만 비운 뒤, 가능하면 다음 문단을 끌어올린다.
      replaceText(doc, sec, i, o.text, '');
      if (i + 1 < doc.getParagraphCount(sec) && controlCount(doc, sec, i + 1) === 0) {
        check(doc.mergeParagraph(sec, i + 1), '문단 합치기');
      }
    } else if (doc.getParagraphCount(sec) > 1) {
      check(doc.deleteParagraph(sec, i), '문단 삭제');
    } else {
      replaceText(doc, sec, i, o.text, '');
    }
  }

  const head = after[0]; // 첫 문단 앞에 새로 생긴 문단들
  for (let j = head.length - 1; j >= 0; j--) {
    check(doc.splitParagraph(sec, 0, 0), '문단 추가');
    if (head[j]) check(doc.insertText(sec, 0, 0, head[j].replace(/\r?\n/g, ' ')), '글자 입력');
  }
}
