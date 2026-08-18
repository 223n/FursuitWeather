// 予報の組み立て
// 時間別の気象データから、時間別予報と日別サマリーを構築する純粋ロジック

import {
  ATTRIBUTION,
  DAYTIME_END_HOUR,
  DAYTIME_START_HOUR,
  RECOMMENDED_MAX_GRADE,
  YEAR_ROUND_NOTICES,
  weatherCodeLabel,
} from '../constants';
import type {
  DayForecast,
  ForecastLocation,
  ForecastResponse,
  HourForecast,
  HourlyWeather,
  LevelSummary,
} from '../types';
import { assessIndoor, assessOutdoor } from './fursuit';
import { assessLaundry } from './laundry';
import { dateOf, filterByHourRange, hourOf } from './time';

/** 1時間分の予報を組み立てる */
export function buildHourForecast(weather: HourlyWeather): HourForecast {
  return {
    time: weather.time,
    weather,
    weatherLabel: weatherCodeLabel(weather.weatherCode),
    outdoor: assessOutdoor(weather),
    indoor: assessIndoor(weather),
  };
}

/** 日別サマリーを組み立てる */
export function buildDayForecast(date: string, hours: readonly HourForecast[]): DayForecast {
  const temperatures = hours.map((h) => h.weather.temperature);
  const daytime = filterByHourRange(hours, DAYTIME_START_HOUR, DAYTIME_END_HOUR);
  // 日中データがない日（取得初日の夜間のみなど）は全時間帯で代替する
  const summaryTarget = daytime.length > 0 ? daytime : hours;

  const worst = summaryTarget.reduce((a, b) => (b.outdoor.grade > a.outdoor.grade ? b : a));
  const best = summaryTarget.reduce((a, b) => (b.outdoor.grade < a.outdoor.grade ? b : a));

  const toSummary = (h: HourForecast): LevelSummary => ({
    level: h.outdoor.level,
    label: h.outdoor.label,
    grade: h.outdoor.grade,
  });

  const recommendedHours = daytime
    .filter((h) => h.outdoor.grade <= RECOMMENDED_MAX_GRADE && h.weather.precipitation === 0)
    .map((h) => `${String(hourOf(h.time)).padStart(2, '0')}:00`);

  // 正午に近い時間帯の天気コードを代表値とする
  const representative =
    summaryTarget.reduce((a, b) =>
      Math.abs(hourOf(b.time) - 12) < Math.abs(hourOf(a.time) - 12) ? b : a,
    );

  return {
    date,
    temperatureMin: Math.min(...temperatures),
    temperatureMax: Math.max(...temperatures),
    weatherCode: representative.weather.weatherCode,
    weatherLabel: representative.weatherLabel,
    outdoorWorst: toSummary(worst),
    outdoorBest: toSummary(best),
    recommendedHours,
    coolingRequired: summaryTarget.some((h) => h.indoor.cooling === 'required'),
    // 素のWBGT（着衣補正前）の日最大。熱中症警戒アラートの発表基準（33以上）
    // への該当判断に使えるよう、日中に限らず全時間帯から取る
    maxWbgt: Math.max(...hours.map((h) => h.outdoor.wbgt)),
    laundry: assessLaundry(hours.map((h) => h.weather)),
  };
}

/** 気象データ一式から予報レスポンスを組み立てる */
export function buildForecast(
  weatherHours: readonly HourlyWeather[],
  location: ForecastLocation,
  model: string,
  generatedAt: string,
): ForecastResponse {
  const hours = weatherHours.map(buildHourForecast);

  const byDate = new Map<string, HourForecast[]>();
  for (const hour of hours) {
    const date = dateOf(hour.time);
    const list = byDate.get(date);
    if (list) {
      list.push(hour);
    } else {
      byDate.set(date, [hour]);
    }
  }

  const days = [...byDate.entries()].map(([date, dayHours]) =>
    buildDayForecast(date, dayHours),
  );

  return {
    location,
    generatedAt,
    model,
    attribution: { ...ATTRIBUTION },
    notices: YEAR_ROUND_NOTICES,
    hours,
    days,
  };
}
