// 空気のよごれ（黄砂・PM2.5）指数の判定
// 春の黄砂・PM2.5による白系ファーの汚れ・屋外撮影のかすみへの事前判断に使う。
// しきい値・出典はsrc/constants.tsのAIR_QUALITYを参照（CAMS推定値に対する「目安」）

import { AIR_QUALITY, AIR_QUALITY_ADVICE, AIR_QUALITY_LABELS } from '../constants';
import type { AirQualityAssessment, AirQualityLevelId } from '../types';
import { round1 } from './round';

/** 1日分の大気質の生値（時間別の並び。欠測時間は含めない） */
export interface AirQualityValues {
  pm25: readonly number[];
  dust: readonly number[];
}

/** PM2.5の日平均と黄砂の最大濃度からレベルを判定する（欠測側は判定に使わない） */
function levelOf(pm25Mean: number | null, dustMax: number | null): AirQualityLevelId {
  if (
    (pm25Mean !== null && pm25Mean >= AIR_QUALITY.pm25HighMean) ||
    (dustMax !== null && dustMax >= AIR_QUALITY.dustHighMax)
  ) {
    return 'high';
  }
  if (
    (pm25Mean !== null && pm25Mean >= AIR_QUALITY.pm25MediumMean) ||
    (dustMax !== null && dustMax >= AIR_QUALITY.dustMediumMax)
  ) {
    return 'medium';
  }
  return 'low';
}

/**
 * 1日分の大気質の生値から空気のよごれ指数を判定する
 * PM2.5は日平均（環境省の基準が日平均のため）、黄砂は最大濃度で評価する。
 * 両方とも欠測の日は判定できないためnullを返す（フロントは行ごと出さない）
 */
export function assessAirQuality(values: AirQualityValues): AirQualityAssessment | null {
  const pm25Mean =
    values.pm25.length > 0
      ? round1(values.pm25.reduce((sum, value) => sum + value, 0) / values.pm25.length)
      : null;
  const dustMax = values.dust.length > 0 ? round1(Math.max(...values.dust)) : null;
  if (pm25Mean === null && dustMax === null) {
    return null;
  }
  const level = levelOf(pm25Mean, dustMax);
  return {
    level,
    label: AIR_QUALITY_LABELS[level],
    pm25Mean,
    dustMax,
    advice: level === 'high' ? AIR_QUALITY_ADVICE : null,
  };
}
