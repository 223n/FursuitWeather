// 活動判定の係数・しきい値（WBGT推定式・着衣補正・暑熱／低温の帯・冷房要否・通年の注意）
// 係数・しきい値には出典を明記する（一覧と方針はindex.tsを参照）

import type {
  ColdLevelId,
  CoolingNeed,
  Grade,
  HeatLevelId,
  OutdoorLevelId,
} from '../types';

/**
 * 小野ら（2014）によるWBGT推定式の係数
 * WBGT = 0.735×Ta + 0.0374×RH + 0.00292×Ta×RH + 7.619×SR − 4.557×SR² − 0.0572×WS − 4.064
 *   Ta: 気温（℃）、RH: 相対湿度（%）、SR: 全天日射量（kW/m²）、WS: 風速（m/s）
 * 環境省「熱中症予防情報サイト」の実況推定値・予測値と同一の手法
 * 出典: https://www.wbgt.env.go.jp/doc_observation.php
 * 出典: https://www.jstage.jst.go.jp/article/seikisho/50/4/50_147/_pdf
 */
export const ONO_2014 = {
  ta: 0.735,
  rh: 0.0374,
  taRh: 0.00292,
  sr: 7.619,
  srSquared: -4.557,
  ws: -0.0572,
  intercept: -4.064,
} as const;

/**
 * 着ぐるみ（フルスーツ）の着衣補正値（℃）
 * 厚生労働省「職場における熱中症予防基本対策要綱」（ISO 7243:2017準拠）の
 * WBGT着衣補正値で「フード付き蒸気不透過つなぎ服」= +11℃に相当
 * 出典: https://www.jaish.gr.jp/horei/hor1-56/hor1-56-12-1-3.pdf
 */
export const SUIT_WBGT_ADJUSTMENT = 11;

/**
 * 屋内WBGT計算時の想定風速（m/s）
 * 日本生気象学会「室内用WBGT簡易推定図」が想定する室内風速に準拠
 * 出典: https://seikishou.jp/cms/wp-content/uploads/20220523-v4.pdf
 */
export const INDOOR_WIND_SPEED = 0.5;

/**
 * 低温判定を併用し始める気温（℃）
 * 小野式は夏季日中の観測データへの回帰式のため低温域では精度が落ちるが、
 * 着ぐるみの着衣補正+11℃により15℃未満でも暑熱リスクは残る。
 * そのため低温域では暑熱判定と低温判定の両方を計算し、深刻な方を採用する
 */
export const COLD_SWITCH_TEMPERATURE = 15;

/**
 * 熱中症警戒アラートの発表基準となる暑さ指数（℃、着衣補正前の素のWBGT）
 * 環境省・気象庁は府県予報区内のいずれかの地点で日最高暑さ指数33以上が
 * 予測される場合に熱中症警戒アラートを発表する
 * https://www.wbgt.env.go.jp/alert.php
 */
export const HEAT_STROKE_ALERT_WBGT = 33;

/**
 * 活動レベル定義の共通形（暑熱側・低温側で共有するフィールド）
 * 判定結果の組み立て（fursuit.tsのassessOutdoor・assessIndoor）はこの形だけに依存する
 */
export interface ActivityBand {
  id: OutdoorLevelId;
  label: string;
  grade: Grade;
  /** 1回あたりの連続活動時間の目安（分） */
  activityMinutes: number;
  advice: string;
}

/** 暑熱側レベル定義（環境省・日本スポーツ協会共通の5段階） */
interface HeatBand extends ActivityBand {
  /** この値未満なら該当（℃、着ぐるみ補正後のWBGTと比較） */
  upperBound: number;
  id: HeatLevelId;
}

/**
 * WBGTしきい値（21/25/28/31℃）と運動指針
 * 出典: https://www.wbgt.env.go.jp/wbgt.php
 * 出典: https://www.japan-sports.or.jp/medicine/tabid/922/Default.aspx
 * 活動時間の上限目安は、自治体の着ぐるみ運用マニュアル（1回30分以内、夏季は10〜20分）と
 * イベントガイドなどの推奨（30〜45分で休憩）の範囲内に収まるよう段階化している。
 * 最も涼しい帯でも45分を上限とし、常時表示の「30分着たら30分休む」を基本とする
 * 出典: https://www.city.saitama.lg.jp/006/012/001/004/004/p010212_d/fil/kigurumi-m.pdf （さいたま市 着ぐるみ使用マニュアル）
 * 出典: https://www.anthrocon.org/guides/fursuiting-in-the-summer/ （Anthrocon公式ガイド）
 */
export const HEAT_BANDS: readonly HeatBand[] = [
  {
    upperBound: 21,
    id: 'safe',
    label: 'ほぼ安全',
    grade: 0,
    activityMinutes: 45,
    advice: '快適に活動できます。それでもスーツ内は蒸れるため、45分をめどに休憩し、適宜水分補給をしてください。',
  },
  {
    upperBound: 25,
    id: 'caution',
    label: '注意',
    grade: 1,
    activityMinutes: 30,
    advice: '積極的に水分補給をし、30分をめどに休憩を入れましょう。',
  },
  {
    upperBound: 28,
    id: 'warning',
    label: '警戒',
    grade: 2,
    activityMinutes: 20,
    advice: '20分ごとに必ず休憩し、ヘッドを外して冷却してください。冷却ベストの着用を推奨します。',
  },
  {
    upperBound: 31,
    id: 'severe',
    label: '厳重警戒',
    grade: 3,
    activityMinutes: 10,
    advice: '連続10分以内にとどめ、屋内の冷房環境へ退避してください。電解質補給も必須です。',
  },
  {
    upperBound: Number.POSITIVE_INFINITY,
    id: 'danger',
    label: '危険',
    grade: 4,
    activityMinutes: 0,
    advice: '着ぐるみの着用は中止してください。熱中症の危険が非常に高い状態です。',
  },
];

/** 低温側レベル定義 */
interface ColdBand extends ActivityBand {
  /** この値より大きければ該当（℃、体感温度と比較） */
  lowerBound: number;
  id: ColdLevelId;
}

/**
 * 低温側のしきい値（体感温度0/-10/-20℃）
 * 汗冷えによる低体温・凍結路面・末端の凍傷リスクを段階化
 */
export const COLD_BANDS: readonly ColdBand[] = [
  {
    lowerBound: 0,
    id: 'optimal',
    label: '快適',
    grade: 0,
    activityMinutes: 45,
    advice: '着ぐるみ活動に適した気温です。45分をめどに休憩し、脱いだ後の汗冷えに注意してください。',
  },
  {
    lowerBound: -10,
    id: 'coldCaution',
    label: '低温注意',
    grade: 1,
    activityMinutes: 45,
    advice: '凍結した路面での転倒に注意してください。ヘッド着用時は視界が狭くなります。休憩時の汗冷え対策も必要です。',
  },
  {
    lowerBound: -20,
    id: 'coldWarning',
    label: '低温警戒',
    grade: 2,
    activityMinutes: 30,
    advice: '手足など末端の防寒を徹底し、活動は30分以内にとどめてください。濡れたファーは断熱性を失います。',
  },
  {
    lowerBound: Number.NEGATIVE_INFINITY,
    id: 'coldDanger',
    label: '低温危険',
    grade: 4,
    activityMinutes: 0,
    advice: '屋外での着ぐるみ活動は推奨できません。凍傷やスーツ素材の低温劣化の恐れがあります。',
  },
];

/**
 * 冷房要否のしきい値（℃、屋内の着ぐるみ補正後WBGTと比較）
 * 補正後WBGTが「警戒」帯に入るなら冷房必須、「注意」帯なら冷房推奨
 * （HEAT_BANDSの帯境界との対応はtest/fursuit.test.tsで機械検証される）
 */
export const COOLING_REQUIRED_WBGT = 25;
export const COOLING_RECOMMENDED_WBGT = 21;

/** 冷房要否の表示ラベル（LAUNDRY_LEVEL_LABELSと同様、表示文言は本ファイルに集約する） */
export const COOLING_LABELS: Readonly<Record<CoolingNeed, string>> = {
  required: '冷房必須',
  recommended: '冷房推奨',
  none: '冷房なしでも可',
};

/** 通年で表示する注意事項 */
export const YEAR_ROUND_NOTICES: readonly string[] = [
  '着ぐるみ内は冬でも数分で発汗する高温多湿環境です。季節を問わず熱中症対策が必要です。',
  '必ず2人以上で行動し、着用者以外の付き添い（ハンドラー・アテンド）を付けてください。',
  '表示の連続活動時間は気象条件から見た上限の目安です。「30分着たら30分休む」を基本に、吐き気・めまい・頭痛を感じたら直ちに脱いでください。',
  '本予報は目安です。体調や装備により安全な活動時間は変わります。最終判断はご自身で行ってください。',
];
