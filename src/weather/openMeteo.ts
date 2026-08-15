// Open-Meteo JMAモデルAPIクライアント
// 気象庁MSM（約5kmメッシュ・1時間粒度・4日先）を優先し、以降はGSMに自動接続する
// jma_seamlessモデルのデータを取得する。APIキーは不要（非商用・要出典表記）

import { OPEN_METEO_BASE_URL, UPSTREAM_CACHE_TTL_SECONDS } from '../constants';
import type { HourlyWeather } from '../types';

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
    hourly: [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'precipitation',
      'weather_code',
      'shortwave_radiation',
      'wind_speed_10m',
    ].join(','),
    timezone: 'Asia/Tokyo',
    // 風速はWBGT式に合わせてm/sで取得する（デフォルトはkm/h）
    wind_speed_unit: 'ms',
    forecast_days: String(days),
  });
  return `${OPEN_METEO_BASE_URL}?${params.toString()}`;
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

  if (
    time === undefined ||
    temperature === null ||
    temperature === undefined ||
    humidity === null ||
    humidity === undefined ||
    apparentTemperature === null ||
    apparentTemperature === undefined ||
    windSpeed === null ||
    windSpeed === undefined
  ) {
    return null;
  }

  return {
    time,
    temperature,
    humidity,
    apparentTemperature,
    // 降水量・天気コード・日射量は欠測でも予報自体は成立するため既定値で補う
    precipitation: precipitation ?? 0,
    weatherCode: weatherCode ?? -1,
    solarRadiation: solarRadiation ?? 0,
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
 * 時間別の気象データを取得する
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
    } as RequestInit);
  } catch (error) {
    throw new UpstreamError(
      `気象データの取得に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    throw new UpstreamError(`気象データAPIがエラーを返しました（HTTP ${response.status}）`);
  }

  const data = (await response.json()) as OpenMeteoResponse;
  if (!data.hourly || !Array.isArray(data.hourly.time)) {
    throw new UpstreamError('気象データAPIのレスポンス形式が想定と異なります');
  }

  const hours: HourlyWeather[] = [];
  for (let i = 0; i < data.hourly.time.length; i += 1) {
    const hour = pickHour(data.hourly, i);
    if (hour) {
      hours.push(hour);
    }
  }

  if (hours.length === 0) {
    throw new UpstreamError('気象データが空でした');
  }

  return {
    hours,
    latitude: data.latitude,
    longitude: data.longitude,
    timezone: data.timezone,
  };
}
