// 洗濯乾燥指数
// Tetensの式で飽和水蒸気圧から飽差（VPD）を求め、Meyer式由来の風速関数を掛けた
// 毎時の乾燥スピードを干し時間帯（LAUNDRY.windowStartHour〜windowEndHour）で
// 積算して0〜100に指数化する
// 段階分けはtenki.jp洗濯指数の5段階に準拠し、降雨・低温の例外処理を重ねる

import { LAUNDRY, LAUNDRY_BANDS, LAUNDRY_LEVEL_LABELS } from '../constants';
import type { HourlyWeather, LaundryAssessment, LaundryLevelId } from '../types';
import { filterByHourRange } from './time';

/**
 * 飽和水蒸気圧（hPa）をTetensの式で求める
 * es(T) = 6.1078 × 10^(7.5T / (T + 237.3))
 */
export function saturationVaporPressure(temperature: number): number {
  return 6.1078 * Math.pow(10, (7.5 * temperature) / (temperature + 237.3));
}

/**
 * 飽差（VPD、hPa）を求める
 * 空気があとどれだけ水蒸気を受け入れられるかを表し、大きいほど乾きやすい
 */
export function vaporPressureDeficit(temperature: number, humidity: number): number {
  const es = saturationVaporPressure(temperature);
  return es * (1 - humidity / 100);
}

/** 1時間あたりの乾燥スピード（相対値） */
function hourlyDryingSpeed(temperature: number, humidity: number, windSpeedMps: number): number {
  const vpd = vaporPressureDeficit(temperature, humidity);
  return vpd * (1 + LAUNDRY.windFactor * Math.max(0, windSpeedMps));
}

/** 指数からレベルを求める */
function classifyScore(score: number): LaundryLevelId {
  // upperBoundにInfinityの帯があるため必ず見つかる
  return LAUNDRY_BANDS.find((b) => score <= b.upperBound)!.id;
}

/** 着ぐるみ全身洗いの乾燥目安時間（扇風機併用前提）を指数から線形補間する */
export function fursuitDryingHours(score: number): number {
  const { fursuitMinDryingHours, fursuitMaxDryingHours } = LAUNDRY;
  const range = fursuitMaxDryingHours - fursuitMinDryingHours;
  const clamped = Math.min(100, Math.max(0, score));
  return Math.round(fursuitMaxDryingHours - (range * clamped) / 100);
}

/**
 * 1日分の洗濯乾燥指数を判定する
 *
 * @param hours その日の時間別気象データ（干し時間帯以外も含んでよい）
 */
export function assessLaundry(hours: readonly HourlyWeather[]): LaundryAssessment {
  const window = filterByHourRange(hours, LAUNDRY.windowStartHour, LAUNDRY.windowEndHour);

  if (window.length === 0) {
    // 干し時間帯のデータがない日（当日の夕方以降など）は判定不能として最低評価を返す
    return {
      score: 0,
      level: 'indoorDry',
      label: LAUNDRY_LEVEL_LABELS.indoorDry,
      fursuitDryingHours: fursuitDryingHours(0),
      moldWarning: true,
      advice: `干し時間帯（${LAUNDRY.windowStartHour}〜${LAUNDRY.windowEndHour}時）の予報データがないため判定できません。`,
    };
  }

  // 欠測で干し時間帯のデータが6時間に満たない場合も指数が偏らないよう、
  // 時間平均をフル時間帯（6時間）換算してから正規化する
  const windowHours = LAUNDRY.windowEndHour - LAUNDRY.windowStartHour;
  const total = window.reduce(
    (sum, h) => sum + hourlyDryingSpeed(h.temperature, h.humidity, h.windSpeed),
    0,
  );
  const average = total / window.length;
  const score = Math.min(100, Math.round((average * windowHours) / LAUNDRY.normalizeDivisor));

  const hasRain = window.some((h) => h.precipitation > 0);
  const averageTemperature =
    window.reduce((sum, h) => sum + h.temperature, 0) / window.length;

  let level: LaundryLevelId;
  if (hasRain) {
    level = 'noDryRain';
  } else if (averageTemperature < LAUNDRY.coldLimit) {
    level = 'noDryCold';
  } else {
    level = classifyScore(score);
  }

  const effectiveScore = level === 'noDryRain' ? 0 : score;
  const dryingHours = fursuitDryingHours(effectiveScore);
  const moldWarning = effectiveScore < LAUNDRY.moldWarningScore;

  return {
    score: effectiveScore,
    level,
    label: LAUNDRY_LEVEL_LABELS[level],
    fursuitDryingHours: dryingHours,
    moldWarning,
    advice: buildLaundryAdvice(level, dryingHours, moldWarning),
  };
}

/** 判定結果から利用者向けの注意文を組み立てる（判定ロジックとは独立した表示文言の関心事） */
function buildLaundryAdvice(
  level: LaundryLevelId,
  dryingHours: number,
  moldWarning: boolean,
): string {
  const adviceParts: string[] = [];
  if (level === 'noDryRain') {
    adviceParts.push('降水が予想されるため外干しは避けてください。');
  } else if (level === 'noDryCold') {
    adviceParts.push('気温が低く乾きにくい日です。室内での乾燥をおすすめします。');
  }
  adviceParts.push(
    `着ぐるみの全身洗いは扇風機併用で約${dryingHours}時間の乾燥が目安です。`,
  );
  if (moldWarning) {
    adviceParts.push(
      `${LAUNDRY.fursuitMaxDryingHours}時間以内に乾き切らないとカビの恐れがあります。除湿機の併用を推奨します。`,
    );
  }
  adviceParts.push('乾燥機は熱でファーが傷むため、熱なし設定でも使用しないでください。');
  return adviceParts.join('');
}
