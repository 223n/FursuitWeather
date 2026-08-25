// /api/forecast エンドポイント
// クエリパラメータを検証し、気象データの取得と予報の組み立てを行う

import { DEFAULT_FORECAST_DAYS, MAX_FORECAST_DAYS, WEATHER_MODEL_LABEL } from '../constants';
import { assessSuddenHeat } from '../logic/acclimatization';
import { buildForecast } from '../logic/forecast';
import { dateOf, todayInJst } from '../logic/time';
import { demoWeather } from '../weather/demoData';
import { fetchWeather, type WeatherResult } from '../weather/openMeteo';
import { UpstreamError } from '../weather/upstream';
import { isDemoRequest, json, jsonError, parseLatLonParams } from './http';

/**
 * GET /api/forecast?lat=35.68&lon=139.68&days=4
 * GET /api/forecast?demo=1 （デモデータで応答）
 */
export async function handleForecast(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const params = url.searchParams;
  const now = new Date();

  let weather: WeatherResult;
  let model: string;

  if (isDemoRequest(params)) {
    weather = demoWeather(todayInJst(now));
    model = 'demo';
  } else {
    const coords = parseLatLonParams(params);
    if (coords instanceof Response) {
      return coords;
    }

    // daysは省略時のみ既定値とし、指定されていて解析できない場合は明示的にエラーを返す
    // （Number()による解析はlat・lonのparseNumberParamと同じで、NaN・Infinityは
    //   Number.isIntegerが弾くため受け入れる値は従来と同一）
    const daysRaw = params.get('days');
    const daysSpecified = daysRaw !== null && daysRaw.trim() !== '';
    const days = daysSpecified ? Number(daysRaw) : DEFAULT_FORECAST_DAYS;
    if (!Number.isInteger(days) || days < 1 || days > MAX_FORECAST_DAYS) {
      return jsonError(400, `daysは1〜${MAX_FORECAST_DAYS}の整数で指定してください`);
    }

    // 上流障害（UpstreamError）の502変換はルーター（src/index.ts）が担う
    weather = await fetchWeather(coords.latitude, coords.longitude, days);
    model = WEATHER_MODEL_LABEL;
  }

  // past_days付きの応答から過去分を分離する（画面の予報には出さず、
  // 急な暑さ（暑熱順化前）の判定にだけ使う）
  const today = todayInJst(now);
  const pastHours = weather.hours.filter((hour) => dateOf(hour.time) < today);
  const currentHours = weather.hours.filter((hour) => dateOf(hour.time) >= today);

  // JSTの日付またぎ×上流エッジキャッシュ（30分）の窓では、キャッシュ済み応答の
  // 全時間が「過去」に分類され得る。空の予報を200+キャッシュ可で返すと
  // 空画面が最大10分残るため、上流異常と同じ扱い（502・no-store）で失敗させる
  if (currentHours.length === 0) {
    console.error('予報データが日付またぎで全て過去に分類されました:', today, weather.hours.length);
    throw new UpstreamError('気象データの取得に失敗しました。時間をおいて再度お試しください');
  }

  const forecast = buildForecast(
    currentHours,
    {
      latitude: weather.latitude,
      longitude: weather.longitude,
      timezone: weather.timezone,
    },
    model,
    now.toISOString(),
    weather.sunTimes,
    weather.airQuality,
  );

  const firstDay = forecast.days[0];
  const suddenHeat = firstDay
    ? assessSuddenHeat(pastHours, firstDay.date, firstDay.temperatureMax)
    : null;

  return json({ ...forecast, suddenHeat }, { cacheable: true });
}
