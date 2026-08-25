// Open-Meteo JMAモデルAPIクライアント
// 気象庁MSM（約5kmメッシュ・1時間粒度・4日先）を優先し、以降はGSMに自動接続する
// jma_seamlessモデルのデータを取得する。APIキーは不要（非商用・要出典表記）
// 降水確率のみ気象庁モデルにないため、標準予報APIから補完取得する（失敗しても
// 予報本体は成功させるベストエフォート）

import {
  OPEN_METEO_AIR_QUALITY_BASE_URL,
  OPEN_METEO_BASE_URL,
  OPEN_METEO_FORECAST_BASE_URL,
  SUDDEN_HEAT,
  UPSTREAM_CACHE_TTL_SECONDS,
  UPSTREAM_RETRY_DELAY_MS,
} from '../constants';
import type { AirQualityValues } from '../logic/airQuality';
import type { HourlyWeather, SunTimes } from '../types';
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
  /** 日の出・日の入り（daily=sunrise,sunset指定時のみ。補助情報のため無くてもよい） */
  daily?: {
    time?: unknown;
    sunrise?: unknown;
    sunset?: unknown;
  };
}

/**
 * 取得URLを組み立てる
 *
 * @param date 指定時はforecast_daysの代わりにその1日（start_date/end_date）へ固定する。
 *   上流URLはエッジキャッシュのキーになるため、日付入りURLはJST 0時に自然と
 *   キャッシュが切り替わる（/api/nationalの「日本時間の当日」契約用。daysは無視される）
 */
export function buildForecastUrl(
  latitude: number,
  longitude: number,
  days: number,
  date?: string,
): string {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    hourly: HOURLY_FIELDS.join(','),
    timezone: 'Asia/Tokyo',
    // 風速はWBGT式に合わせてm/sで取得する（デフォルトはkm/h）
    wind_speed_unit: 'ms',
  });
  if (date === undefined) {
    params.set('forecast_days', String(days));
    // 急な暑さ（暑熱順化前）の判定用に、直近の実績も同じ応答で受け取る
    // （上流コール数は増えない。日付固定の取得（/api/national）には付けない）
    params.set('past_days', String(SUDDEN_HEAT.baselineDays));
    // 日の出・日の入りも同じ応答で受け取る（補助情報。欠けても本体は成功させる）
    params.set('daily', 'sunrise,sunset');
  } else {
    params.set('start_date', date);
    params.set('end_date', date);
  }
  return `${OPEN_METEO_BASE_URL}?${params.toString()}`;
}

/**
 * 補助上流（Open-Meteo系API）の取得URL共通部を組み立てる
 * （座標・hourly項目・タイムゾーン・日数の構成は降水確率・大気質で同一）
 */
function buildAuxiliaryUrl(
  baseUrl: string,
  latitude: number,
  longitude: number,
  hourlyFields: string,
  days: number,
): string {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    hourly: hourlyFields,
    timezone: 'Asia/Tokyo',
    forecast_days: String(days),
  });
  return `${baseUrl}?${params.toString()}`;
}

/** 降水確率の取得URL（標準予報API）を組み立てる */
export function buildProbabilityUrl(latitude: number, longitude: number, days: number): string {
  return buildAuxiliaryUrl(
    OPEN_METEO_FORECAST_BASE_URL,
    latitude,
    longitude,
    'precipitation_probability',
    days,
  );
}

/** 大気質（PM2.5・黄砂）の取得URL（Air Quality API）を組み立てる */
export function buildAirQualityUrl(latitude: number, longitude: number, days: number): string {
  return buildAuxiliaryUrl(OPEN_METEO_AIR_QUALITY_BASE_URL, latitude, longitude, 'pm2_5,dust', days);
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
  /** 日付（YYYY-MM-DD）→日の出・日の入り。daily未取得・形式異常時は空のMap */
  sunTimes: Map<string, SunTimes>;
  /** 日付（YYYY-MM-DD）→大気質の生値（PM2.5・黄砂）。取得失敗・未取得時は空のMap */
  airQuality: Map<string, AirQualityValues>;
}

/** 日の出・日の入りのローカル時刻文字列（YYYY-MM-DDTHH:mm）からHH:mmを取り出す */
function timeOfDayOf(value: unknown): string | null {
  return typeof value === 'string' && TIME_PATTERN.test(value) ? value.slice(11, 16) : null;
}

/**
 * dailyブロックから日付→日の出・日の入りのMapを作る（ベストエフォート）
 * 補助情報のため、形式異常は黙って空のMapに落とす（本体の応答を巻き込まない）
 */
function parseSunTimes(daily: OpenMeteoResponse['daily']): Map<string, SunTimes> {
  const sunTimes = new Map<string, SunTimes>();
  const dates = daily?.time;
  const sunrises = daily?.sunrise;
  const sunsets = daily?.sunset;
  if (!Array.isArray(dates) || !Array.isArray(sunrises) || !Array.isArray(sunsets)) {
    return sunTimes;
  }
  for (let i = 0; i < dates.length; i += 1) {
    const date = dates[i];
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      sunTimes.set(date, {
        sunrise: timeOfDayOf(sunrises[i]),
        sunset: timeOfDayOf(sunsets[i]),
      });
    }
  }
  return sunTimes;
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
    sunTimes: parseSunTimes(candidate.daily),
    // 大気質は別上流のためここでは空。fetchWeatherが合流させる
    airQuality: new Map(),
  };
}

/**
 * 補助上流（降水確率・大気質）共通の取得骨格
 * 「取得→非2xxはログして空Map→JSON読取→hourlyをcollectで検証・変換→
 *   形式異常（collectがnull）はログして空Map→例外もログして空Map」を1箇所に集約する。
 * 補助情報のため、どの失敗でも予報本体を巻き込まない（ベストエフォート）。
 * 予報本体と同じ上流のため、瞬断の取り直し（requestUpstream）も同じ扱いにする
 *
 * @param subject ログ・利用者向け文言の件名（「降水確率」「大気質」）
 * @param collect 検証済みhourlyオブジェクトからMapを作る純粋関数（形式異常はnull）
 */
async function fetchAuxiliaryHourly<T>(
  url: string,
  messages: UpstreamMessages,
  subject: string,
  fetchImpl: typeof fetch,
  collect: (hourly: Record<string, unknown>) => Map<string, T> | null,
): Promise<Map<string, T>> {
  try {
    const response = await requestUpstream(url, fetchImpl, messages);
    if (!response.ok) {
      await logUpstreamStatus(`${subject}APIエラー:`, url, response);
      return new Map();
    }
    const { raw, data } = await readUpstreamJson(response, url, subject);
    const hourly = (data as { hourly?: Record<string, unknown> } | null)?.hourly;
    const collected = hourly && typeof hourly === 'object' ? collect(hourly) : null;
    if (collected === null) {
      console.error(`${subject}APIレスポンスの形式異常:`, url, raw.slice(0, 200));
      return new Map();
    }
    return collected;
  } catch (error) {
    console.error(`${subject}の取得に失敗:`, url, error);
    return new Map();
  }
}

/** hourlyから時刻→降水確率のMapを作る純粋関数（形式異常はnull） */
function collectProbabilityByTime(hourly: Record<string, unknown>): Map<string, number> | null {
  const times = hourly.time;
  const probabilities = hourly.precipitation_probability;
  if (!Array.isArray(times) || !Array.isArray(probabilities)) {
    return null;
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
}

/** hourlyから日付→大気質の生値のMapを作る純粋関数（形式異常はnull）
 * 日付ごとに欠測を除いた生値を集める（評価はsrc/logic/airQuality.tsの純粋関数が担う） */
function collectAirQualityByDate(
  hourly: Record<string, unknown>,
): Map<string, AirQualityValues> | null {
  const times = hourly.time;
  const pm25Values = hourly.pm2_5;
  const dustValues = hourly.dust;
  if (!Array.isArray(times)) {
    return null;
  }
  const byDate = new Map<string, { pm25: number[]; dust: number[] }>();
  for (let i = 0; i < times.length; i += 1) {
    const time = times[i];
    if (typeof time !== 'string' || !TIME_PATTERN.test(time)) {
      continue;
    }
    const date = time.slice(0, 10);
    let values = byDate.get(date);
    if (!values) {
      values = { pm25: [], dust: [] };
      byDate.set(date, values);
    }
    const pm25 = Array.isArray(pm25Values) ? pm25Values[i] : null;
    const dust = Array.isArray(dustValues) ? dustValues[i] : null;
    if (isFiniteNumber(pm25)) {
      values.pm25.push(pm25);
    }
    if (isFiniteNumber(dust)) {
      values.dust.push(dust);
    }
  }
  return byDate;
}

/**
 * 降水確率を標準予報APIから取得し、時刻→確率のMapに変換する
 * 補助情報のため、失敗しても予報本体を巻き込まず空のMapを返す（ログには残す）
 */
function fetchPrecipitationProbability(
  latitude: number,
  longitude: number,
  days: number,
  fetchImpl: typeof fetch,
): Promise<Map<string, number>> {
  return fetchAuxiliaryHourly(
    buildProbabilityUrl(latitude, longitude, days),
    PROBABILITY_FETCH_MESSAGES,
    '降水確率',
    fetchImpl,
    collectProbabilityByTime,
  );
}

/**
 * 大気質（PM2.5・黄砂）をAir Quality APIから取得し、日付→生値のMapに変換する
 * 補助情報のため、失敗しても予報本体を巻き込まず空のMapを返す（ログには残す）
 */
function fetchAirQuality(
  latitude: number,
  longitude: number,
  days: number,
  fetchImpl: typeof fetch,
): Promise<Map<string, AirQualityValues>> {
  return fetchAuxiliaryHourly(
    buildAirQualityUrl(latitude, longitude, days),
    AIR_QUALITY_FETCH_MESSAGES,
    '大気質',
    fetchImpl,
    collectAirQualityByDate,
  );
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

/** 補助取得（大気質）用の文言（降水確率と同じ扱い） */
const AIR_QUALITY_FETCH_MESSAGES: UpstreamMessages = {
  logLabel: '大気質の取得に失敗:',
  failure: '大気質を取得できませんでした',
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

/** 組み立て済みURLから気象データを取得・検証する（fetchWeatherBase/fetchWeatherForDate共通） */
async function fetchWeatherFromUrl(url: string, fetchImpl: typeof fetch): Promise<WeatherResult> {
  const response = await requestUpstream(url, fetchImpl, WEATHER_FETCH_MESSAGES);

  if (!response.ok) {
    // 失敗理由（Open-Meteoのエラー本文）はログにのみ残す
    throw await throwUpstreamStatus('気象データ', url, response);
  }

  const { raw, data } = await readUpstreamJson(response, url, '気象データ');

  try {
    return parseWeatherResponse(data);
  } catch (error) {
    if (error instanceof UpstreamError) {
      console.error('気象データAPIレスポンスの形式異常:', url, raw.slice(0, 200));
    }
    throw error;
  }
}

/**
 * 時間別の気象データを取得する（降水確率の補完なし）
 * HTTP通信とトランスポート層のエラー処理のみを担い、検証・変換はparseWeatherResponseに委ねる
 *
 * @param fetchImpl テスト時にモックを注入するためのfetch実装
 */
export function fetchWeatherBase(
  latitude: number,
  longitude: number,
  days: number,
  fetchImpl: typeof fetch = fetch,
): Promise<WeatherResult> {
  return fetchWeatherFromUrl(buildForecastUrl(latitude, longitude, days), fetchImpl);
}

/**
 * 対象日1日分の気象データを取得する（降水確率の補完なし）
 * /api/national・/api/badge.svg・OGPの「日本時間の当日」契約用。日付入りURLは
 * JST 0時に自然とエッジキャッシュが切り替わる（buildForecastUrlのdate分岐を参照）
 *
 * @param fetchImpl テスト時にモックを注入するためのfetch実装
 */
export function fetchWeatherForDate(
  latitude: number,
  longitude: number,
  date: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WeatherResult> {
  // daysはdate指定時にbuildForecastUrlが使わないため、値に意味はない
  return fetchWeatherFromUrl(buildForecastUrl(latitude, longitude, 1, date), fetchImpl);
}

/**
 * 時間別の気象データを取得し、降水確率を合流させる
 * 降水確率は標準予報APIから並行取得する（ベストエフォート。失敗しても本体は成功させる）
 *
 * @param fetchImpl テスト時にモックを注入するためのfetch実装
 */
export async function fetchWeather(
  latitude: number,
  longitude: number,
  days: number,
  fetchImpl: typeof fetch = fetch,
): Promise<WeatherResult> {
  const [result, probabilities, airQuality] = await Promise.all([
    fetchWeatherBase(latitude, longitude, days, fetchImpl),
    fetchPrecipitationProbability(latitude, longitude, days, fetchImpl),
    // 大気質（空気のよごれ指数用）も並行取得する（同じベストエフォート）
    fetchAirQuality(latitude, longitude, days, fetchImpl),
  ]);

  // 降水確率（標準予報API由来）を時刻で突き合わせて合流させる
  for (const hour of result.hours) {
    hour.precipitationProbability = probabilities.get(hour.time) ?? null;
  }
  result.airQuality = airQuality;
  return result;
}
