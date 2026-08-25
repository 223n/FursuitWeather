// FursuitWeather Workerエントリポイント
// /api/* とHTMLページを本Workerが処理し、それ以外は静的アセット（public/）が
// 配信される（wrangler.jsoncのassets.run_worker_first設定による）

import { handleBadge } from './api/badge';
import { handleEventsCalendar } from './api/events';
import { handleForecast } from './api/forecast';
import { handleGeocode } from './api/geocode';
import { handleNational } from './api/national';
import { jsonError, methodGuard, upstreamErrorResponse } from './api/http';
import { isHtmlPath, withNonce } from './csp';
import { ogSummaryFor } from './ogp';

export interface Env {
  ASSETS: Fetcher;
}

/**
 * APIパスとハンドラの対応表。エンドポイントの追加はここへ1行足す。
 * ハンドラはこのルーター経由でのみ呼ばれ、GET前提でよい
 * （メソッド制約・CORSプリフライトはルーターが一括適用する）。
 * ハンドラはUpstreamErrorをそのまま投げてよい（502変換もルーターの責務）
 */
const API_ROUTES = new Map<string, (request: Request, env: Env) => Promise<Response>>([
  ['/api/forecast', handleForecast],
  ['/api/geocode', handleGeocode],
  ['/api/national', handleNational],
  ['/api/events.ics', handleEventsCalendar],
  ['/api/badge.svg', handleBadge],
]);

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    const url = new URL(request.url);

    const route = API_ROUTES.get(url.pathname);
    if (route) {
      const guard = methodGuard(request);
      if (guard) {
        return guard;
      }
      // 最終防衛線: 上流障害は502、予期しない例外もCORSヘッダー付きのJSON 500で
      // 返し、公開APIの契約を守る
      // （awaitなしのreturnでは非同期の失敗を捕捉できないため必ずawaitする）
      try {
        return await route(request, env);
      } catch (error) {
        const upstream = upstreamErrorResponse(error, url);
        if (upstream) {
          return upstream;
        }
        // ログ行単体で再現条件（座標・日数）が分かるよう、リクエストの文脈を添える
        console.error('予期しないエラー:', url.pathname + url.search, error);
        return jsonError(500, 'サーバー内部でエラーが発生しました');
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return jsonError(404, '存在しないAPIパスです');
    }

    // HTMLページはリクエストごとのnonceを差し込んで返す
    // （リンクプレビュー用クローラーには当日判定のOGサマリーも差し込む。
    //   ベストエフォートのためnull（通常閲覧・取得失敗）でもHTML配信は続行する）
    if (isHtmlPath(url.pathname)) {
      const [asset, og] = await Promise.all([env.ASSETS.fetch(request), ogSummaryFor(request)]);
      return withNonce(asset, crypto.randomUUID(), og ?? undefined);
    }

    // run_worker_firstの対象外パスは通常ここに到達しないが、念のためアセットへ委譲する
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
