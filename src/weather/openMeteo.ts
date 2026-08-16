// Open-Meteo JMAモデルAPIクライアント
// 気象庁MSM（約5kmメッシュ・1時間粒度・4日先）を優先し、以降はGSMに自動接続する
// jma_seamlessモデルのデータを取得する。APIキーは不要（非商用・要出典表記）

import {
  OPEN_METEO_BASE_URL,
  UPSTREAM_CACHE_TTL_SECONDS,
  UPSTREAM_TIMEOUT_MS,
} from '../constants';
import type { HourlyWeather } from '../types';

/**
 * 取得・検証に使うhourlyデータフィールド（時刻timeを除く）
 * 取得URL（buildForecastUrl）とレスポンス検証（parseWeatherResponse）の両方が参照する
 * 単一情報源。フィールドを追加する際はOpenMeteoResponse型とpickHourも更新すること。
 * 注意: 'time'はレスポンスにのみ現れる（URLのhourlyパラメータに含めると上流がエラーを返す）
 */
const HOURLY_FIELDS = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'precipitation',
  'weather_code',
  'shortwave_radiation',
  'wind_speed_10m',
] as const;

/**
 * あれば使う任意のhourlyフィールド（表示の補助情報）
 * 上流モデルが提供しない可能性があるため、レスポンス検証では必須にせず、
 * 取得URLが400で拒否された場合は任意フィールドなしで再試行する
 */
const OPTIONAL_HOURLY_FIELDS = ['precipitation_probability'] as const;

/** Open-Meteoのレスポンスのうち本サービスが使用する部分 */
interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  hourly: {
    time: string[];
    temperature_2m: (number | null)[];
    relative_humidity_2m: (number | null)[];
    apparent_temperature: (number | null)[];
    precipitation: (number | null)[];
    weather_code: (number | null)[];
    shortwave_radiation: (number | null)[];
    wind_speed_10m: (number | null)[];
    /** 任意フィールド: 上流が提供しない場合は存在しない */
    precipitation_probability?: (number | null)[];
  };
}

/** 上流APIの取得失敗を表すエラー */
export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}

/**
 * 取得URLを組み立てる
 *
 * @param withOptionalFields falseなら任意フィールド（降水確率）を含めない（400時の再試行用）
 */
export function buildForecastUrl(
  latitude: number,
  longitude: number,
  days: number,
  withOptionalFields = true,
): string {
  const fields: readonly string[] = withOptionalFields
    ? [...HOURLY_FIELDS, ...OPTIONAL_HOURLY_FIELDS]
    : HOURLY_FIELDS;
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    hourly: fields.join(','),
    timezone: 'Asia/Tokyo',
    // 風速はWBGT式に合わせてm/sで取得する（デフォルトはkm/h）
    wind_speed_unit: 'ms',
    forecast_days: String(days),
  });
  return `${OPEN_METEO_BASE_URL}?${params.toString()}`;
}

/**
 * 有限の数値のみを通す型ガード
 * 配列の要素型は型主張（as）でしか保証されないため、null・undefinedに加えて
 * 数値文字列・NaNなど「数値でない値」も実行時に排除する
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 時刻文字列の形式（YYYY-MM-DDTHH:mm、types.tsのHourlyWeather.timeの契約）
 * 下流（hourOf/dateOf・フロントのformatDate）は位置ベースで切り出すため、
 * 形式が異なる時刻はここで破棄する
 */
const TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** レスポンスの並列配列から1時間分のレコードを取り出す。欠測はnullを返す */
function pickHour(hourly: OpenMeteoResponse['hourly'], index: number): HourlyWeather | null {
  const time = hourly.time[index];
  const temperature = hourly.temperature_2m[index];
  const humidity = hourly.relative_humidity_2m[index];
  const apparentTemperature = hourly.apparent_temperature[index];
  const precipitation = hourly.precipitation[index];
  const weatherCode = hourly.weather_code[index];
  const solarRadiation = hourly.shortwave_radiation[index];
  const windSpeed = hourly.wind_speed_10m[index];
  const precipitationProbability = hourly.precipitation_probability?.[index];

  // WBGT計算に必要な項目（気温・湿度・体感温度・風速・日射量）の欠測・非数値は
  // その時間を破棄する。
  // 特に日射量を0で補うと日中のWBGTが最大約3℃低く（危険側に）出るため、既定値では補わない
  if (
    typeof time !== 'string' ||
    !TIME_PATTERN.test(time) ||
    !isFiniteNumber(temperature) ||
    !isFiniteNumber(humidity) ||
    !isFiniteNumber(apparentTemperature) ||
    !isFiniteNumber(windSpeed) ||
    !isFiniteNumber(solarRadiation)
  ) {
    return null;
  }

  return {
    time,
    temperature,
    humidity,
    apparentTemperature,
    // 降水量・天気コードは表示用のため、欠測・非数値でも既定値で補って時間を残す
    precipitation: isFiniteNumber(precipitation) ? precipitation : 0,
    // 降水確率は任意フィールドのため、欠測・非提供はnull（フロントは「-」表示）
    precipitationProbability: isFiniteNumber(precipitationProbability)
      ? precipitationProbability
      : null,
    weatherCode: isFiniteNumber(weatherCode) ? weatherCode : -1,
    solarRadiation,
    windSpeed,
  };
}

export interface WeatherResult {
  hours: HourlyWeather[];
  latitude: number;
  longitude: number;
  timezone: string;
}

/**
 * 上流レスポンスを検証してWeatherResultへ変換する純粋関数
 * 形式の異常はUpstreamErrorとして投げる（上流の仕様変更・異常応答への防御）
 */
export function parseWeatherResponse(data: unknown): WeatherResult {
  const candidate = data as OpenMeteoResponse;
  const requiredArrays = ['time', ...HOURLY_FIELDS] as const;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof candidate.latitude !== 'number' ||
    typeof candidate.longitude !== 'number' ||
    typeof candidate.timezone !== 'string' ||
    typeof candidate.hourly !== 'object' ||
    candidate.hourly === null ||
    requiredArrays.some((key) => !Array.isArray(candidate.hourly[key]))
  ) {
    throw new UpstreamError('気象データAPIのレスポンス形式が想定と異なります');
  }

  const hours: HourlyWeather[] = [];
  for (let i = 0; i < candidate.hourly.time.length; i += 1) {
    const hour = pickHour(candidate.hourly, i);
    if (hour) {
      hours.push(hour);
    }
  }

  if (hours.length === 0) {
    throw new UpstreamError('気象データが空でした');
  }

  return {
    hours,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    timezone: candidate.timezone,
  };
}

/**
 * 上流が任意フィールドを拒否したことの記憶（アイソレート単位）
 * 恒常的な400のとき、400応答はエッジにキャッシュされないため、記憶しないと
 * 全リクエストが「400→再試行」の2往復になり無料枠保護が無効化される。
 * アイソレート再起動で自動リセットされるため、上流が対応すれば自然復帰する
 */
let optionalFieldsRejected = false;

/** テスト用: 任意フィールド拒否の記憶をリセットする */
export function resetOptionalFieldsRejected(): void {
  optionalFieldsRejected = false;
}

/** 上流へのHTTPリクエスト1回分。トランスポート失敗はUpstreamErrorへ変換する */
async function requestUpstream(url: string, fetchImpl: typeof fetch): Promise<Response> {
  try {
    return await fetchImpl(url, {
      headers: { 'User-Agent': 'FursuitWeather (https://github.com/223n/FursuitWeather)' },
      // Cloudflareのエッジで上流レスポンスをキャッシュし、Open-Meteoの
      // 無料枠レート制限（1万コール/日）を守る。MSMの更新は3時間ごと
      cf: {
        cacheTtl: UPSTREAM_CACHE_TTL_SECONDS,
        cacheEverything: true,
      },
      // 上流の応答停滞時にユーザーリクエストを長時間待たせないための打ち切り。
      // 中断はfetchのrejectとしてcatchに入り、既存のUpstreamError（502）分類に乗る
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    // 原因（英語のランタイムメッセージ）はログにのみ残し、
    // 利用者へ返すメッセージには固定の日本語文を使う
    console.error('気象データの取得に失敗:', url, error);
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    throw new UpstreamError(
      isTimeout
        ? '気象データの取得がタイムアウトしました。時間をおいて再度お試しください'
        : '気象データの取得に失敗しました。時間をおいて再度お試しください',
    );
  }
}

/**
 * 時間別の気象データを取得する
 * HTTP通信とトランスポート層のエラー処理のみを担い、検証・変換はparseWeatherResponseに委ねる
 * 任意フィールドが原因の400は必須フィールドのみで一度だけ再試行する
 *
 * @param fetchImpl テスト時にモックを注入するためのfetch実装
 */
export async function fetchWeather(
  latitude: number,
  longitude: number,
  days: number,
  fetchImpl: typeof fetch = fetch,
): Promise<WeatherResult> {
  let url = buildForecastUrl(latitude, longitude, days, !optionalFieldsRejected);
  let response = await requestUpstream(url, fetchImpl);

  if (response.status === 400 && !optionalFieldsRejected) {
    // 任意フィールド（降水確率）を上流モデルが受け付けない場合に備え、
    // 必須フィールドのみのURLで一度だけ再試行する（恒常的な400ならログで気付ける）。
    // 以後のリクエストは最初からフォールバックURLを使い、エッジキャッシュの保護下に戻す
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    console.error('気象データAPIが400を返したため任意フィールドなしで再試行:', url, detail);
    optionalFieldsRejected = true;
    url = buildForecastUrl(latitude, longitude, days, false);
    response = await requestUpstream(url, fetchImpl);
  }

  if (!response.ok) {
    // 失敗理由（Open-Meteoのエラー本文）はログにのみ残す。
    // ボディを消費することで、未読ストリームによる上流接続の保持も防ぐ
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    console.error('気象データAPIエラー:', url, response.status, detail);
    throw new UpstreamError(`気象データAPIがエラーを返しました（HTTP ${response.status}）`);
  }

  // 200応答でも中身が想定外（仕様変更・不完全JSON・中間装置のHTML応答）になる
  // 障害が現実には最も起こりやすいため、原因の一次証拠（ボディ先頭）をログに残す
  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    console.error('気象データAPIレスポンスの読み取りに失敗:', url, error);
    throw new UpstreamError('気象データAPIのレスポンスを解析できませんでした');
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error('気象データAPIレスポンスの解析に失敗:', url, raw.slice(0, 200));
    throw new UpstreamError('気象データAPIのレスポンスを解析できませんでした');
  }

  try {
    return parseWeatherResponse(data);
  } catch (error) {
    if (error instanceof UpstreamError) {
      console.error('気象データAPIレスポンスの形式異常:', url, raw.slice(0, 200));
    }
    throw error;
  }
}
