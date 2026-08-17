// /api/geocode エンドポイント
// 都市名・郵便番号から地点候補を検索する。ブラウザから外部APIへ直接
// アクセスさせず（CSP: connect-src 'self'を維持）、Workerが代理で問い合わせる

import { GEOCODING_MAX_QUERY_LENGTH } from '../constants';
import { fetchGeocoding } from '../weather/geocoding';
import { UpstreamError } from '../weather/openMeteo';
import { json, jsonError, preflightResponse } from './forecast';

/**
 * GET /api/geocode?q=松山
 * GET /api/geocode?q=790-0067 （郵便番号でも検索できる）
 */
export async function handleGeocode(request: Request): Promise<Response> {
  // /api/forecastと同じCORS契約（プリフライト対応）を維持する
  if (request.method === 'OPTIONS') {
    return preflightResponse();
  }

  if (request.method !== 'GET') {
    return jsonError(405, 'GETメソッドのみ対応しています');
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim();
  if (query === '') {
    return jsonError(400, 'クエリパラメータq（都市名または郵便番号）を指定してください');
  }
  if (query.length > GEOCODING_MAX_QUERY_LENGTH) {
    return jsonError(400, `検索語は${GEOCODING_MAX_QUERY_LENGTH}文字以内で指定してください`);
  }

  try {
    const results = await fetchGeocoding(query);
    // レスポンス自体はブラウザにキャッシュさせない（no-store）。検索ロジックの
    // 改善・修正後も古い「0件」応答が利用者のブラウザに残り続けるのを防ぐため。
    // 上流への問い合わせはgeocoding.ts側でエッジに7日間キャッシュされ、
    // 0件時の接尾辞補完も2文字以下に限定しているため、上流の無料枠への負荷は限定的
    return json({ results });
  } catch (error) {
    if (error instanceof UpstreamError) {
      console.error('地点検索の上流エラー:', url.pathname + url.search, error.message);
      return jsonError(502, error.message);
    }
    throw error;
  }
}
