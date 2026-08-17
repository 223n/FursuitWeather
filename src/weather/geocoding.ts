// 地点検索クライアント
// 都市名はOpen-Meteoジオコーディングv1 APIで座標を検索する（APIキー不要）。
// 2文字以下の地名が0件のときは「市」「町」「村」「区」を補って再検索する（短い地名対策）。
// 日本の郵便番号はOpen-Meteoの検索で確実に引けないため、zipcloud（郵便番号→住所）で
// 市区町村名へ変換してから地名検索する。変換に失敗した場合は郵便番号のまま
// ハイフン有無の両形式で直接検索を試す

import {
  GEOCODING_BASE_URL,
  GEOCODING_CACHE_TTL_SECONDS,
  GEOCODING_CITY_SUFFIXES,
  GEOCODING_MAX_RESULTS,
  UPSTREAM_TIMEOUT_MS,
  ZIPCLOUD_BASE_URL,
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
 * 1回分の地名検索を実行する
 *
 * @param fetchImpl テスト時にモックを注入するためのfetch実装
 */
async function searchByName(
  query: string,
  fetchImpl: typeof fetch,
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

/**
 * 市区町村の接尾辞を補いながら地名検索する
 * Open-Meteoジオコーディングは2文字以下の検索語を完全一致でしか照合しないため、
 * 「蒲郡」のように登録名が「蒲郡市」の地点は素の検索で0件になる。
 * 2文字以下で0件のときに限り「市」「町」「村」「区」を順に補って再検索する。
 * 3文字以上は部分一致が働くため補完で救えるケースがほぼなく、任意の0件クエリで
 * 上流呼び出しが増幅されて無料枠を圧迫するのを避けるため対象にしない
 * （zipcloud由来の市区町村名は正式名称のため、この補完は利用者入力の地名にのみ使う）
 */
async function searchByNameWithCitySuffixes(
  query: string,
  fetchImpl: typeof fetch,
): Promise<GeocodeResult[]> {
  const results = await searchByName(query, fetchImpl);
  if (results.length > 0 || [...query].length > 2) {
    return results;
  }
  // 再検索の連鎖には全体の時間予算を設け、上流が遅いときに
  // 利用者を数十秒待たせない（各呼び出しの個別タイムアウトとは別枠）
  const deadline = Date.now() + UPSTREAM_TIMEOUT_MS;
  for (const suffix of GEOCODING_CITY_SUFFIXES) {
    if (Date.now() >= deadline) {
      console.error('地点検索の接尾辞補完を時間切れで打ち切り:', query);
      break;
    }
    // 「大村」→「大村村」のように同じ接尾辞を重ねない
    if (query.endsWith(suffix)) {
      continue;
    }
    const retried = await searchByName(query + suffix, fetchImpl);
    if (retried.length > 0) {
      return retried;
    }
  }
  return [];
}

/** 全角の数字・ハイフン類を半角へ正規化する */
function normalizeQuery(query: string): string {
  return query
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/[ー−‐―ｰ]/g, '-')
    .trim();
}

/**
 * 日本の郵便番号を住所（市区町村名）へ変換する
 * 補助手段のため、失敗しても検索全体は継続する（ログには残す）
 */
async function resolvePostalCode(
  digits: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const url = `${ZIPCLOUD_BASE_URL}?zipcode=${digits}`;
  try {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': 'FursuitWeather (https://github.com/223n/FursuitWeather)' },
      // 郵便番号データはほぼ変化しないため長めにエッジキャッシュする
      cf: {
        cacheTtl: GEOCODING_CACHE_TTL_SECONDS,
        cacheEverything: true,
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error('郵便番号APIエラー:', url, response.status);
      return null;
    }
    const data = (await response.json()) as {
      results?: { address2?: unknown }[] | null;
    };
    const city = data?.results?.[0]?.address2;
    return typeof city === 'string' && city !== '' ? city : null;
  } catch (error) {
    console.error('郵便番号の変換に失敗:', url, error);
    return null;
  }
}

/**
 * 都市名・郵便番号から地点候補を検索する
 * 郵便番号はzipcloudで市区町村名へ変換してから地名検索し、
 * 変換できない場合はハイフン有無の両形式で直接検索を試す
 *
 * @param fetchImpl テスト時にモックを注入するためのfetch実装
 */
export async function fetchGeocoding(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GeocodeResult[]> {
  const normalized = normalizeQuery(query);
  const digits = normalized.replace(/-/g, '');

  if (!/^\d{7}$/.test(digits)) {
    return searchByNameWithCitySuffixes(normalized, fetchImpl);
  }

  // 郵便番号: まず住所へ変換して市区町村名で検索する
  const city = await resolvePostalCode(digits, fetchImpl);
  if (city !== null) {
    const results = await searchByName(city, fetchImpl);
    if (results.length > 0) {
      return results;
    }
  }

  // 変換できない・市区町村名で見つからない場合は、郵便番号のまま両形式で試す
  const hyphenated = `${digits.slice(0, 3)}-${digits.slice(3)}`;
  const direct = await searchByName(hyphenated, fetchImpl);
  if (direct.length > 0) {
    return direct;
  }
  return searchByName(digits, fetchImpl);
}
