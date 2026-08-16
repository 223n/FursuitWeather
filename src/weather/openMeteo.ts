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
  };
}

/** 上流APIの取得失敗を表すエラー */
export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}

/** 取得URLを組み立てる */
export function buildForecastUrl(latitude: number, longitude: number, days: number): string {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    hourly: HOURLY_FIELDS.join(','),
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

  // WBGT計算に必要な項目（気温・湿度・体感温度・風速・日射量）の欠測・非数値は
  // その時間を破棄する。
  // 特に日射量を0で補うと日中のWBGTが最大約3℃低く（危険側に）出るため、既定値では補わない
  if (
    typeof time !== 'string' ||
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
 * 時間別の気象データを取得する
 * HTTP通信とトランスポート層のエラー処理のみを担い、検証・変換はparseWeatherResponseに委ねる
 *
 * @param fetchImpl テスト時にモックを注入するためのfetch実装
 */
export async function fetchWeather(
  latitude: number,
  longitude: number,
  days: number,
  fetchImpl: typeof fetch = fetch,
): Promise<WeatherResult> {
  const url = buildForecastUrl(latitude, longitude, days);

  let response: Response;
  try {
    response = await fetchImpl(url, {
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
    throw new UpstreamError(
      `気象データの取得に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    throw new UpstreamError(`気象データAPIがエラーを返しました（HTTP ${response.status}）`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new UpstreamError('気象データAPIのレスポンスを解析できませんでした');
  }

  return parseWeatherResponse(data);
}
