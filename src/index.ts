// FursuitWeather Workerエントリポイント
// /api/* のみ本Workerが処理し、それ以外は静的アセット（public/）が配信される
// （wrangler.jsoncのassets.run_worker_first設定による）

import { handleForecast } from './api/forecast';

export interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/forecast') {
      return handleForecast(request);
    }

    if (url.pathname.startsWith('/api/')) {
      return new Response(
        JSON.stringify({ error: '存在しないAPIパスです' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        },
      );
    }

    // run_worker_firstの対象外パスは通常ここに到達しないが、念のためアセットへ委譲する
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
