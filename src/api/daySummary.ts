// 「対象日の日別サマリーが必須」なAPI（/api/national・/api/badge.svg）共通の後段
// buildDayForecastForのnull（対象日の時間が空）を上流エラーへ変換する。
// UpstreamErrorを使うためlogic/には置かない（logic/は純粋ロジックのみの層）

import { buildDayForecastFor } from '../logic/forecast';
import type { DayForecast, HourlyWeather } from '../types';
import { UpstreamError } from '../weather/upstream';

/**
 * 対象日1日分のサマリーを組み立てる。対象日の時間が空なら上流エラーとして投げる
 * （JSTの日付またぎ×上流エッジキャッシュの窓で起きる。日付またぎ防御は
 *   buildDayForecastForを参照。エラー文言の単一情報源をここに置く）
 */
export function requireDayForecast(hours: readonly HourlyWeather[], date: string): DayForecast {
  const day = buildDayForecastFor(hours, date);
  if (day === null) {
    throw new UpstreamError(`対象日（${date}）の気象データがありません`);
  }
  return day;
}
