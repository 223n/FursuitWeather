// WBGT（暑さ指数）の推定
// 小野ら（2014）の推定式を使用する。環境省の実況推定値・予測値と同一の手法

import { INDOOR_WIND_SPEED, ONO_2014 } from '../constants';

/**
 * 屋外WBGTを推定する
 *
 * @param temperature 気温（℃）
 * @param humidity 相対湿度（%）
 * @param solarRadiationWm2 全天日射量（W/m²）
 * @param windSpeedMps 風速（m/s）
 * @returns WBGT推定値（℃）
 */
export function estimateOutdoorWbgt(
  temperature: number,
  humidity: number,
  solarRadiationWm2: number,
  windSpeedMps: number,
): number {
  // 式の入力単位はkW/m²のため変換する。夜間の負値はゼロに丸める
  const srKw = Math.max(0, solarRadiationWm2) / 1000;
  const ws = Math.max(0, windSpeedMps);
  return (
    ONO_2014.ta * temperature +
    ONO_2014.rh * humidity +
    ONO_2014.taRh * temperature * humidity +
    ONO_2014.sr * srKw +
    ONO_2014.srSquared * srKw * srKw +
    ONO_2014.ws * ws +
    ONO_2014.intercept
  );
}

/**
 * 屋内WBGTを推定する
 * 日射なし・室内想定風速で屋外用の式を流用する（環境省も夜間は日射量0で計算）
 * 空調のない屋内（体育館・イベント会場など）で室温が外気温と同程度の場合の参考値
 *
 * @param temperature 気温（℃）
 * @param humidity 相対湿度（%）
 * @returns WBGT推定値（℃）
 */
export function estimateIndoorWbgt(temperature: number, humidity: number): number {
  return estimateOutdoorWbgt(temperature, humidity, 0, INDOOR_WIND_SPEED);
}

/** 小数1桁に丸める（表示・比較用） */
export function roundWbgt(value: number): number {
  return Math.round(value * 10) / 10;
}
