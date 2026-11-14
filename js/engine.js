// rhwp 엔진(@rhwp/core, Rust+WebAssembly) 래퍼.
// 집필 화면은 문서의 "본문 문단 글자"만 다루고, 서식·표·그림은 엔진이 그대로 보존한다.
import init, { HwpDocument } from '../vendor/rhwp-core/rhwp.js';
import { WASM_URL } from './config.js';
import { planSection } from './sync.js';

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

const run = {
  new: (doc, sec, o) => doc.insertParagraph(sec, o.para),
  split: (doc, sec, o) => doc.splitParagraph(sec, o.para, o.at),
  insert: (doc, sec, o) => doc.insertText(sec, o.para, o.at, o.text),
  delete: (doc, sec, o) => doc.deleteText(sec, o.para, o.at, o.count),
  merge: (doc, sec, o) => doc.mergeParagraph(sec, o.para),
  remove: (doc, sec, o) => doc.deleteParagraph(sec, o.para),
};

/**
 * 집필 화면에서 고친 문단 목록을 한 구역에 반영한다. 무엇을 할지는 sync.js가 정하고 여기서는 실행만 한다.
 *  orig: readSections()가 준 그 구역의 문단 목록
 *  next: [{ k: 원래 문단 번호 또는 null(새 문단), text }]
 */
export function syncSection(doc, sec, orig, next) {
  for (const op of planSection(orig, next)) check(run[op.op](doc, sec, op), `문단 ${op.para} ${op.op}`);
}
