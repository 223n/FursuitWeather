// FursuitWeather Workerエントリポイント
// /api/* のみ本Workerが処理し、それ以外は静的アセット（public/）が配信される
// （wrangler.jsoncのassets.run_worker_first設定による）

import { handleForecast, jsonError } from './api/forecast';
import { handleGeocode } from './api/geocode';

export interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/forecast') {
      // 最終防衛線: 予期しない例外もCORSヘッダー付きのJSONで返し、公開APIの契約を守る
      // （awaitなしのreturnでは非同期の失敗を捕捉できないため必ずawaitする）
      try {
        return await handleForecast(request);
      } catch (error) {
        // ログ行単体で再現条件（座標・日数）が分かるよう、リクエストの文脈を添える
        console.error('予期しないエラー:', url.pathname + url.search, error);
        return jsonError(500, 'サーバー内部でエラーが発生しました');
      }
    }

    if (url.pathname === '/api/geocode') {
      try {
        return await handleGeocode(request);
      } catch (error) {
        console.error('予期しないエラー:', url.pathname + url.search, error);
        return jsonError(500, 'サーバー内部でエラーが発生しました');
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return jsonError(404, '存在しないAPIパスです');
    }

    // run_worker_firstの対象外パスは通常ここに到達しないが、念のためアセットへ委譲する
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
