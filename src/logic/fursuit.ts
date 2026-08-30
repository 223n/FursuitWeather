// 着ぐるみ活動判定
// WBGTに着衣補正値（+11℃）を加えたうえで環境省5段階のしきい値で判定する
// 低温域（気温15℃未満）ではWBGT式（小野式）の精度が落ちるため、暑熱判定に加えて
// 体感温度による低温判定を併用し、深刻な方を採用する
// （根拠はconstants/のCOLD_SWITCH_TEMPERATUREのコメントを参照）

import {
  type ActivityBand,
  COLD_BANDS,
  COLD_SWITCH_TEMPERATURE,
  COOLING_LABELS,
  COOLING_RECOMMENDED_WBGT,
  COOLING_REQUIRED_WBGT,
  HEAT_BANDS,
  SUIT_WBGT_ADJUSTMENT,
} from '../constants';
import type {
  ActivityAssessment,
  CoolingNeed,
  HourlyWeather,
  IndoorAssessment,
} from '../types';
import { estimateIndoorWbgt, estimateOutdoorWbgt, roundWbgt } from './wbgt';

/** 着ぐるみ補正後のWBGTを暑熱5段階で判定する */
function classifyHeat(suitWbgt: number): (typeof HEAT_BANDS)[number] {
  // upperBoundにInfinityの帯があるため必ず見つかる
  return HEAT_BANDS.find((b) => suitWbgt < b.upperBound)!;
}

/** 体感温度を低温側の段階で判定する */
function classifyCold(apparentTemperature: number): (typeof COLD_BANDS)[number] {
  // lowerBoundに-Infinityの帯があるため必ず見つかる
  return COLD_BANDS.find((b) => apparentTemperature > b.lowerBound)!;
}

/**
 * 屋外の着ぐるみ活動を判定する
 *
 * 気温15℃以上は暑熱判定のみ。15℃未満では低温判定を併用し、深刻な方を採用する。
 * 着衣補正+11℃があるため、日射の強い10℃台でも暑熱側が警戒帯に入ることがあり、
 * 低温判定だけに切り替えると危険側の誤判定（快適・長時間OK）になるため
 */
export function assessOutdoor(weather: HourlyWeather): ActivityAssessment {
  const wbgt = roundWbgt(
    estimateOutdoorWbgt(
      weather.temperature,
      weather.humidity,
      weather.solarRadiation,
      weather.windSpeed,
    ),
  );
  const suitWbgt = roundWbgt(wbgt + SUIT_WBGT_ADJUSTMENT);
  const heatBand = classifyHeat(suitWbgt);

  let band: ActivityBand = heatBand;

  if (weather.temperature < COLD_SWITCH_TEMPERATURE) {
    const coldBand = classifyCold(weather.apparentTemperature);
    // gradeが大きい方（同gradeなら活動時間が短い方、それも同じなら低温側）を採用する
    const coldIsWorse =
      coldBand.grade > heatBand.grade ||
      (coldBand.grade === heatBand.grade &&
        coldBand.activityMinutes <= heatBand.activityMinutes);
    if (coldIsWorse) {
      band = coldBand;
    }
  }

  return {
    wbgt,
    suitWbgt,
    level: band.id,
    label: band.label,
    grade: band.grade,
    activityMinutes: band.activityMinutes,
    advice: band.advice,
  };
}

/** 冷房の要否を判定する（屋内の着ぐるみ補正後WBGTと比較） */
export function assessCooling(indoorSuitWbgt: number): CoolingNeed {
  if (indoorSuitWbgt >= COOLING_REQUIRED_WBGT) {
    return 'required';
  }
  if (indoorSuitWbgt >= COOLING_RECOMMENDED_WBGT) {
    return 'recommended';
  }
  return 'none';
}

/**
 * 屋内の着ぐるみ活動を判定する
 * 空調のない屋内で室温が外気温と同程度になる場合を想定した参考値。
 * 低温域では屋内は暖房・無風で穏やかになるため、暑熱判定のみ行い低温判定はしない
 */
export function assessIndoor(weather: HourlyWeather): IndoorAssessment {
  const wbgt = roundWbgt(estimateIndoorWbgt(weather.temperature, weather.humidity));
  const suitWbgt = roundWbgt(wbgt + SUIT_WBGT_ADJUSTMENT);
  const band = classifyHeat(suitWbgt);
  const cooling = assessCooling(suitWbgt);

  return {
    wbgt,
    suitWbgt,
    level: band.id,
    label: band.label,
    grade: band.grade,
    activityMinutes: band.activityMinutes,
    advice: band.advice,
    cooling,
    coolingLabel: COOLING_LABELS[cooling],
  };
}
