// FursuitWeather Workerエントリポイント
// /api/* とHTMLページを本Workerが処理し、それ以外は静的アセット（public/）が
// 配信される（wrangler.jsoncのassets.run_worker_first設定による）

import { handleForecast } from './api/forecast';
import { handleGeocode } from './api/geocode';
import { jsonError, methodGuard } from './api/http';
import { buildHtmlCsp, isHtmlPath } from './csp';

export interface Env {
  ASSETS: Fetcher;
}

/**
 * APIパスとハンドラの対応表。エンドポイントの追加はここへ1行足す。
 * ハンドラはこのルーター経由でのみ呼ばれ、GET前提でよい
 * （メソッド制約・CORSプリフライトはルーターが一括適用する）
 */
const API_ROUTES = new Map<string, (request: Request) => Promise<Response>>([
  ['/api/forecast', handleForecast],
  ['/api/geocode', handleGeocode],
]);

/**
 * HTMLへリクエストごとのnonceを差し込んで返す
 *
 * script・styleタグとCSPへ同じnonceを入れることで、ホスト許可リストに頼らず
 * 「このページが載せたスクリプトだけ」を実行できる。JSON-LDは実行されない
 * データブロックのためnonceを付けない（付けても無害だが、実行対象と
 * 紛らわしいので明示的に除外する）。
 * nonceは毎回変わるため、共有キャッシュに載らないようno-storeを付ける
 */
async function withNonce(asset: Response, nonce: string): Promise<Response> {
  const rewritten = new HTMLRewriter()
    .on('script', {
      element(element): void {
        if (element.getAttribute('type') !== 'application/ld+json') {
          element.setAttribute('nonce', nonce);
        }
      },
    })
    .on('style', {
      element(element): void {
        element.setAttribute('nonce', nonce);
      },
    })
    .transform(asset);

  const headers = new Headers(rewritten.headers);
  headers.set('Content-Security-Policy', buildHtmlCsp(nonce));
  headers.set('Cache-Control', 'no-store');
  return new Response(rewritten.body, {
    status: rewritten.status,
    statusText: rewritten.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    const url = new URL(request.url);

    const route = API_ROUTES.get(url.pathname);
    if (route) {
      const guard = methodGuard(request);
      if (guard) {
        return guard;
      }
      // 最終防衛線: 予期しない例外もCORSヘッダー付きのJSONで返し、公開APIの契約を守る
      // （awaitなしのreturnでは非同期の失敗を捕捉できないため必ずawaitする）
      try {
        return await route(request);
      } catch (error) {
        // ログ行単体で再現条件（座標・日数）が分かるよう、リクエストの文脈を添える
        console.error('予期しないエラー:', url.pathname + url.search, error);
        return jsonError(500, 'サーバー内部でエラーが発生しました');
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return jsonError(404, '存在しないAPIパスです');
    }

    // HTMLページはリクエストごとのnonceを差し込んで返す
    if (isHtmlPath(url.pathname)) {
      const asset = await env.ASSETS.fetch(request);
      return withNonce(asset, crypto.randomUUID());
    }

    // run_worker_firstの対象外パスは通常ここに到達しないが、念のためアセットへ委譲する
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
