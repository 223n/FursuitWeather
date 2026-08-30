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

/** レベルの厳しさ（比較用） */
const LEVEL_SEVERITY: Record<StaticElectricityLevelId, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/**
 * 1日分の時間別データから静電気指数を判定する
 * 活動中の最悪ケースを示すため、日中（DAYTIME_*）の各時間を個別に判定し、
 * 最も厳しいレベルを採用する（日中データがない日は全時間帯で代替）。
 * 「中」は湿度と気温の複合条件のため、最低湿度の1時間だけを見ると
 * 別の時間帯の「中」を見落とす（最低湿度の時間が「低」でも、より湿度が
 * 高く低温の時間が「中」になり得る）
 *
 * @param hours その日の時間別気象データ。1件以上であること
 *   （空配列は呼び出し側の契約違反。最も厳しいレベルを選ぶreduceが例外を投げる）
 */
export function assessStaticElectricity(
  hours: readonly HourlyWeather[],
): StaticElectricityAssessment {
  const daytime = filterByHourRange(hours, DAYTIME_START_HOUR, DAYTIME_END_HOUR);
  const target = daytime.length > 0 ? daytime : hours;
  const level = target
    .map((hour) => levelOf(hour.humidity, hour.temperature))
    .reduce((a, b) => (LEVEL_SEVERITY[b] > LEVEL_SEVERITY[a] ? b : a));
  return {
    level,
    label: STATIC_ELECTRICITY_LABELS[level],
    advice: level === 'high' ? STATIC_ELECTRICITY_ADVICE : null,
  };
}
