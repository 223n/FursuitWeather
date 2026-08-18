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

/** 上流リクエスト共通の初期化子（UA・エッジキャッシュ・タイムアウト） */
function upstreamInit(): RequestInit {
  return {
    headers: { 'User-Agent': 'FursuitWeather (https://github.com/223n/FursuitWeather)' },
    // Cloudflareのエッジで上流レスポンスをキャッシュし、Open-Meteoの
    // 無料枠レート制限（1万コール/日）を守る。MSMの更新は3時間ごと。
    // ステータスごとにTTLを分けるのが要点で、cacheTtl（一律）にすると上流の
    // エラー応答まで同じ時間キャッシュしてしまう。実際に上流が525を返した際、
    // 上流の復旧後もキャッシュされた525が返り続けて障害が長引いた
    cf: {
      cacheTtlByStatus: {
        '200-299': UPSTREAM_CACHE_TTL_SECONDS,
        // エラーは残さない。上流が直り次第すぐ取り直せるようにする
        '400-499': 0,
        '500-599': 0,
      },
      cacheEverything: true,
    },
    // 上流の応答停滞時にユーザーリクエストを長時間待たせないための打ち切り。
    // 中断はfetchのrejectとしてcatchに入り、既存のUpstreamError（502）分類に乗る
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
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
    const response = await requestUpstream(url, fetchImpl);
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      console.error('降水確率APIエラー:', url, response.status, detail);
      return new Map();
    }
    const data = (await response.json()) as {
      hourly?: { time?: unknown; precipitation_probability?: unknown };
    };
    const times = data?.hourly?.time;
    const probabilities = data?.hourly?.precipitation_probability;
    if (!Array.isArray(times) || !Array.isArray(probabilities)) {
      console.error('降水確率APIレスポンスの形式異常:', url);
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

/**
 * 上流が非2xxを返したときに、利用者へ見せるメッセージを組み立てる
 *
 * HTTPステータスは利用者にとって意味がなく、対処の判断にも使えないため文面に
 * 含めない（ステータスと本文はconsole.errorへ残し、運用側の切り分けに使う）。
 * 5xxは提供元の障害で「待てば直る」ため、その旨が伝わる文面にする
 */
export function upstreamErrorMessage(subject: string, status: number): string {
  return status >= 500
    ? `${subject}の提供元で障害が発生しています。しばらく時間をおいてから再度お試しください`
    : `${subject}を取得できませんでした。時間をおいて再度お試しください`;
}

/** 上流へのHTTPリクエスト1回分。トランスポート失敗はUpstreamErrorへ変換する */
async function requestOnce(url: string, fetchImpl: typeof fetch): Promise<Response> {
  try {
    return await fetchImpl(url, upstreamInit());
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
 * 上流へのHTTPリクエスト。5xxのときだけ一度取り直す
 *
 * Open-Meteo自身もCDNの背後にあり、CDNからオリジンへ到達できない数百ミリ秒の
 * 瞬断（HTTP 525など）が実際に観測されている。1回の取り直しでこの手の瞬断は
 * 吸収でき、利用者にエラーを見せずに済む。
 * 取り直さないもの:
 * - 4xx（リクエスト自体の問題。取り直しても同じ結果になる）
 * - タイムアウト（`requestOnce`がUpstreamErrorとして投げる。待ち時間が二重になり
 *   かえって体験が悪くなるため、そのまま失敗させる）
 */
async function requestUpstream(url: string, fetchImpl: typeof fetch): Promise<Response> {
  const response = await requestOnce(url, fetchImpl);
  if (response.status < 500) {
    return response;
  }
  // 破棄する応答も本文を読み切る（未読ストリームが上流接続を保持するのを防ぐ）。
  // 取り直して成功した場合はログだけが残り、利用者にはエラーが見えない
  const detail = (await response.text().catch(() => '')).slice(0, 200);
  console.error('上流の一時エラー（取り直します）:', url, response.status, detail);
  await new Promise((resolve) => setTimeout(resolve, UPSTREAM_RETRY_DELAY_MS));
  return requestOnce(url, fetchImpl);
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
    requestUpstream(url, fetchImpl),
    fetchPrecipitationProbability(latitude, longitude, days, fetchImpl),
  ]);

  if (!response.ok) {
    // 失敗理由（Open-Meteoのエラー本文）はログにのみ残す。
    // ボディを消費することで、未読ストリームによる上流接続の保持も防ぐ
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    console.error('気象データAPIエラー:', url, response.status, detail);
    throw new UpstreamError(upstreamErrorMessage('気象データ', response.status));
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
