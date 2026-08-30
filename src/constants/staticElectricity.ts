// 静電気指数のしきい値・表示ラベル・対策文
// 係数・しきい値には出典を明記する（一覧と方針はindex.tsを参照）

import type { StaticElectricityLevelId } from '../types';

/**
 * 静電気指数のしきい値
 * 「相対湿度40%以下・気温20℃以下で静電気が発生しやすい」という帯電対策の
 * 一般的な目安（家電・繊維業界の啓発資料に共通。例: パナソニック・ライオンの
 * 静電気対策解説）に準拠する。主要気象サービスの生活指数（tenki.jp静電気指数
 * など）と同じ位置づけの「目安」であり、判定は日中（DAYTIME_*の時間帯）の
 * 各時間を個別に判定し、最も厳しいレベルを採用する（活動中の最悪ケース）。
 * 乾燥期の化繊ファーは強く帯電し、グリーティングでの放電・ほこり吸着の
 * 原因になるため、着ぐるみ特化の生活指数として表示する
 */
export const STATIC_ELECTRICITY = {
  /** この湿度（%）未満は気温によらず「高」 */
  highHumidity: 25,
  /** この湿度（%）未満かつmediumTemperature未満で「中」 */
  mediumHumidity: 40,
  /** 「中」判定の気温（℃）上限（乾燥していても暖かければ帯電しにくい） */
  mediumTemperature: 20,
} as const;

/** 静電気レベルの表示ラベル */
export const STATIC_ELECTRICITY_LABELS: Readonly<Record<StaticElectricityLevelId, string>> = {
  low: '低',
  medium: '中',
  high: '高',
};

/** 静電気「高」の日に添える対策の一言 */
export const STATIC_ELECTRICITY_ADVICE = 'グリーティング前に帯電防止スプレーを。';
