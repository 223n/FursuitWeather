// 気象そのものの注意基準と時間帯の定義（強風・雷・急な暑さ・日中の範囲・天気コードのラベル）
// 係数・しきい値には出典を明記する（一覧と方針はindex.tsを参照）

/**
 * 強風の注意を出す風速（m/s、1時間平均）
 * 気象庁「風の強さと吹き方」の「やや強い風」（平均10m/s以上）に相当。
 * 着ぐるみは頭部が大きく視界・聴覚が制限されるため、設営物の飛散や
 * バランスを崩す転倒への注意をこの段階から促す。
 * 表示は平均風速で、瞬間的な突風はこの1.5〜3倍になることがある（気象庁解説より）
 * 出典: https://www.jma.go.jp/jma/kishou/know/yougo_hp/kazehyo.html
 */
export const WIND_CAUTION_SPEED = 10;

/**
 * 雷雨とみなすWMO天気コードの下限
 * WMOコード95〜99は雷雨（Open-Meteoのweather_code仕様）。
 * 上流モデルが雷コードを返さない場合もあるため、表示は「予報があるときだけ
 * 注意を出す」片方向にとどめ、「雷表示がない=雷なし」とは扱わない
 */
export const THUNDER_WEATHER_CODE_MIN = 95;

/**
 * 急な暑さ（暑熱順化前）の注意条件
 * 梅雨明け直後などの急な気温上昇は、WBGT絶対値が真夏より低くても
 * 体が暑さに慣れていないため熱中症リスクが高い（日本生気象学会
 * 「日常生活における熱中症予防指針Ver.4」、消防庁の救急搬送統計）。
 * しきい値（+5℃・25℃以上）は公的な確定基準ではなく本サービスの目安
 * 出典: https://seikishou.jp/cms/wp-content/uploads/20220523-v4.pdf
 */
export const SUDDEN_HEAT = {
  /** 比較する過去日数 */
  baselineDays: 7,
  /** 判定に必要な最少の過去日数（欠測が多い場合は判定しない） */
  minBaselineDays: 5,
  /** 直近平均の最高気温をこの差（℃）以上上回ると注意を出す */
  temperatureRise: 5,
  /** 誤警報防止の季節ゲート: 対象日の最高気温がこの値（℃）未満なら出さない */
  minTargetMax: 25,
  /** 比較対象の日とみなすのに必要な1日あたりの時間数。
   * 欠測で夜間だけ残った日を「その日の最高気温」として数えると平均が
   * 過小になり警告の出し過ぎ方向へずれるため、半日分未満の日は除外する */
  minSamplesPerDay: 12,
} as const;

/** 日別サマリーで「日中」とみなす時間帯（時、開始を含み終了を含まない） */
export const DAYTIME_START_HOUR = 9;
export const DAYTIME_END_HOUR = 18;

/** 活動推奨時間帯とみなすgradeの上限（これ以下を推奨） */
export const RECOMMENDED_MAX_GRADE = 1;

/** WMO天気コードの日本語ラベル */
export function weatherCodeLabel(code: number): string {
  if (code === 0) {
    return '快晴';
  }
  if (code === 1) {
    return '晴れ';
  }
  if (code === 2) {
    return '一部曇り';
  }
  if (code === 3) {
    return '曇り';
  }
  if (code === 45 || code === 48) {
    return '霧';
  }
  if (code >= 51 && code <= 57) {
    return '霧雨';
  }
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
    return '雨';
  }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return '雪';
  }
  if (code >= 95) {
    return '雷雨';
  }
  return '不明';
}
