// 離線也打得開：把 App 的畫面和程式存一份在手機裡（service worker，由 app.js 登記）
//   頁面：有網路先抓最新的；沒網路、或 4 秒內沒回應，才用存的那份，不會卡在舊版
//   css、js、圖示：網址帶版本號，同一版直接用存的；換版本就是新網址，會抓新的
//   Google 登入、試算表等其他網站：不經過這裡
//   版本號跟著 index.html 的 ?v=（app.js 登記成 sw.js?v=版本號）：換版本時重新存一份，舊的刪掉
//   安裝時照各頁面列出的檔案存（以後新增 js 不用改這裡）
//   快取名稱用 devmgr- 開頭：同一個網址底下（chi0416.github.io）的其他 App 也有自己的快取，只刪自己的
//   萬一出問題：把這個檔案換成只做 self.registration.unregister() 的版本，手機下次打開就會移除
const VERSION = new URL(location.href).searchParams.get('v') || 'dev';
const PREFIX = 'devmgr-';
const CACHE = `${PREFIX}${VERSION}`;
const ROOT = new URL('./', location.href).href;
const PAGES = ['./'];
const TIMEOUT = 4000;

// 頁面裡用到的本站檔案（css、js、圖示、manifest）；外站的網址有「:」，不算
const refs = html => [...html.matchAll(/(?:src|href)="([^"#:]+\.(?:css|js|png|json)(?:\?[^"#]*)?)"/g)].map(m => m[1]);
const bare = url => url.split(/[?#]/)[0];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const files = new Set();
    for (const page of PAGES) {
      const res = await fetch(page, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${page} ${res.status}`);
      refs(await res.clone().text()).forEach(f => files.add(f));
      await cache.put(new URL(page, ROOT).href, res);
    }
    await cache.addAll([...files]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(ROOT)) return;
  if (req.mode === 'navigate') e.respondWith(page(e));
  else e.respondWith(file(e));
});

// 頁面：先抓最新的；沒網路或太久沒回應才用存的（首頁另有 index.html 的寫法，找不到時用 ./ 那份）
//   太久沒回應時先給存的那份，網路後來回應了照樣存起來，下次打開就是新的
function page(e) {
  const key = bare(e.request.url).replace(/index\.html$/, '');
  const net = fetch(e.request);
  e.waitUntil(net.then(res => {
    if (!res.ok || res.type !== 'basic') return null;
    const copy = res.clone(); // 要在頁面讀走內容之前複製
    return caches.open(CACHE).then(cache => cache.put(key, copy));
  }).catch(() => {}));
  return (async () => {
    try {
      return await Promise.race([net, new Promise((_, no) => setTimeout(no, TIMEOUT))]);
    } catch (_) {
      const cache = await caches.open(CACHE);
      return (await cache.match(key)) || (await cache.match(ROOT)) || net;
    }
  })();
}

// css、js、圖示：存過就用存的，沒有才抓（抓到的也存起來）
async function file(e) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(e.request);
  if (hit) return hit;
  const res = await fetch(e.request);
  if (res.ok && res.type === 'basic') e.waitUntil(cache.put(e.request, res.clone()));
  return res;
}
