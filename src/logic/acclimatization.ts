// 急な暑さ（暑熱順化前）の判定
// 対象日の最高気温を直近数日の平均最高気温と比べる純粋ロジック。
// WBGTの絶対値がそれほど高くなくても、体が暑さに慣れていない時期の
// 急な気温上昇は熱中症リスクが高い（しきい値の出典はconstants.tsのSUDDEN_HEAT）

import { SUDDEN_HEAT } from '../constants';
import type { HourlyWeather, SuddenHeatWarning } from '../types';
import { dateOf } from './time';

/**
 * 急な暑さの注意を判定する。該当しない・判定できないときはnull
 *
 * @param pastHours 対象日より前の時間別気象データ（直近数日分）
 * @param targetDate 対象日（YYYY-MM-DD）
 * @param targetMax 対象日の最高気温（℃）
 */
export function assessSuddenHeat(
  pastHours: readonly HourlyWeather[],
  targetDate: string,
  targetMax: number,
): SuddenHeatWarning | null {
  // 季節ゲート: 涼しい日への「急に暑い」は誤警報のため出さない
  if (targetMax < SUDDEN_HEAT.minTargetMax) {
    return null;
  }

  // 過去分を日付ごとの最高気温へ集約する（対象日以降が紛れても除外する）
  const maxByDate = new Map<string, number>();
  for (const hour of pastHours) {
    const date = dateOf(hour.time);
    if (date >= targetDate) {
      continue;
    }
    const current = maxByDate.get(date);
    maxByDate.set(
      date,
      current === undefined ? hour.temperature : Math.max(current, hour.temperature),
    );
  }

  // 欠測が多いときは判定しない（不確かな比較で注意を出すより黙る方が安全）
  if (maxByDate.size < SUDDEN_HEAT.minBaselineDays) {
    return null;
  }

  const values = [...maxByDate.values()];
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (targetMax - average < SUDDEN_HEAT.temperatureRise) {
    return null;
  }

  return {
    date: targetDate,
    recentAverageMax: Math.round(average * 10) / 10,
    targetMax,
  };
}
