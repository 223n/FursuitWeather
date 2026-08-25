// 静電気指数の判定
// 乾燥期の化繊ファーの帯電（グリーティングでの放電・ほこり吸着）への備えの目安。
// しきい値・出典はsrc/constants.tsのSTATIC_ELECTRICITYを参照

import {
  DAYTIME_END_HOUR,
  DAYTIME_START_HOUR,
  STATIC_ELECTRICITY,
  STATIC_ELECTRICITY_ADVICE,
  STATIC_ELECTRICITY_LABELS,
} from '../constants';
import type {
  HourlyWeather,
  StaticElectricityAssessment,
  StaticElectricityLevelId,
} from '../types';
import { filterByHourRange } from './time';

/** 湿度・気温からレベルを判定する（1時間分の値に対する純粋な判定） */
function levelOf(humidity: number, temperature: number): StaticElectricityLevelId {
  if (humidity < STATIC_ELECTRICITY.highHumidity) {
    return 'high';
  }
  if (
    humidity < STATIC_ELECTRICITY.mediumHumidity &&
    temperature < STATIC_ELECTRICITY.mediumTemperature
  ) {
    return 'medium';
  }
  return 'low';
}

/**
 * 1日分の時間別データから静電気指数を判定する
 * 活動中の最悪ケースを示すため、日中（DAYTIME_*）の最も乾いた時間帯の
 * 湿度とその時間の気温で判定する（日中データがない日は全時間帯で代替）
 */
export function assessStaticElectricity(
  hours: readonly HourlyWeather[],
): StaticElectricityAssessment {
  const daytime = filterByHourRange(hours, DAYTIME_START_HOUR, DAYTIME_END_HOUR);
  const target = daytime.length > 0 ? daytime : hours;
  const driest = target.reduce((a, b) => (b.humidity < a.humidity ? b : a));
  const level = levelOf(driest.humidity, driest.temperature);
  return {
    level,
    label: STATIC_ELECTRICITY_LABELS[level],
    advice: level === 'high' ? STATIC_ELECTRICITY_ADVICE : null,
  };
}
