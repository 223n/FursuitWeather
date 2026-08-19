// FursuitWeather Service Worker
// 方針: オンライン時は常にネットワーク優先で、キャッシュは「更新のみ」行う。
// オフライン時に限り、保存済みのコピー（シェルと最後に取得した予報）で応答する。
// これにより、デプロイ後に古い画面がオンラインの利用者へ配信されることはない。

const VERSION = 'v1';
const SHELL_CACHE = `fursuitweather-shell-${VERSION}`;
const DATA_CACHE = `fursuitweather-data-${VERSION}`;
// 全国天気は専用キャッシュに1件だけ保存する（地点予報の上限件数の追い出しに
// 巻き込まれると、会場表示モードの再起動時に全国スライドだけ空になるため）
const NATIONAL_CACHE = `fursuitweather-national-${VERSION}`;

// オフライン表示に最低限必要なシェル（HTMLはナビゲーション時にも都度更新される）
const SHELL_URLS = [
  '/',
  '/about',
  '/display',
  '/app.js',
  '/wbgt-tool.js',
  '/display.js',
  '/favicon.svg',
  '/events.json',
];

// 予報キャッシュの上限（地点ごとにURLが異なるため、直近の地点だけ残す）
const MAX_DATA_ENTRIES = 10;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      // ネットワーク優先のためキャッシュ内容の新旧が動作に影響せず、即時有効化してよい
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith('fursuitweather-') &&
                key !== SHELL_CACHE &&
                key !== DATA_CACHE &&
                key !== NATIONAL_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** キャッシュの件数を上限までに間引く（古いものから削除） */
async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i += 1) {
    await cache.delete(keys[i]);
  }
}

/** 取得時刻のヘッダーを付けたコピーを作る（オフライン表示時に鮮度を示すため） */
async function withCachedAt(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Cached-At', new Date().toISOString());
  const body = await response.clone().blob();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** 予報系API: ネットワーク優先。成功時はコピーを保存し、オフライン時のみ保存分で応答する */
async function dataNetworkFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, await withCachedAt(response));
      await trimCache(cacheName, maxEntries);
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      // フロントがオフライン表示であることを利用者へ知らせられるよう印を付ける
      const headers = new Headers(cached.headers);
      headers.set('X-Served-From-Cache', '1');
      return new Response(await cached.blob(), { status: 200, headers });
    }
    return Response.error();
  }
}

/** 静的アセット: ネットワーク優先。オフライン時のみキャッシュで応答する */
async function shellNetworkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  // 共有URL（/?lat=...）もシェルは同一のため、ナビゲーションはパス単位で保存する
  const key = request.mode === 'navigate' ? new URL(request.url).pathname : request;
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(key, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(key);
    if (cached) {
      return cached;
    }
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  if (url.pathname === '/api/forecast') {
    event.respondWith(dataNetworkFirst(request, DATA_CACHE, MAX_DATA_ENTRIES));
    return;
  }
  if (url.pathname === '/api/national') {
    // 全国天気（会場表示モード）はクエリ違いがないため1件だけ保存する
    event.respondWith(dataNetworkFirst(request, NATIONAL_CACHE, 1));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    // 地点検索などはキャッシュしない（オフライン時は通常のエラー表示に任せる）
    return;
  }
  event.respondWith(shellNetworkFirst(request));
});
