// 洗濯乾燥指数
// Tetensの式で飽和水蒸気圧から飽差（VPD）を求め、Meyer式由来の風速関数を掛けた
// 毎時の乾燥スピードを干し時間帯（9〜15時）で積算して0〜100に指数化する
// 段階分けはtenki.jp洗濯指数の5段階に準拠し、降雨・低温の例外処理を重ねる

import { LAUNDRY, LAUNDRY_BANDS } from '../constants';
import type { HourlyWeather, LaundryAssessment, LaundryLevelId } from '../types';

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
export function hourlyDryingSpeed(temperature: number, humidity: number, windSpeedMps: number): number {
  const vpd = vaporPressureDeficit(temperature, humidity);
  return vpd * (1 + LAUNDRY.windFactor * Math.max(0, windSpeedMps));
}

/** 指数からレベルを求める */
function classifyScore(score: number): LaundryLevelId {
  const band = LAUNDRY_BANDS.find((b) => score <= b.upperBound);
  return band?.id ?? 'excellent';
}

const LEVEL_LABELS: Record<LaundryLevelId, string> = {
  noDryRain: '外干しNG（雨）',
  noDryCold: '乾きにくい（低温）',
  indoorDry: '部屋干し推奨',
  fair: 'やや乾く',
  good: '乾く',
  veryGood: 'よく乾く',
  excellent: '大変よく乾く',
};

/** ファースーツ全身洗いの乾燥目安時間（扇風機併用前提）を指数から線形補間する */
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
  const window = hours.filter((h) => {
    const hour = Number.parseInt(h.time.slice(11, 13), 10);
    return hour >= LAUNDRY.windowStartHour && hour < LAUNDRY.windowEndHour;
  });

  if (window.length === 0) {
    // 干し時間帯のデータがない日（当日の夕方以降など）は判定不能として最低評価を返す
    return {
      score: 0,
      level: 'indoorDry',
      label: LEVEL_LABELS.indoorDry,
      fursuitDryingHours: fursuitDryingHours(0),
      moldWarning: true,
      advice: '干し時間帯（9〜15時）の予報データがないため判定できません。',
    };
  }

  const total = window.reduce(
    (sum, h) => sum + hourlyDryingSpeed(h.temperature, h.humidity, h.windSpeed),
    0,
  );
  const score = Math.min(100, Math.round(total / LAUNDRY.normalizeDivisor));

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

  const adviceParts: string[] = [];
  if (level === 'noDryRain') {
    adviceParts.push('降水が予想されるため外干しは避けてください。');
  } else if (level === 'noDryCold') {
    adviceParts.push('気温が低く乾きにくい日です。室内での乾燥をおすすめします。');
  }
  adviceParts.push(
    `ファースーツの全身洗いは扇風機併用で約${dryingHours}時間の乾燥が目安です。`,
  );
  if (moldWarning) {
    adviceParts.push('48時間以内に乾き切らないとカビの恐れがあります。除湿機の併用を推奨します。');
  }
  adviceParts.push('乾燥機は熱でファーが傷むため、熱なし設定でも使用しないでください。');

  return {
    score: effectiveScore,
    level,
    label: LEVEL_LABELS[level],
    fursuitDryingHours: dryingHours,
    moldWarning,
    advice: adviceParts.join(''),
  };
}
