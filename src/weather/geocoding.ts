// Open-Meteoジオコーディングv1 APIクライアント
// 都市名・郵便番号から座標を検索する。郵便番号はGeoNamesの郵便番号データに基づく。
// APIキーは不要（非商用・要出典表記。気象APIと同じ提供元）

import {
  GEOCODING_BASE_URL,
  GEOCODING_CACHE_TTL_SECONDS,
  GEOCODING_MAX_RESULTS,
  UPSTREAM_TIMEOUT_MS,
} from '../constants';
import type { GeocodeResult } from '../types';
import { UpstreamError } from './openMeteo';

/** Open-Meteoジオコーディングのレスポンスのうち本サービスが使用する部分 */
interface GeocodingResponse {
  results?: {
    name?: unknown;
    admin1?: unknown;
    latitude?: unknown;
    longitude?: unknown;
    country_code?: unknown;
  }[];
}

/** 検索URLを組み立てる */
export function buildGeocodingUrl(query: string): string {
  const params = new URLSearchParams({
    name: query,
    // JPフィルタ後にも十分な候補が残るよう、上限より多めに取得する
    count: String(GEOCODING_MAX_RESULTS * 2),
    language: 'ja',
    format: 'json',
  });
  return `${GEOCODING_BASE_URL}?${params.toString()}`;
}

/**
 * 上流レスポンスを検証してGeocodeResult一覧へ変換する純粋関数
 * 形式の異常はUpstreamErrorとして投げる。該当なしは空配列（正常）
 */
export function parseGeocodingResponse(data: unknown): GeocodeResult[] {
  if (typeof data !== 'object' || data === null) {
    throw new UpstreamError('地点検索APIのレスポンス形式が想定と異なります');
  }
  const candidate = data as GeocodingResponse;
  // 該当なしのときresultsフィールド自体が存在しない仕様のため、欠落は空配列として扱う
  if (candidate.results === undefined) {
    return [];
  }
  if (!Array.isArray(candidate.results)) {
    throw new UpstreamError('地点検索APIのレスポンス形式が想定と異なります');
  }

  const results: GeocodeResult[] = [];
  for (const entry of candidate.results) {
    // 予報が気象庁モデル（日本域）前提のため、日本国内の候補のみ返す
    if (
      typeof entry !== 'object' ||
      entry === null ||
      entry.country_code !== 'JP' ||
      typeof entry.name !== 'string' ||
      entry.name === '' ||
      typeof entry.latitude !== 'number' ||
      !Number.isFinite(entry.latitude) ||
      typeof entry.longitude !== 'number' ||
      !Number.isFinite(entry.longitude)
    ) {
      continue;
    }
    results.push({
      name: entry.name,
      admin1: typeof entry.admin1 === 'string' ? entry.admin1 : '',
      latitude: entry.latitude,
      longitude: entry.longitude,
    });
    if (results.length >= GEOCODING_MAX_RESULTS) {
      break;
    }
  }
  return results;
}

/**
 * 都市名・郵便番号から地点候補を検索する
 *
 * @param fetchImpl テスト時にモックを注入するためのfetch実装
 */
export async function fetchGeocoding(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GeocodeResult[]> {
  const url = buildGeocodingUrl(query);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { 'User-Agent': 'FursuitWeather (https://github.com/223n/FursuitWeather)' },
      // 地名データはほぼ変化しないため長めにエッジキャッシュし、上流の無料枠を守る
      cf: {
        cacheTtl: GEOCODING_CACHE_TTL_SECONDS,
        cacheEverything: true,
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    console.error('地点検索の取得に失敗:', url, error);
    throw new UpstreamError('地点検索に失敗しました。時間をおいて再度お試しください');
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    console.error('地点検索APIエラー:', url, response.status, detail);
    throw new UpstreamError(`地点検索APIがエラーを返しました（HTTP ${response.status}）`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    console.error('地点検索APIレスポンスの解析に失敗:', url);
    throw new UpstreamError('地点検索APIのレスポンスを解析できませんでした');
  }

  return parseGeocodingResponse(data);
}
