// 洗濯乾燥指数の係数・しきい値・表示ラベル
// 係数・しきい値には出典を明記する（一覧と方針はindex.tsを参照）

import type { LaundryLevelId } from '../types';

/**
 * 洗濯乾燥指数の計算パラメータ
 * 乾燥スピード D = VPD（hPa）×（1 + 0.225×風速（m/s））を干し時間帯で積算して指数化
 * VPD（飽差）はTetensの式による飽和水蒸気圧から算出
 * 風速関数はMeyer式（小さい濡れ面の蒸発量推定）のm/s換算形
 * 出典: https://en.wikipedia.org/wiki/Tetens_equation
 * 段階分けはtenki.jp洗濯指数の5段階に準拠: https://tenki.jp/indexes/cloth_dried/
 */
export const LAUNDRY = {
  /** 干し時間帯の開始時刻（時、この時刻を含む） */
  windowStartHour: 9,
  /** 干し時間帯の終了時刻（時、この時刻を含まない） */
  windowEndHour: 15,
  /** Meyer式の風速係数（m/s換算） */
  windFactor: 0.225,
  /** 干し時間帯フル（6時間）換算の積算乾燥スピードを0〜100に正規化する除数（経験的調整値） */
  normalizeDivisor: 1.8,
  /** この気温（℃）未満は「寒くて乾きにくい」扱い（ウェザーニューズの段階設計に準拠） */
  coldLimit: 5,
  /** 着ぐるみ全身洗いの最短乾燥時間（時間、扇風機併用前提） */
  fursuitMinDryingHours: 24,
  /** 着ぐるみ全身洗いの最長目安時間（時間、これを超えるとカビリスク大） */
  fursuitMaxDryingHours: 48,
  /** この指数未満はカビ警告を出す */
  moldWarningScore: 30,
} as const;

/** 洗濯乾燥レベル定義（スコアしきい値はtenki.jp互換） */
interface LaundryBand {
  /** この値以下なら該当 */
  upperBound: number;
  id: LaundryLevelId;
}

export const LAUNDRY_BANDS: readonly LaundryBand[] = [
  { upperBound: 30, id: 'indoorDry' },
  { upperBound: 50, id: 'fair' },
  { upperBound: 70, id: 'good' },
  { upperBound: 85, id: 'veryGood' },
  // 番兵（HEAT_BANDS・COLD_BANDSと同方式）。スコアは0〜100に正規化済みだが、
  // 帯の追加・変更時にフォールバックのid直書きが要らないようにする
  { upperBound: Number.POSITIVE_INFINITY, id: 'excellent' },
];

/**
 * 洗濯乾燥レベルの表示ラベル
 * スコア由来の5段階に加え、例外レベル（降雨・低温）を含む全レベル分を一元管理する
 */
export const LAUNDRY_LEVEL_LABELS: Readonly<Record<LaundryLevelId, string>> = {
  noDryRain: '外干しNG（雨）',
  noDryCold: '乾きにくい（低温）',
  indoorDry: '部屋干し推奨',
  fair: 'やや乾く',
  good: '乾く',
  veryGood: 'よく乾く',
  excellent: '大変よく乾く',
};
