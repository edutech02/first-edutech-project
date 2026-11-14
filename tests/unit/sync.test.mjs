// js/sync.js 단위 테스트. 계획(ops)을 가짜 문서에 그대로 실행해 결과 글이 기대와 같은지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffText, planSection } from '../../js/sync.js';

const P = (text, extra = {}) => ({ text, ctl: false, lock: null, ...extra });

/**
 * 엔진의 문단 연산을 흉내 내는 가짜 문서. 글자 위치는 코드포인트 단위.
 * 실제 엔진과 어긋나면 안 되는 규칙을 여기서 단언한다(실제 엔진 확인은 tests/engine/).
 */
function run(orig, ops) {
  const doc = orig.map((p) => ({ chars: Array.from(p.text), ctl: p.ctl, lock: p.lock }));
  for (const op of ops) {
    if (op.op === 'new') {
      assert.ok(op.para >= 1 && op.para <= doc.length, `빈 문단을 끼울 수 없는 자리: ${JSON.stringify(op)}`);
      doc.splice(op.para, 0, { chars: [], ctl: false, lock: null });
      continue;
    }
    const p = doc[op.para];
    assert.ok(p, `없는 문단을 건드림: ${JSON.stringify(op)}`);
    const headSplit = op.op === 'split' && op.para === 0 && op.at === 0;
    if (!headSplit) assert.equal(p.lock, null, `표·그림 문단을 건드림: ${JSON.stringify(op)}`);
    if (op.op === 'insert') {
      assert.ok(op.at <= p.chars.length, '범위 밖 삽입');
      assert.ok(!op.text.includes('\n'), '새로 넣는 글에 줄바꿈이 있으면 안 됨');
      p.chars.splice(op.at, 0, ...Array.from(op.text));
    } else if (op.op === 'delete') {
      assert.ok(op.at + op.count <= p.chars.length, '범위 밖 삭제');
      p.chars.splice(op.at, op.count);
    } else if (headSplit) {
      // 쪽 설정은 0번에 남고, 글과 표는 1번으로 내려간다.
      doc.splice(1, 0, { chars: p.chars.splice(0), ctl: !!p.lock, lock: p.lock });
      p.lock = null;
    } else if (op.op === 'split') {
      assert.equal(p.ctl, false, `컨트롤이 든 문단을 나눔: ${JSON.stringify(op)}`);
      assert.ok(op.at <= p.chars.length, '범위 밖 분할');
      doc.splice(op.para + 1, 0, { chars: p.chars.splice(op.at), ctl: false, lock: null });
    } else if (op.op === 'merge') {
      assert.ok(op.para > 0, '첫 문단은 앞과 합칠 수 없음');
      assert.equal(p.ctl, false, '컨트롤이 든 문단을 합쳐 없애면 안 됨');
      assert.equal(doc[op.para - 1].lock, null, '표·그림 문단에 글을 합치면 안 됨');
      doc[op.para - 1].chars.push(...p.chars);
      doc.splice(op.para, 1);
    } else if (op.op === 'remove') {
      assert.equal(p.ctl, false, '컨트롤이 든 문단을 지우면 안 됨');
      assert.ok(doc.length > 1, '마지막 문단은 지울 수 없음');
      doc.splice(op.para, 1);
    } else {
      assert.fail(`모르는 연산 ${op.op}`);
    }
  }
  // 잠긴 문단은 이름표와 함께 그 안의 글도 보여 준다(글이 흘러들면 드러나도록).
  return doc.map((p) => (p.lock ? `[${p.lock}]${p.chars.join('')}` : p.chars.join('')));
}

const sync = (orig, next) => run(orig, planSection(orig, next));

test('diffText: 같으면 아무것도 하지 않는다', () => {
  const d = diffText('가나다', '가나다');
  assert.equal(d.remove, 0);
  assert.equal(d.insert, '');
});

test('diffText: 중간만 바뀌면 그 부분만 지우고 넣는다', () => {
  assert.deepEqual(diffText('가나다라', '가XY라'), { at: 1, remove: 2, insert: 'XY' });
});

test('diffText: 끝에 덧붙이기와 앞에 끼우기', () => {
  assert.deepEqual(diffText('가나', '가나다'), { at: 2, remove: 0, insert: '다' });
  assert.deepEqual(diffText('가나', '다가나'), { at: 0, remove: 0, insert: '다' });
});

test('diffText: 같은 글자가 반복돼도 길이가 맞는다', () => {
  assert.deepEqual(diffText('aaa', 'aa'), { at: 2, remove: 1, insert: '' });
  assert.deepEqual(diffText('aa', 'aaa'), { at: 2, remove: 0, insert: 'a' });
});

test('diffText: 이모지는 글자 하나로 센다', () => {
  assert.deepEqual(diffText('가😀나', '가😀다'), { at: 2, remove: 1, insert: '다' });
  assert.deepEqual(diffText('가😀나', '가나'), { at: 1, remove: 1, insert: '' });
});

test('바뀐 것이 없으면 연산이 없다', () => {
  const orig = [P('하나'), P('둘')];
  assert.deepEqual(planSection(orig, [{ k: 0, text: '하나' }, { k: 1, text: '둘' }]), []);
});

test('문단 글 수정', () => {
  const orig = [P('하나'), P('둘'), P('셋')];
  assert.deepEqual(sync(orig, [{ k: 0, text: '하나' }, { k: 1, text: '두울' }, { k: 2, text: '셋!' }]), ['하나', '두울', '셋!']);
});

test('문단 추가: 맨 앞, 중간, 맨 끝', () => {
  const orig = [P('하나'), P('둘')];
  const next = [
    { k: null, text: '머리1' }, { k: null, text: '머리2' },
    { k: 0, text: '하나' }, { k: null, text: '사이' },
    { k: 1, text: '둘' }, { k: null, text: '꼬리1' }, { k: null, text: '꼬리2' },
  ];
  assert.deepEqual(sync(orig, next), ['머리1', '머리2', '하나', '사이', '둘', '꼬리1', '꼬리2']);
});

test('빈 문단 추가', () => {
  const orig = [P('하나')];
  assert.deepEqual(sync(orig, [{ k: 0, text: '하나' }, { k: null, text: '' }, { k: null, text: '끝' }]), ['하나', '', '끝']);
});

test('문단 삭제: 앞, 중간, 끝', () => {
  const orig = [P('하나'), P('둘'), P('셋'), P('넷')];
  assert.deepEqual(sync(orig, [{ k: 1, text: '둘' }, { k: 2, text: '셋' }]), ['둘', '셋']);
  assert.deepEqual(sync(orig, [{ k: 0, text: '하나' }, { k: 3, text: '넷' }]), ['하나', '넷']);
});

test('전부 지워도 문단 하나는 남는다', () => {
  const orig = [P('하나'), P('둘')];
  assert.deepEqual(sync(orig, []), ['']);
});

test('전부 지우고 새로 쓰기', () => {
  const orig = [P('하나'), P('둘')];
  assert.deepEqual(sync(orig, [{ k: null, text: '새 글' }, { k: null, text: '둘째' }]), ['새 글', '둘째']);
});

test('Enter로 문단을 쪼개면 같은 번호가 두 번 온다: 둘째는 새 문단', () => {
  const orig = [P('하나둘'), P('셋')];
  assert.deepEqual(sync(orig, [{ k: 0, text: '하나' }, { k: 0, text: '둘' }, { k: 1, text: '셋' }]), ['하나', '둘', '셋']);
});

test('번호가 거꾸로 오거나 범위를 벗어나면 새 문단으로 본다', () => {
  const orig = [P('하나'), P('둘')];
  assert.deepEqual(sync(orig, [{ k: 1, text: '둘' }, { k: 0, text: '하나' }, { k: 9, text: '구' }]), ['둘', '하나', '구']);
});

test('잠긴 문단(표)은 화면에서 사라져도 문서에 남고 글도 바뀌지 않는다', () => {
  const orig = [P('하나'), P('', { ctl: true, lock: '표 2×3' }), P('둘')];
  assert.deepEqual(sync(orig, [{ k: 0, text: '하나!' }, { k: 2, text: '둘!' }]), ['하나!', '[표 2×3]', '둘!']);
  // 표가 화면에서 지워져 자리를 알 수 없는 새 글은 표 앞에 놓인다.
  assert.deepEqual(sync([P('', { ctl: true, lock: '표' })], [{ k: null, text: '가' }]), ['가', '[표]']);
  assert.deepEqual(sync(orig, [{ k: 0, text: '하나' }, { k: 1, text: '무시' }, { k: null, text: '표 뒤' }, { k: 2, text: '둘' }]),
    ['하나', '[표 2×3]', '표 뒤', '둘']);
});

test('쪽 설정이 든 첫 문단을 지우면 문단은 남기고 다음 문단의 글을 끌어올린다', () => {
  const orig = [P('제목', { ctl: true }), P('본문'), P('끝')];
  assert.deepEqual(sync(orig, [{ k: 1, text: '본문' }, { k: 2, text: '끝' }]), ['본문', '끝']);
});

test('쪽 설정이 든 문단 뒤가 표면 끌어올리지 않고 빈 문단으로 남긴다', () => {
  const orig = [P('제목', { ctl: true }), P('', { ctl: true, lock: '표 1×1' })];
  assert.deepEqual(sync(orig, []), ['', '[표 1×1]']);
});

test('넣는 글의 줄바꿈은 빈칸으로 바꾼다(문단 안 줄바꿈은 지원하지 않음)', () => {
  const orig = [P('하나')];
  assert.deepEqual(sync(orig, [{ k: 0, text: '하나\n둘' }, { k: null, text: '셋\r\n넷' }]), ['하나 둘', '셋 넷']);
});

test('수정·추가·삭제가 섞인 경우', () => {
  const orig = [P('가', { ctl: true }), P('나'), P('다'), P('', { ctl: true, lock: '그림' }), P('라'), P('마')];
  const next = [
    { k: null, text: '새1' }, { k: 0, text: '가가' }, { k: 2, text: '다' }, { k: null, text: '새2' },
    { k: 3, text: '' }, { k: 5, text: '마마' }, { k: null, text: '새3' },
  ];
  assert.deepEqual(sync(orig, next), ['새1', '가가', '다', '새2', '[그림]', '마마', '새3']);
});

test('표 바로 뒤에 새 문단: 표 문단은 건드리지 않고 그 뒤에 빈 문단을 끼운다', () => {
  const orig = [P('하나'), P('', { ctl: true, lock: '표' }), P('둘')];
  const next = [{ k: 0, text: '하나' }, { k: 1, text: '' }, { k: null, text: '표 뒤1' }, { k: null, text: '표 뒤2' }, { k: 2, text: '둘' }];
  assert.deepEqual(planSection(orig, next), [
    { op: 'new', para: 2 }, { op: 'insert', para: 2, at: 0, text: '표 뒤2' },
    { op: 'new', para: 2 }, { op: 'insert', para: 2, at: 0, text: '표 뒤1' },
  ]);
  assert.deepEqual(sync(orig, next), ['하나', '[표]', '표 뒤1', '표 뒤2', '둘']);
});

test('문서가 표 하나뿐일 때 새 글은 표 뒤 새 문단으로 간다', () => {
  const orig = [P('', { ctl: true, lock: '표' })];
  assert.deepEqual(sync(orig, [{ k: 0, text: '' }, { k: null, text: '가' }]), ['[표]', '가']);
});

test('컨트롤(각주 등)이 든 문단 뒤에 새 문단: 나누지 않고 끼운다', () => {
  const orig = [P('제목', { ctl: true }), P('각주 문단', { ctl: true }), P('끝')];
  const next = [{ k: 0, text: '제목' }, { k: 1, text: '각주 문단' }, { k: 1, text: '새 문단' }, { k: 2, text: '끝' }];
  assert.deepEqual(planSection(orig, next), [{ op: 'new', para: 2 }, { op: 'insert', para: 2, at: 0, text: '새 문단' }]);
});

test('기존 줄바꿈이 든 문단은 건드리지 않는다', () => {
  const orig = [P('첫 줄\n둘째 줄'), P('다음')];
  assert.deepEqual(planSection(orig, [{ k: 0, text: '첫 줄\n둘째 줄' }, { k: 1, text: '다음' }]), []);
  assert.deepEqual(planSection(orig, [{ k: 0, text: '첫 줄\n둘째 줄!' }, { k: 1, text: '다음' }]),
    [{ op: 'insert', para: 0, at: 8, text: '!' }]);
});

test('Enter로 문단 가운데를 나누면 지우고 다시 치지 않고 진짜로 나눈다(뒷부분 서식 유지)', () => {
  const orig = [P('가나다라'), P('끝')];
  assert.deepEqual(planSection(orig, [{ k: 0, text: '가나' }, { k: 0, text: '다라' }, { k: 1, text: '끝' }]),
    [{ op: 'split', para: 0, at: 2 }]);
});

test('문단 맨 앞에서 Enter: 글 전체가 서식 그대로 아래 문단으로 간다', () => {
  const orig = [P('가나다라')];
  assert.deepEqual(planSection(orig, [{ k: 0, text: '' }, { k: 0, text: '가나다라' }]), [{ op: 'split', para: 0, at: 0 }]);
});

test('Enter 두 번으로 세 문단: 두 번 나눈다', () => {
  const orig = [P('가나다라마바')];
  const next = [{ k: 0, text: '가나' }, { k: 0, text: '다라' }, { k: 0, text: '마바' }];
  assert.deepEqual(planSection(orig, next), [{ op: 'split', para: 0, at: 2 }, { op: 'split', para: 1, at: 2 }]);
  assert.deepEqual(sync(orig, next), ['가나', '다라', '마바']);
});

test('Enter로 나눈 뒤 아래 문단에 이어 쓰기: 나눈 다음 덧붙인 글만 넣는다', () => {
  const orig = [P('가나다라')];
  assert.deepEqual(planSection(orig, [{ k: 0, text: '가나' }, { k: 0, text: '다라마바' }]),
    [{ op: 'split', para: 0, at: 2 }, { op: 'insert', para: 1, at: 2, text: '마바' }]);
});

test('이모지 뒤에서 Enter: 나누는 위치는 코드포인트 단위', () => {
  const orig = [P('가😀나다')];
  assert.deepEqual(planSection(orig, [{ k: 0, text: '가😀' }, { k: 0, text: '나다' }]), [{ op: 'split', para: 0, at: 2 }]);
});

test('무작위 입력: 연산을 실행한 결과가 화면과 같고, 표·컨트롤 규칙을 어기지 않는다', () => {
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const words = ['가', '나다', '😀', 'ab', ' ', '라마바', ''];
  const text = () => Array.from({ length: rnd(4) }, () => words[rnd(words.length)]).join('');
  for (let round = 0; round < 3000; round++) {
    const orig = Array.from({ length: 1 + rnd(5) }, (_, i) => {
      const kind = rnd(8);
      if (kind === 0) return P('', { ctl: true, lock: '표' });
      if (kind === 1 || (i === 0 && kind < 5)) return P(text(), { ctl: true });
      return P(text());
    });
    const next = [];
    orig.forEach((p, k) => {
      for (let a = rnd(3); a > 1; a--) next.push({ k: null, text: text() });
      const fate = rnd(6);
      if (fate === 0) return; // 삭제
      if (p.lock) { next.push({ k, text: '' }); return; }
      if (fate === 1 && p.text) { // Enter로 나누기
        const cut = rnd(Array.from(p.text).length + 1);
        const cs = Array.from(p.text);
        next.push({ k, text: cs.slice(0, cut).join('') }, { k, text: cs.slice(cut).join('') });
      } else {
        next.push({ k, text: fate === 2 ? text() : p.text });
      }
    });
    for (let a = rnd(3); a > 1; a--) next.push({ k: null, text: text() });

    const got = sync(orig, next); // 규칙 위반은 run()의 단언이 잡는다
    // 화면에 남은 글은 순서대로 모두 문서에 있어야 한다(잠긴 문단과 지울 수 없는 빈 문단은 건너뛴다).
    const want = next.filter((it) => !(Number.isInteger(it.k) && orig[it.k].lock)).map((it) => it.text);
    const have = got.filter((t) => !t.startsWith('['));
    let w = 0;
    for (const t of have) if (w < want.length && t === want[w]) w++;
    assert.equal(w, want.length, `글이 빠짐\norig=${JSON.stringify(orig)}\nnext=${JSON.stringify(next)}\ngot=${JSON.stringify(got)}`);
    assert.ok(have.length - want.length <= orig.filter((p) => p.ctl && !p.lock).length, '남는 빈 문단은 지울 수 없는 문단 수 이하');
    assert.equal(have.join(''), want.join(''), '글자가 늘거나 줄지 않음');
    for (const t of got) if (t.startsWith('[')) assert.equal(t, '[표]', '표 문단에 글이 흘러들지 않음');
  }
});
