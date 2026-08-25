// 急な暑さ（暑熱順化前）判定のテスト
// 判定条件・季節ゲート・欠測時の抑制を境界値で検証する

import { describe, expect, it } from 'vitest';
import { SUDDEN_HEAT } from '../src/constants';
import { assessSuddenHeat } from '../src/logic/acclimatization';
import type { HourlyWeather } from '../src/types';

/** 指定日の最高気温がmaxになる1日分のデータを作る
 * （既定はminSamplesPerDayちょうどの12時間分。比較対象の日として数えられる下限） */
function dayHours(date: string, max: number, hourCount = 12): HourlyWeather[] {
  return Array.from({ length: hourCount }, (_, index) => {
    const hour = 7 + index;
    return {
      time: `${date}T${String(hour).padStart(2, '0')}:00`,
      temperature: hour === 14 ? max : max - 5,
      humidity: 60,
      apparentTemperature: max,
      precipitation: 0,
      precipitationProbability: null,
      weatherCode: 1,
      solarRadiation: 400,
      windSpeed: 2,
    };
  });
}

/** 対象日前のbaseline日数分、平均最高気温がbaseMaxになる過去データを作る */
function pastWeek(baseMax: number, days: number = SUDDEN_HEAT.baselineDays): HourlyWeather[] {
  const hours: HourlyWeather[] = [];
  for (let i = 1; i <= days; i += 1) {
    hours.push(...dayHours(`2026-07-${String(20 + i).padStart(2, '0')}`, baseMax));
  }
  return hours;
}

describe('assessSuddenHeat', () => {
  const targetDate = '2026-07-28';

  it('直近平均を+5℃以上上回ると注意を返す（平均は小数1桁へ丸め）', () => {
    const result = assessSuddenHeat(pastWeek(25), targetDate, 30);
    expect(result).toEqual({ date: targetDate, recentAverageMax: 25, targetMax: 30 });
  });

  it('上回り幅が+5℃未満なら返さない（境界: ちょうど+5℃は返す）', () => {
    expect(assessSuddenHeat(pastWeek(25.1), targetDate, 30)).toBeNull();
    expect(assessSuddenHeat(pastWeek(25), targetDate, 30)).not.toBeNull();
  });

  it('対象日の最高気温が25℃未満なら季節ゲートで返さない（涼しい日の誤警報防止）', () => {
    expect(assessSuddenHeat(pastWeek(15), targetDate, 24.9)).toBeNull();
  });

  it('過去データが5日分未満なら判定しない（欠測時は黙って抑制）', () => {
    expect(assessSuddenHeat(pastWeek(25, 4), targetDate, 35)).toBeNull();
    expect(assessSuddenHeat([], targetDate, 35)).toBeNull();
  });

  it('対象日以降のデータが紛れても比較対象から除外する', () => {
    // 対象日当日の高温データを混ぜても平均を押し上げない
    const past = pastWeek(25).concat(dayHours(targetDate, 40));
    const result = assessSuddenHeat(past, targetDate, 30);
    expect(result).toEqual({ date: targetDate, recentAverageMax: 25, targetMax: 30 });
  });

  it('部分欠測の日（半日分未満）は比較対象の日として数えない', () => {
    // 夜間の数時間だけ残った低温の日が平均を押し下げて誤警報にならないよう、
    // その日ごと除外する。除外の結果5日分を割れば判定しない
    const sparse = pastWeek(25, 4).concat(dayHours('2026-07-27', 10, 3));
    expect(assessSuddenHeat(sparse, targetDate, 30)).toBeNull();

    // 5日分が揃っていれば、紛れた部分欠測の低温日は平均に影響しない
    const enough = pastWeek(25, 5).concat(dayHours('2026-07-27', 10, 3));
    expect(assessSuddenHeat(enough, targetDate, 30)).toEqual({
      date: targetDate,
      recentAverageMax: 25,
      targetMax: 30,
    });
  });
});
