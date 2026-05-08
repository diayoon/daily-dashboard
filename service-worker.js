/* Daystrip Service Worker
   - HTML/JS는 네트워크 우선 (network-first) — 항상 최신 버전 시도
   - 아이콘/매니페스트는 캐시 우선 — 빠르게 로드
   - 새 SW 활성화되면 클라이언트에 알림 메시지 보내서 reload 유도
*/

const VERSION = '2026.05.07.01';
const STATIC_CACHE = `daystrip-${VERSION}`;

self.addEventListener('install', (event) => {
  // 새 버전 즉시 활성화
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 옛날 캐시 청소
    const names = await caches.keys();
    await Promise.all(
      names.filter(n => n !== STATIC_CACHE).map(n => caches.delete(n))
    );
    await self.clients.claim();
    // 활성화된 클라이언트들에 새 SW 메시지 전송
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(c => c.postMessage({ type: 'SW_UPDATED', version: VERSION }));
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 외부 도메인 (Yahoo·Stooq·CORS proxy·Open-Meteo 등)은 SW가 손대지 않음 — 항상 직접 fetch
  if (url.origin !== self.location.origin) return;

  // HTML(navigate) — network-first
  const acceptHeader = req.headers.get('accept') || '';
  const isHtml = req.mode === 'navigate' || acceptHeader.includes('text/html');

  if (isHtml) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-cache' });
        const cache = await caches.open(STATIC_CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch(e) {
        const cached = await caches.match(req);
        return cached || new Response('오프라인입니다', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  // 기타 정적 자원(아이콘·매니페스트·service-worker.js 자체) — cache-first 후 백그라운드 갱신
  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(req);
    if (cached) {
      // 백그라운드에서 갱신 시도
      fetch(req).then(fresh => {
        if (fresh && fresh.ok) cache.put(req, fresh.clone());
      }).catch(() => {});
      return cached;
    }
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    } catch(e) {
      return new Response('', { status: 503 });
    }
  })());
});
