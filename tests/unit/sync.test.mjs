// js/sync.js 단위 테스트. 계획(ops)을 가짜 문서에 그대로 실행해 결과 글이 기대와 같은지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffText, planSection } from '../../js/sync.js';

const P = (text, extra = {}) => ({ text, ctl: false, lock: null, ...extra });

/** 엔진의 문단 연산을 흉내 내는 가짜 문서. 글자 위치는 코드포인트 단위. */
function run(orig, ops) {
  const doc = orig.map((p) => ({ chars: Array.from(p.text), ctl: p.ctl, lock: p.lock }));
  for (const op of ops) {
    const p = doc[op.para];
    assert.ok(p, `없는 문단을 건드림: ${JSON.stringify(op)}`);
    if (op.op === 'insert') {
      assert.ok(op.at <= p.chars.length, '범위 밖 삽입');
      p.chars.splice(op.at, 0, ...Array.from(op.text));
    } else if (op.op === 'delete') {
      assert.ok(op.at + op.count <= p.chars.length, '범위 밖 삭제');
      p.chars.splice(op.at, op.count);
    } else if (op.op === 'split') {
      assert.ok(op.at <= p.chars.length, '범위 밖 분할');
      // 엔진은 숨은 컨트롤을 앞 문단에 남긴다.
      doc.splice(op.para + 1, 0, { chars: p.chars.splice(op.at), ctl: false, lock: null });
    } else if (op.op === 'merge') {
      assert.ok(op.para > 0, '첫 문단은 앞과 합칠 수 없음');
      assert.equal(p.ctl, false, '컨트롤이 든 문단을 합쳐 없애면 안 됨');
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
  return doc.map((p) => (p.lock ? `[${p.lock}]` : p.chars.join('')));
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
