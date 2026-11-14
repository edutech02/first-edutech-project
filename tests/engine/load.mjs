// 실제 rhwp 엔진을 브라우저 없이 Node에서 띄운다(글자 폭 측정만 어림값으로 대신한다).
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
globalThis.measureTextWidth = (font, text) => Array.from(text).length * 10;

const rhwp = await import('../../vendor/rhwp-core/rhwp.js');
const assets = join(root, 'studio', 'assets');
await rhwp.default({ module_or_path: readFileSync(join(assets, readdirSync(assets).find((f) => /^rhwp_bg-.*\.wasm$/.test(f)))) });

export const { HwpDocument } = rhwp;
export const { readSections, syncSection } = await import('../../js/engine.js');

export const fixture = (name) => new HwpDocument(new Uint8Array(readFileSync(join(root, 'tests', 'fixtures', name))));
/** 저장했다 다시 연 문서(저장 과정에서 깨지는 것까지 잡기 위해). */
export const reopen = (doc) => new HwpDocument(doc.exportHwpx());
/** 문단을 "[표 2×3]글" 꼴의 문자열 목록으로. */
export const show = (doc, sec = 0) => readSections(doc)[sec].map((p) => (p.lock ? `[${p.lock}]${p.text}` : p.text));
export const keep = (paras) => paras.map((p, k) => ({ k, text: p.text }));
export const charAt = (doc, para, offset) => JSON.parse(doc.getCharPropertiesAt(0, para, offset));
