// 오프라인 지원: 한 번 받은 파일을 기기에 보관해 인터넷 없이도 앱이 열리게 한다.
const CACHE = 'jipilsil-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// 이름에 해시가 붙은 큰 파일(엔진·글꼴)은 내용이 바뀌지 않으므로 보관본을 먼저 쓴다.
const immutable = (url) => /\/studio\/(assets|fonts)\//.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (immutable(url)) {
      const hit = await cache.match(req);
      if (hit) return hit;
    }
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      throw err;
    }
  })());
});
