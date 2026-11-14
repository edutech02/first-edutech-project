// 집필 화면: 글자만 보이는 편집 영역과 그 동작(집중, 타자기 스크롤, 글자 수, 화면 설정).
// 문서 엔진은 모른다. 문단 목록을 받아 그리고, 고친 문단 목록을 돌려줄 뿐이다.

const $ = (sel) => document.querySelector(sel);
const PREF_KEY = 'jipilsil.prefs';

/**
 * 집필 화면을 준비한다. onInput은 사용자가 글을 고칠 때마다 불린다.
 * 반환값으로 그리기(render)·읽기(read)·맞추기(reconcile)를 한다.
 */
export function initWriteView({ onInput }) {
  const page = $('#page');
  const scroller = $('#write');
  const body = document.body;
  const active = () => body.dataset.screen === 'work' && body.dataset.mode === 'write';

  let composing = false; // 한글 조합 중
  let chars = 0;

  /* ── 화면 설정 ── */

  const prefs = { theme: 'paper', font: 'serif', size: 19, lead: 1.9, width: 36, typewriter: true, focus: true };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); } catch { /* 저장소 사용 불가 */ }

  function applyPrefs() {
    const root = document.documentElement.style;
    body.dataset.theme = prefs.theme;
    root.setProperty('--w-font', prefs.font === 'sans' ? 'var(--sans)' : 'var(--serif)');
    root.setProperty('--w-size', `${prefs.size}px`);
    root.setProperty('--w-lead', String(prefs.lead));
    root.setProperty('--w-width', `${prefs.width}em`);
    body.classList.toggle('focus-para', !!prefs.focus);
    const bg = getComputedStyle(body).getPropertyValue('--bg').trim();
    if (bg) $('meta[name="theme-color"]').content = bg;
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
  applyPrefs();

  /* ── 문서 → 화면 ── */

  function updateCount() {
    let n = 0;
    for (const p of page.children) if (!p.classList.contains('locked')) n += Array.from(p.textContent).length;
    chars = n;
    $('#count').textContent = `${n.toLocaleString('ko-KR')}자`;
  }

  /** 구역별 문단 목록([[{ text, lock }]])을 그린다. 문단마다 "구역:번호" 번호표(data-k)를 붙인다. */
  function render(sections) {
    const keepScroll = scroller.scrollTop;
    const frag = document.createDocumentFragment();
    sections.forEach((paras, s) => {
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
    scroller.scrollTop = keepScroll;
    updateCount();
  }

  /* ── 화면 → 문서 ── */

  /** 화면의 문단들을 순서대로 모은다. 브라우저가 만든 엉뚱한 구조(div 중첩 등)도 문단으로 풀어낸다. */
  function collect(root, out = []) {
    for (const node of root.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.data.trim()) out.push({ el: null, text: node.data });
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'BR') {
          if (root === page) out.push({ el: null, text: '' });
        } else if (node.querySelector(':scope > p, :scope > div')) {
          collect(node, out);
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

  /**
   * 화면의 문단을 구역별 [{ k, text }] 목록으로 읽는다(sync.js의 planSection에 넘길 모양).
   * items는 reconcile()에 다시 넘겨야 하는 화면 문단 목록이다.
   */
  function read(sectionCount) {
    const items = collect(page);
    const perSection = Array.from({ length: sectionCount }, () => []);
    let sec = 0;
    for (const it of items) {
      const key = it.el ? parseKey(it.el) : null;
      if (key && key[0] >= sec && key[0] < sectionCount) {
        sec = key[0];
        perSection[sec].push({ k: key[1], text: it.text });
      } else if (!it.locked) {
        perSection[sec].push({ k: null, text: it.text });
      }
    }
    return { items, perSection };
  }

  /**
   * 문서에 반영한 뒤, 화면을 문서의 새 문단 목록에 맞춘다.
   * 1:1로 맞으면 번호표만 새로 붙여 커서와 입력 흐름을 지키고, 어긋나면 다시 그린다.
   */
  function reconcile(sections, items) {
    const flat = sections.flatMap((paras, s) => paras.map((para, i) => ({ para, k: `${s}:${i}` })));
    const same = flat.length === items.length && flat.every(({ para }, n) => {
      const it = items[n];
      return it.el && (para.lock ? it.locked : !it.locked && it.text === para.text);
    });
    if (same) flat.forEach(({ k }, n) => { items[n].el.dataset.k = k; });
    else render(sections);
  }

  /* ── 집중: 쓰는 문단 표시, 타자기 스크롤, 도구 막대 숨김 ── */

  function currentPara() {
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount || !page.contains(sel.anchorNode)) return null;
    let node = sel.anchorNode;
    while (node && node.parentNode !== page) node = node.parentNode;
    return node && node.nodeType === Node.ELEMENT_NODE ? node : null;
  }

  function markCurrent() {
    const cur = currentPara();
    if (!cur) return;
    // Enter로 문단을 나누면 브라우저가 클래스까지 복제하므로, 다른 문단의 표시는 전부 지운다.
    for (const p of page.querySelectorAll('.cur')) if (p !== cur) p.classList.remove('cur');
    cur.classList.add('cur');
  }

  /** 타자기 스크롤: 커서가 있는 줄을 늘 화면의 같은 높이에 둔다. */
  function typewriterScroll() {
    if (!prefs.typewriter) return;
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed || !page.contains(sel.anchorNode)) return;
    const rect = sel.getRangeAt(0).getClientRects()[0] || currentPara()?.getBoundingClientRect();
    if (!rect) return;
    const viewH = window.visualViewport?.height || window.innerHeight; // 화면 키보드를 뺀 높이
    const delta = rect.top - viewH * 0.42;
    if (Math.abs(delta) > 6) scroller.scrollTop += delta;
  }

  const wake = () => body.classList.remove('typing');

  let countTimer = 0;
  page.addEventListener('input', () => {
    if (!page.firstChild) page.innerHTML = '<p><br></p>'; // 전부 지워도 문단 하나는 남긴다
    body.classList.add('typing');
    markCurrent();
    typewriterScroll();
    clearTimeout(countTimer);
    countTimer = setTimeout(updateCount, 250);
    onInput();
  });
  page.addEventListener('compositionstart', () => { composing = true; });
  page.addEventListener('compositionend', () => { composing = false; });

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
    text.split('\n').forEach((line, i) => {
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

  document.addEventListener('selectionchange', () => { if (active()) markCurrent(); });

  // 도구 막대 다시 보이기: 글 바깥을 누르거나, 마우스를 움직이거나, Esc(app.js).
  document.addEventListener('pointerdown', (e) => { if (!page.contains(e.target)) wake(); });
  let lastMove = null;
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    if (lastMove && Math.hypot(e.clientX - lastMove[0], e.clientY - lastMove[1]) > 12) wake();
    lastMove = [e.clientX, e.clientY];
  });
  $('#barHandle').addEventListener('click', wake);

  return {
    render,
    read,
    reconcile,
    wake,
    clear: () => page.replaceChildren(),
    focus: () => page.focus(),
    resetScroll: () => { scroller.scrollTop = 0; },
    closeSettings: () => { $('#look').hidden = true; },
    get chars() { return chars; },
    get composing() { return composing; },
  };
}
