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
  SunTimes,
} from '../types';
import { assessAirQuality, type AirQualityValues } from './airQuality';
import { assessIndoor, assessOutdoor } from './fursuit';
import { assessLaundry } from './laundry';
import { assessStaticElectricity } from './staticElectricity';
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

/**
 * 時間別の気象データから、対象日1日分のサマリーを組み立てる
 * （/api/national・/api/badge.svg・OGPの「当日サマリー」共通の入口）
 *
 * 上流はstart_date/end_dateで対象日を指定していても、キャッシュ済みの古い応答が
 * 紛れると別の日のデータが混ざり得るため、ここで必ず日付で絞り直す。
 * JSTの日付またぎ×上流エッジキャッシュの窓では対象日の時間が空になり得るので、
 * そのときはnullを返す（エラー化・非表示化は呼び出し側の契約に委ねる）
 */
export function buildDayForecastFor(
  hours: readonly HourlyWeather[],
  date: string,
): DayForecast | null {
  const dayHours = hours.map(buildHourForecast).filter((hour) => dateOf(hour.time) === date);
  return dayHours.length === 0 ? null : buildDayForecast(date, dayHours);
}

/** 日別サマリーを組み立てる
 * @param sun 日の出・日の入り（補助情報。取得できなかった日はnullのまま）
 * @param air 大気質の生値（補助情報。取得できなかった日はairQualityがnullになる） */
export function buildDayForecast(
  date: string,
  hours: readonly HourForecast[],
  sun?: SunTimes,
  air?: AirQualityValues,
): DayForecast {
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
    sunrise: sun?.sunrise ?? null,
    sunset: sun?.sunset ?? null,
    outdoorWorst: toSummary(worst),
    outdoorBest: toSummary(best),
    recommendedHours,
    coolingRequired: summaryTarget.some((h) => h.indoor.cooling === 'required'),
    // 素のWBGT（着衣補正前）の日最大。熱中症警戒アラートの発表基準（33以上）
    // への該当判断に使えるよう、日中に限らず全時間帯から取る
    maxWbgt: Math.max(...hours.map((h) => h.outdoor.wbgt)),
    // 風は設営・撤収も含め終日のリスクのため、maxWbgtと同様に全時間帯から取る
    maxWindSpeed: Math.max(...hours.map((h) => h.weather.windSpeed)),
    laundry: assessLaundry(hours.map((h) => h.weather)),
    staticElectricity: assessStaticElectricity(hours.map((h) => h.weather)),
    airQuality: air ? assessAirQuality(air) : null,
  };
}

/** 気象データ一式から予報レスポンスを組み立てる */
export function buildForecast(
  weatherHours: readonly HourlyWeather[],
  location: ForecastLocation,
  model: string,
  generatedAt: string,
  sunTimes: ReadonlyMap<string, SunTimes> = new Map(),
  airQuality: ReadonlyMap<string, AirQualityValues> = new Map(),
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
    buildDayForecast(date, dayHours, sunTimes.get(date), airQuality.get(date)),
  );

  return {
    location,
    generatedAt,
    model,
    attribution: ATTRIBUTION,
    notices: YEAR_ROUND_NOTICES,
    // 急な暑さの判定は過去データを持つAPI層（handleForecast）が上書きする
    suddenHeat: null,
    hours,
    days,
  };
}
