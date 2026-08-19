// /api/national エンドポイント
// 全国主要都市の当日予報サマリーを返す（会場表示モード（display.html）の全国スライド用）
// 都市単位のベストエフォート: 1都市の失敗が全国全体の応答を巻き込まない

import { ATTRIBUTION, NATIONAL_CITIES, type NationalCity } from '../constants';
import { buildDayForecast, buildHourForecast } from '../logic/forecast';
import { dateOf, todayInJst } from '../logic/time';
import type { NationalCitySummary, NationalResponse } from '../types';
import { demoWeather } from '../weather/demoData';
import { fetchWeatherBase, type WeatherResult } from '../weather/openMeteo';
import { UpstreamError } from '../weather/upstream';
import { json } from './http';

/** 気象データから1都市分の当日サマリーを組み立てる */
function buildCitySummary(city: NationalCity, weather: WeatherResult): NationalCitySummary {
  const hours = weather.hours.map(buildHourForecast);
  // forecast_days=1の応答は当日分のみだが、応答が複数日にまたがっても
  // 当日サマリーが翌日のデータへ引きずられないよう先頭日だけに絞る
  const date = dateOf(hours[0]!.time);
  const day = buildDayForecast(
    date,
    hours.filter((hour) => dateOf(hour.time) === date),
  );
  return {
    name: city.name,
    latitude: city.lat,
    longitude: city.lon,
    weatherCode: day.weatherCode,
    weatherLabel: day.weatherLabel,
    temperatureMin: day.temperatureMin,
    temperatureMax: day.temperatureMax,
    outdoorWorst: day.outdoorWorst,
  };
}

/**
 * 1都市分のサマリーを取得する
 * 失敗（上流エラー・欠測）はnullへ落とし、詳細はログにのみ残す
 * （降水確率と同じベストエフォート方針。全都市失敗の判定は呼び出し側が行う）
 */
async function fetchCitySummary(city: NationalCity): Promise<NationalCitySummary | null> {
  try {
    return buildCitySummary(city, await fetchWeatherBase(city.lat, city.lon, 1));
  } catch (error) {
    console.error('全国天気の取得に失敗:', city.name, error);
    return null;
  }
}

/**
 * GET /api/national
 * GET /api/national?demo=1 （デモデータで応答）
 */
export async function handleNational(request: Request): Promise<Response> {
  const now = new Date();
  const date = todayInJst(now);

  let cities: NationalCitySummary[];
  let model: string;
  if (new URL(request.url).searchParams.get('demo') === '1') {
    // デモは上流を呼ばず、全都市同一の気象データで応答する（表示確認用）
    const weather = demoWeather(date);
    cities = NATIONAL_CITIES.map((city) => buildCitySummary(city, weather));
    model = 'demo';
  } else {
    const summaries = await Promise.all(NATIONAL_CITIES.map(fetchCitySummary));
    cities = summaries.filter((summary): summary is NationalCitySummary => summary !== null);
    if (cities.length === 0) {
      // 全都市失敗は上流障害として、ルーターの502変換に委ねる
      throw new UpstreamError('全国の天気を取得できませんでした。時間をおいて再度お試しください');
    }
    model = 'jma_seamless（気象庁MSM/GSM）';
  }

  const body: NationalResponse = {
    generatedAt: now.toISOString(),
    date,
    model,
    attribution: ATTRIBUTION,
    cities,
  };
  return json(body, { cacheable: true });
}
