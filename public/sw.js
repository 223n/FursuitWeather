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
  '/emergency',
  '/app.js',
  '/prefs.js',
  '/wbgt-tool.js',
  '/display.js',
  '/favicon.svg',
  '/events.json',
];

// オフラインで、保存済みのページも無いナビゲーションに返す簡易ページ。
// ブラウザの「接続できません」画面の代わりに、熱中症の緊急時の導線だけは残す
// （/emergencyはSHELL_URLSで事前保存しているためオフラインでも開ける）。
// SW内で組み立てる応答はWorkerのCSPを通らないため、ここで最小限のCSPを付ける
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>オフラインです - FursuitWeather</title>
<style>
:root { color-scheme: light dark; --fg: #1a1a1a; --bg: #ffffff; --link: #0050a0; }
@media (prefers-color-scheme: dark) { :root { --fg: #f0f0f0; --bg: #121212; --link: #8cc4ff; } }
body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--fg);
  font-family: system-ui, sans-serif; line-height: 1.7; }
main { max-width: 36em; margin: 0 auto; }
a { color: var(--link); }
a:focus-visible { outline: 3px solid #A66E00; outline-offset: 2px; }
.urgent { border-left: 4px solid #d03030; padding-left: 12px; }
</style>
</head>
<body>
<main>
<h1>オフラインです</h1>
<p>インターネットに接続できないため、このページを表示できません。接続を確認してから、再読み込みしてください。</p>
<p class="urgent"><strong>熱中症が疑われるときは、ためらわず119番へ通報してください。</strong><br>
<a href="/emergency">もしものとき（熱中症の応急対応）</a>はオフラインでも開けます。</p>
<p><a href="/">予報トップ</a>（以前に開いたことがあれば、保存済みの予報を表示します）</p>
</main>
</body>
</html>`;

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

/** 開いたCacheを受け取り、件数を上限までに間引く（古いものから削除） */
async function trimCache(cache, max) {
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
      await trimCache(cache, maxEntries);
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

/**
 * ナビゲーションのキャッシュキー（パス）。共有URL（/?lat=...）もシェルは同一のため
 * クエリは捨て、/index.html・/about.htmlなどの別名は、事前保存（SHELL_URLS）と同じ
 * 拡張子なしの正規パスへ寄せる（別名で開くとオフライン時に保存分を引けないため）
 */
function navigationKey(url) {
  const path = new URL(url).pathname;
  if (path === '/index.html') {
    return '/';
  }
  return path.endsWith('.html') ? path.slice(0, -'.html'.length) : path;
}

/** オフラインで保存済みのページも無いナビゲーションへの応答 */
function offlinePage() {
  return new Response(OFFLINE_HTML, {
    status: 503,
    statusText: 'Service Unavailable',
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}

/** 静的アセット: ネットワーク優先。オフライン時のみキャッシュで応答する */
async function shellNetworkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const isNavigation = request.mode === 'navigate';
  const key = isNavigation ? navigationKey(request.url) : request;
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
    // ページの移動はブラウザのエラー画面にせず、緊急時の導線を残した簡易ページを返す
    // （画像・JSなどのサブリソースは従来どおりネットワークエラーとして扱う）
    return isNavigation ? offlinePage() : Response.error();
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
    // 全国天気（会場表示モード）: クエリなしの本番取得だけを専用キャッシュに1件保存する。
    // ?demo=1（リハーサル用）は別エントリになり、専用キャッシュへ入れると
    // trimCacheが本番分を追い出してしまうため、クエリ付きは地点予報側の
    // キャッシュ（上限10件）へ回す
    const isPlain = url.search === '';
    event.respondWith(
      dataNetworkFirst(request, isPlain ? NATIONAL_CACHE : DATA_CACHE, isPlain ? 1 : MAX_DATA_ENTRIES),
    );
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    // 地点検索などはキャッシュしない（オフライン時は通常のエラー表示に任せる）
    return;
  }
  event.respondWith(shellNetworkFirst(request));
});
