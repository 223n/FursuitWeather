// /api/geocode エンドポイント
// 都市名・郵便番号から地点候補を検索する。ブラウザから外部APIへ直接
// アクセスさせず（CSP: connect-src 'self'を維持）、Workerが代理で問い合わせる

import { GEOCODING_MAX_QUERY_LENGTH } from '../constants';
import { fetchGeocoding } from '../weather/geocoding';
import { json, jsonError } from './http';

/**
 * GET /api/geocode?q=松山
 * GET /api/geocode?q=790-0067 （郵便番号でも検索できる）
 */
export async function handleGeocode(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim();
  if (query === '') {
    return jsonError(400, 'クエリパラメータq（都市名または郵便番号）を指定してください');
  }
  if (query.length > GEOCODING_MAX_QUERY_LENGTH) {
    return jsonError(400, `検索語は${GEOCODING_MAX_QUERY_LENGTH}文字以内で指定してください`);
  }

  // 上流障害（UpstreamError）の502変換はルーター（src/index.ts）が担う
  const results = await fetchGeocoding(query);
  // レスポンス自体はブラウザにキャッシュさせない（no-store）。検索ロジックの
  // 改善・修正後も古い「0件」応答が利用者のブラウザに残り続けるのを防ぐため。
  // 上流への問い合わせはgeocoding.ts側でエッジに7日間キャッシュされ、
  // 0件時の接尾辞補完も2文字以下に限定しているため、上流の無料枠への負荷は限定的
  return json({ results });
}
