// 집필 화면에서 고친 글을 문서에 옮기는 "계획"을 세운다.
// 엔진도 화면도 모르는 순수 계산이라 단위 테스트로 경우의 수를 덮는다(tests/unit/sync.test.mjs).
// 글이 사라질 수 있는 유일한 곳이므로, 바꾸기 전에 반드시 테스트부터 추가할 것.

const chars = (s) => Array.from(s); // 엔진의 글자 위치는 유니코드 코드포인트 단위
const oneLine = (s) => s.replace(/\r?\n/g, ' '); // 문단 안 줄바꿈은 지원하지 않는다

/**
 * 두 글의 차이를 "at 위치에서 remove 글자를 지우고 insert를 넣는다"로 구한다.
 * 바뀐 가운데만 건드리므로 앞뒤 글자의 서식(굵게·글꼴 등)이 유지된다.
 */
export function diffText(before, after) {
  const a = chars(before);
  const b = chars(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return { at: head, remove: a.length - head - tail, insert: b.slice(head, b.length - tail).join('') };
}

/**
 * 한 구역의 문단 목록을 next 모양으로 바꾸는 연산 목록을 만든다.
 *
 *  orig: [{ text, ctl, lock }]  문서에서 읽은 문단들. ctl=쪽 설정·각주 등 컨트롤 보유, lock=표·그림(집필에서 못 고침)
 *  next: [{ k, text }]          화면의 문단들. k=원래 문단 번호(새 문단이면 null)
 *
 * 연산(위에서부터 순서대로 실행):
 *  { op:'new',    para }              para 자리에 빈 문단을 끼운다(앞 문단의 서식을 물려받는다)
 *  { op:'split',  para, at }          para를 at에서 나눠 뒷부분을 para+1로(글자 서식 유지)
 *  { op:'insert', para, at, text }
 *  { op:'delete', para, at, count }
 *  { op:'merge',  para }              para의 글을 para-1 뒤에 붙이고 para를 없앰
 *  { op:'remove', para }              para를 통째로 없앰
 *
 * 지키는 것(실제 엔진으로 확인한 사실에 근거, tests/engine/ 참고):
 *  - 표·그림 문단(lock)에는 어떤 연산도 걸지 않는다. split을 걸면 표가 뒤쪽 문단으로 넘어간다.
 *  - 컨트롤이 든 문단(ctl)은 split하지 않는다. 엔진의 split 위치는 컨트롤도 한 칸으로 세어 글자 위치와 어긋난다.
 *    예외는 "첫 문단 맨 앞에 끼우기"뿐이다(split(0, 0)은 쪽 설정을 앞 문단에 남긴다).
 *  - 기존 글의 줄바꿈은 건드리지 않는다. 새로 넣는 글의 줄바꿈만 빈칸으로 바꾼다.
 */
export function planSection(orig, next) {
  const n = orig.length;
  if (n === 0) return [];

  // 1) 화면 문단을 원래 문단에 대응시킨다. 번호가 앞으로만 나아가는 것만 "같은 문단"으로 인정하고,
  //    나머지(새 문단, Enter로 쪼개져 번호가 겹친 문단 등)는 직전 문단 뒤에 새로 생긴 것으로 본다.
  const kept = new Map();
  const added = Array.from({ length: n + 1 }, () => []); // added[i]: 원래 i번 문단 "앞"에 새로 생긴 문단들
  let last = -1;
  for (const item of next) {
    if (Number.isInteger(item.k) && item.k > last && item.k < n) {
      last = item.k;
      if (!orig[item.k].lock) kept.set(item.k, item.text);
    } else {
      added[last + 1].push(item.text);
    }
  }

  // 2) 지워진 문단 바로 옆에 새 문단이 있으면 "지우고 새로 만들기" 대신 그 문단을 고쳐 쓴 것으로 본다.
  //    문단 서식과 쪽 설정이 그대로 남고, 전부 지우고 다시 쓴 경우에도 빈 문단이 남지 않는다.
  for (let i = 0; i < n; i++) {
    if (kept.has(i) || orig[i].lock) continue;
    if (added[i + 1].length) kept.set(i, added[i + 1].shift());
    else if (added[i].length) kept.set(i, added[i].pop());
  }

  // 3) 뒤에서 앞으로 연산을 만든다(앞쪽 문단 번호가 흔들리지 않는다).
  const ops = [];
  const after = []; // 지금 i번 문단 뒤에 놓인 문단들의 "컨트롤 보유" 여부
  const edit = (para, before, to) => {
    const d = diffText(before, to);
    const insert = oneLine(d.insert);
    if (d.remove) ops.push({ op: 'delete', para, at: d.at, count: d.remove });
    if (insert) ops.push({ op: 'insert', para, at: d.at, text: insert });
  };

  /**
   * 지금 글이 text인 para 문단을 first로 만들고, 그 뒤에 rest를 새 문단들로 둔다.
   * Enter로 문단을 나눈 경우(first가 text의 앞부분이고 뒷부분이 다음 문단에 남아 있음)는
   * 지우고 다시 치는 대신 진짜로 나눠서 뒷부분의 글자 서식을 지킨다.
   */
  const place = (para, text, first, rest, canSplit) => {
    if (canSplit && rest.length && first.length < text.length && text.startsWith(first)) {
      const tail = text.slice(first.length);
      const d = diffText(tail, rest[0]);
      if (chars(tail).length - d.remove > 0) { // 뒷부분과 다음 문단이 한 글자라도 겹친다
        ops.push({ op: 'split', para, at: chars(first).length });
        place(para + 1, tail, rest[0], rest.slice(1), true);
        return;
      }
    }
    for (let j = rest.length - 1; j >= 0; j--) {
      ops.push({ op: 'new', para: para + 1 });
      const fresh = oneLine(rest[j]);
      if (fresh) ops.push({ op: 'insert', para: para + 1, at: 0, text: fresh });
    }
    if (first !== null) edit(para, text, first);
  };

  for (let i = n - 1; i >= 0; i--) {
    const o = orig[i];
    const news = added[i + 1];
    const follow = () => { for (let j = 0; j < news.length; j++) after.unshift(false); };

    if (o.lock) {
      place(i, o.text, null, news, false); // 표·그림 문단 자체는 화면에서 지워졌더라도 건드리지 않는다
      follow();
    } else if (kept.has(i)) {
      place(i, o.text, kept.get(i), news, !o.ctl);
      follow();
    } else {
      // 2)에서 옆의 새 문단을 다 끌어다 썼으므로 여기 오는 문단 뒤에는 새 문단이 없다.
      if (o.ctl) {
        // 컨트롤이 든 문단은 없애지 않는다. 글만 비우고, 뒤 문단이 평범하면 그 글을 끌어올린다.
        edit(i, o.text, '');
        if (after.length && after[0] === false) {
          ops.push({ op: 'merge', para: i + 1 });
          after.shift();
        }
      } else if (i + 1 + after.length > 1) {
        ops.push({ op: 'remove', para: i });
        continue;
      } else {
        edit(i, o.text, ''); // 문서에는 문단이 적어도 하나 있어야 한다
      }
    }
    after.unshift(o.ctl || !!o.lock);
  }

  const head = added[0];
  for (let j = head.length - 1; j >= 0; j--) {
    // 첫 문단 앞에는 빈 문단을 끼울 수 없다(쪽 설정은 늘 첫 문단에 있어야 한다).
    // split(0, 0)은 쪽 설정을 0번에 남기고 원래 글과 표를 1번으로 내려 보낸다.
    ops.push({ op: 'split', para: 0, at: 0 });
    const fresh = oneLine(head[j]);
    if (fresh) ops.push({ op: 'insert', para: 0, at: 0, text: fresh });
  }
  return ops;
}
