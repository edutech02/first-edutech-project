// sync.js의 계획을 실제 rhwp 엔진에 실행해 본다. 단위 테스트의 가짜 문서가 엔진과 다르게
// 동작하는 지점(표 문단 나누기, 컨트롤 문단의 위치 계산, 줄바꿈)을 여기서 고정한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, reopen, show, keep, charAt, readSections, syncSection } from './load.mjs';

// sample.hwpx: 0 {{TITLE}}(쪽 설정) / 1 {{SUBTITLE}} / 2 {{H1}} / 3 {{ITEM}} / 4 표 2×3 / 5 {{H2}}
const BASE = ['{{TITLE}}', '{{SUBTITLE}}', '{{H1}}', '{{ITEM}}', '[표 2×3]', '{{H2}}'];

/** next를 반영하고, 저장 후 다시 연 문서의 문단 목록을 돌려준다. */
function apply(doc, change) {
  const orig = readSections(doc)[0];
  syncSection(doc, 0, orig, change(keep(orig), orig));
  const again = reopen(doc);
  try { return show(again); } finally { again.free(); }
}

test('시험 파일의 모양', () => {
  const doc = fixture('sample.hwpx');
  assert.deepEqual(show(doc), BASE);
  doc.free();
});

test('표 바로 뒤에 새 문단 둘: 표 문단은 그대로, 글은 표 뒤 새 문단에', () => {
  const doc = fixture('sample.hwpx');
  const got = apply(doc, (n) => [...n.slice(0, 5), { k: null, text: '표 뒤 하나' }, { k: null, text: '표 뒤 둘' }, n[5]]);
  assert.deepEqual(got, [...BASE.slice(0, 5), '표 뒤 하나', '표 뒤 둘', '{{H2}}']);
  doc.free();
});

test('표 바로 앞에 새 문단', () => {
  const doc = fixture('sample.hwpx');
  const got = apply(doc, (n) => [...n.slice(0, 4), { k: null, text: '표 앞' }, ...n.slice(4)]);
  assert.deepEqual(got, [...BASE.slice(0, 4), '표 앞', '[표 2×3]', '{{H2}}']);
  doc.free();
});

test('각주가 든 문단 뒤에 새 문단: 문단의 마지막 글자가 밀려나지 않는다', () => {
  for (const at of [0, 5, 12]) {
    const doc = fixture('sample.hwpx');
    doc.insertFootnote(0, 1, at);
    const got = apply(doc, (n) => [...n.slice(0, 2), { k: 1, text: '새 문단' }, ...n.slice(2)]);
    assert.deepEqual(got, [BASE[0], BASE[1], '새 문단', ...BASE.slice(2)], `각주 위치 ${at}`);
    doc.free();
  }
});

test('각주가 든 문단의 글을 고쳐도 각주가 남는다', () => {
  const doc = fixture('sample.hwpx');
  doc.insertFootnote(0, 1, 5);
  apply(doc, (n) => { n[1].text = '{{SUB고침TITLE}}!'; return n; });
  assert.equal(readSections(doc)[0][1].text, '{{SUB고침TITLE}}!');
  assert.equal(readSections(doc)[0][1].ctl, true, '각주 컨트롤이 남아 있음');
  doc.free();
});

test('문단 안 줄바꿈은 다른 문단을 고쳐도 그대로 남는다', () => {
  const doc = fixture('sample.hwpx');
  doc.insertText(0, 1, 3, '\n');
  const got = apply(doc, (n) => { n[2].text += ' 고침'; return n; });
  assert.equal(got[1], '{{S\nUBTITLE}}');
  assert.equal(got[2], '{{H1}} 고침');
  doc.free();
});

test('Enter로 문단 가운데를 나눠도 뒷부분의 글자 서식이 그대로다', () => {
  const doc = fixture('sample.hwpx');
  // {{ITEM}}의 "IT"만 기울임: 나눈 뒤 "EM}}"이 기울면 안 되고 "I"와 "T"는 기울어 있어야 한다.
  doc.applyCharFormat(0, 3, 2, 4, JSON.stringify({ italic: true }));
  assert.deepEqual([1, 2, 3, 4].map((o) => charAt(doc, 3, o).italic), [false, true, true, false], '준비: IT만 기울임');
  const got = apply(doc, (n) => [...n.slice(0, 3), { k: 3, text: '{{I' }, { k: 3, text: 'TEM}}' }, ...n.slice(4)]);
  assert.deepEqual(got, [...BASE.slice(0, 3), '{{I', 'TEM}}', '[표 2×3]', '{{H2}}']);
  assert.deepEqual([1, 2].map((o) => charAt(doc, 3, o).italic), [false, true], '앞 문단: {는 보통, I는 기울임');
  assert.deepEqual([0, 1, 2].map((o) => charAt(doc, 4, o).italic), [true, false, false], '뒤 문단: T는 기울임, E와 M은 보통');
  doc.free();
});

test('첫 문단 앞에 새 문단: 쪽 설정은 첫 문단에 남는다', () => {
  const doc = fixture('sample.hwpx');
  const got = apply(doc, (n) => [{ k: null, text: '맨 앞' }, ...n]);
  assert.deepEqual(got, ['맨 앞', ...BASE]);
  const first = readSections(doc)[0];
  assert.equal(first[0].ctl, true, '쪽 설정이 0번 문단에 있음');
  assert.equal(first[1].ctl, false);
  doc.free();
});

test('표만 남기고 전부 지운 뒤 새로 쓰기', () => {
  const doc = fixture('sample.hwpx');
  apply(doc, (n) => [n[4]]);
  const got = apply(doc, (n, orig) => [...n.filter((_, k) => orig[k].lock), { k: null, text: '새 글' }]);
  assert.ok(got.includes('[표 2×3]'), `표가 남아 있음: ${JSON.stringify(got)}`);
  assert.ok(got.includes('새 글'), `새 글이 표 밖 문단에 있음: ${JSON.stringify(got)}`);
  doc.free();
});

test('무작위 편집: 표는 그대로, 화면의 글은 순서대로 문서에 있다', () => {
  let seed = 777;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const words = ['가', '나다', '😀', 'ab', ' ', '라'];
  const text = () => Array.from({ length: 1 + rnd(3) }, () => words[rnd(words.length)]).join('');
  for (let round = 0; round < 60; round++) {
    const doc = fixture('sample.hwpx');
    doc.insertFootnote(0, 1, rnd(13));
    for (let step = 0; step < 3; step++) { // 같은 문서를 세 번 연달아 고친다
      const orig = readSections(doc)[0];
      const next = [];
      orig.forEach((p, k) => {
        if (rnd(5) === 0) next.push({ k: null, text: text() });
        const fate = rnd(7);
        if (fate === 0 && !p.lock) return;
        if (p.lock) { next.push({ k, text: '' }); return; }
        if (fate === 1 && p.text) {
          const cs = Array.from(p.text);
          const cut = rnd(cs.length + 1);
          next.push({ k, text: cs.slice(0, cut).join('') }, { k, text: cs.slice(cut).join('') });
        } else {
          next.push({ k, text: fate === 2 ? text() : p.text });
        }
      });
      if (rnd(3) === 0) next.push({ k: null, text: text() });
      syncSection(doc, 0, orig, next);

      const got = show(doc);
      const info = `\nround=${round}.${step}\norig=${JSON.stringify(orig)}\nnext=${JSON.stringify(next)}\ngot=${JSON.stringify(got)}`;
      assert.equal(got.filter((t) => t === '[표 2×3]').length, 1, `표 문단이 그대로 하나${info}`);
      assert.equal(readSections(doc)[0][0].ctl, true, `쪽 설정이 첫 문단에${info}`);
      const want = next.filter((it) => !(Number.isInteger(it.k) && orig[it.k].lock)).map((it) => it.text);
      const have = got.filter((t) => !t.startsWith('['));
      assert.equal(have.join(''), want.join(''), `글자가 늘거나 줄지 않음${info}`);
      let w = 0;
      for (const t of have) if (w < want.length && t === want[w]) w++;
      assert.equal(w, want.length, `글이 순서대로 있음${info}`);
    }
    const again = reopen(doc); // 고친 문서가 저장 후에도 같은 모양으로 열린다
    assert.deepEqual(show(again), show(doc), `round=${round} 다시 열기`);
    again.free();
    doc.free();
  }
});
