// 報修登記 Service Worker
// 修改任何網頁檔案後，請把 VERSION 加 1，使用者下次開啟時才會換成新版。
const VERSION = "v1";
const CACHE = "repair-app-" + VERSION;

// 網頁本身的檔案（相對路徑，適用 GitHub Pages 的 /jc/ 子路徑）
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./config.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

// supabase-js 程式庫（固定版本，內容不會變，可以長期快取）
const CDN_PREFIX = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_SHELL);
    // 程式庫另外快取；失敗不影響安裝，第一次使用時會再補進快取
    try {
      await cache.add(CDN_PREFIX + "dist/umd/supabase.js");
    } catch (e) { /* 略過 */ }
    await self.skipWaiting();
  })());
});

// 啟用新版時刪除舊版快取
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith("repair-app-") && k !== CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // 送出報修（POST）一律直接走網路

  const url = new URL(req.url);

  // 固定版本的程式庫：先用快取，沒有才下載
  if (url.href.startsWith(CDN_PREFIX)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // 只處理本站檔案；Supabase 的資料請求不快取，清單永遠是最新資料
  if (url.origin !== self.location.origin) return;

  // 本站檔案：先用網路取得最新版，離線時改用快取
  event.respondWith(networkFirst(req));
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    if (req.mode === "navigate") {
      const shell = await cache.match("./index.html");
      if (shell) return shell;
    }
    throw err;
  }
}
