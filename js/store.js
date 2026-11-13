// 서재(문서 보관함). 문서는 이 기기의 브라우저 저장소(IndexedDB)에만 저장된다.
const DB = 'jipilsil';
const STORE = 'docs';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** 목록(최근 수정 순). 본문 바이트는 빼고 돌려준다. */
export async function listDocs() {
  const all = (await run('readonly', (s) => s.getAll())) || [];
  return all
    .map(({ id, name, updated, chars }) => ({ id, name, updated, chars }))
    .sort((a, b) => b.updated - a.updated);
}

export const getDoc = (id) => run('readonly', (s) => s.get(id));
export const putDoc = (doc) => run('readwrite', (s) => s.put(doc));
export const deleteDoc = (id) => run('readwrite', (s) => s.delete(id));

export const newId = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** 브라우저가 저장 공간을 마음대로 비우지 않도록 요청한다(가능한 경우). */
export function requestPersistence() {
  try { navigator.storage?.persist?.(); } catch { /* 지원 안 함 */ }
}
