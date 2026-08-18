// Open-Meteo JMAモデルAPIクライアント
// 気象庁MSM（約5kmメッシュ・1時間粒度・4日先）を優先し、以降はGSMに自動接続する
// jma_seamlessモデルのデータを取得する。APIキーは不要（非商用・要出典表記）
// 降水確率のみ気象庁モデルにないため、標準予報APIから補完取得する（失敗しても
// 予報本体は成功させるベストエフォート）

import {
  OPEN_METEO_BASE_URL,
  OPEN_METEO_FORECAST_BASE_URL,
  UPSTREAM_CACHE_TTL_SECONDS,
  UPSTREAM_RETRY_DELAY_MS,
} from '../constants';
import type { HourlyWeather } from '../types';
import {
  fetchUpstream,
  isFiniteNumber,
  logUpstreamStatus,
  readUpstreamJson,
  throwUpstreamStatus,
  UpstreamError,
} from './upstream';

/**
 * 取得・検証に使うhourlyデータフィールド（時刻timeを除く）
 * 取得URL（buildForecastUrl）・レスポンス検証（parseWeatherResponse）・
 * レスポンス型（OpenMeteoResponse）が参照する単一情報源。
 * フィールドを追加する際はpickHourも更新すること。
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

/** Open-Meteoのレスポンスのうち本サービスが使用する部分（hourlyはHOURLY_FIELDSから導出） */
interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  hourly: { time: string[] } & Record<(typeof HOURLY_FIELDS)[number], (number | null)[]>;
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

/** 降水確率の取得URL（標準予報API）を組み立てる */
export function buildProbabilityUrl(latitude: number, longitude: number, days: number): string {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    hourly: 'precipitation_probability',
    timezone: 'Asia/Tokyo',
    forecast_days: String(days),
  });
  return `${OPEN_METEO_FORECAST_BASE_URL}?${params.toString()}`;
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
    // 降水確率は気象庁モデルにないため、後段で標準予報APIの値を合流させる
    // （合流できなかった時間はnullのまま。フロントは「-」表示）
    precipitationProbability: null,
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
 * 降水確率を標準予報APIから取得し、時刻→確率のMapに変換する
 * 補助情報のため、失敗しても予報本体を巻き込まず空のMapを返す（ログには残す）
 */
async function fetchPrecipitationProbability(
  latitude: number,
  longitude: number,
  days: number,
  fetchImpl: typeof fetch,
): Promise<Map<string, number>> {
  const url = buildProbabilityUrl(latitude, longitude, days);
  try {
    // 予報本体と同じ上流のため、瞬断の取り直しも同じ扱いにする
    // （UpstreamErrorはこの関数のcatchが受け止め、空のMapに落ちる）
    const response = await requestUpstream(url, fetchImpl, PROBABILITY_FETCH_MESSAGES);
    if (!response.ok) {
      await logUpstreamStatus('降水確率APIエラー:', url, response);
      return new Map();
    }
    const { raw, data } = await readUpstreamJson(response, url, '降水確率');
    const hourly = (
      data as { hourly?: { time?: unknown; precipitation_probability?: unknown } } | null
    )?.hourly;
    const times = hourly?.time;
    const probabilities = hourly?.precipitation_probability;
    if (!Array.isArray(times) || !Array.isArray(probabilities)) {
      console.error('降水確率APIレスポンスの形式異常:', url, raw.slice(0, 200));
      return new Map();
    }
    const byTime = new Map<string, number>();
    for (let i = 0; i < times.length; i += 1) {
      const time = times[i];
      const probability = probabilities[i];
      if (typeof time === 'string' && isFiniteNumber(probability)) {
        byTime.set(time, probability);
      }
    }
    return byTime;
  } catch (error) {
    console.error('降水確率の取得に失敗:', url, error);
    return new Map();
  }
}

/** 上流リクエストの文言セット（fetchUpstreamへ渡すログラベルと利用者向け文言） */
type UpstreamMessages = Parameters<typeof fetchUpstream>[3];

/** 予報本体（気象データ）用の文言 */
const WEATHER_FETCH_MESSAGES: UpstreamMessages = {
  logLabel: '気象データの取得に失敗:',
  failure: '気象データの取得に失敗しました。時間をおいて再度お試しください',
  // タイムアウトは「待てば直る」ことが多いため専用文言で区別する
  timeout: '気象データの取得がタイムアウトしました。時間をおいて再度お試しください',
};

/**
 * 補助取得（降水確率）用の文言。件名を分けることで、本体障害（利用者に502が出る）と
 * 補助取得の失敗（利用者影響なし）をログの1行目で切り分けられるようにする
 * （failureは呼び出し側のcatchが握り潰し利用者へ届かないが、方針どおり固定の日本語文にする）
 */
const PROBABILITY_FETCH_MESSAGES: UpstreamMessages = {
  logLabel: '降水確率の取得に失敗:',
  failure: '降水確率を取得できませんでした',
};

/** 上流リクエスト1回分（エッジキャッシュTTLと文言セットを束ねてfetchUpstreamへ委譲する） */
function requestOnce(
  url: string,
  fetchImpl: typeof fetch,
  messages: UpstreamMessages,
): Promise<Response> {
  // Cloudflareのエッジで上流レスポンスをキャッシュし、Open-Meteoの
  // 無料枠レート制限（1万コール/日）を守る。MSMの更新は3時間ごと
  return fetchUpstream(url, UPSTREAM_CACHE_TTL_SECONDS, fetchImpl, messages);
}

/**
 * 上流へのHTTPリクエスト。5xxのときだけ一度取り直す
 *
 * 上流が数百ミリ秒だけ5xxを返す瞬断は実際に起きるため、1回の取り直しで吸収する。
 * 取り直さないもの:
 * - 4xx（リクエスト自体の問題。取り直しても同じ結果になる）
 * - タイムアウト（`requestOnce`がUpstreamErrorとして投げる。待ち時間が二重になり
 *   かえって体験が悪くなるため、そのまま失敗させる）
 *
 * 注意: 525が返り続ける場合、取り直しでは直らない。525はCloudflareのエッジと
 * 相手オリジンの間のTLSハンドシェイク失敗で、ゾーン側の設定が原因のことがある
 * （docs/architecture.mdの「Worker外向きfetchの525」を参照）
 */
async function requestUpstream(
  url: string,
  fetchImpl: typeof fetch,
  messages: UpstreamMessages,
): Promise<Response> {
  const response = await requestOnce(url, fetchImpl, messages);
  if (response.status < 500) {
    return response;
  }
  await logUpstreamStatus('上流の一時エラー（取り直します）:', url, response);
  await new Promise((resolve) => setTimeout(resolve, UPSTREAM_RETRY_DELAY_MS));
  return requestOnce(url, fetchImpl, messages);
}

/**
 * 時間別の気象データを取得する
 * HTTP通信とトランスポート層のエラー処理のみを担い、検証・変換はparseWeatherResponseに委ねる
 * 降水確率は標準予報APIから並行取得して合流させる（ベストエフォート）
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
  const [response, probabilities] = await Promise.all([
    requestUpstream(url, fetchImpl, WEATHER_FETCH_MESSAGES),
    fetchPrecipitationProbability(latitude, longitude, days, fetchImpl),
  ]);

  if (!response.ok) {
    // 失敗理由（Open-Meteoのエラー本文）はログにのみ残す
    throw await throwUpstreamStatus('気象データ', url, response);
  }

  const { raw, data } = await readUpstreamJson(response, url, '気象データ');

  let result: WeatherResult;
  try {
    result = parseWeatherResponse(data);
  } catch (error) {
    if (error instanceof UpstreamError) {
      console.error('気象データAPIレスポンスの形式異常:', url, raw.slice(0, 200));
    }
    throw error;
  }

  // 降水確率（標準予報API由来）を時刻で突き合わせて合流させる
  for (const hour of result.hours) {
    hour.precipitationProbability = probabilities.get(hour.time) ?? null;
  }
  return result;
}
