// FursuitWeather 定数定義
// 係数・しきい値はすべて本ファイルに集約し、出典を明記する

import type {
  ColdLevelId,
  CoolingNeed,
  Grade,
  HeatLevelId,
  LaundryLevelId,
  OutdoorLevelId,
} from './types';

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
 * 判定結果の組み立て（fursuit.tsのassessOutdoor）はこの形だけに依存する
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
 */
export const COOLING_REQUIRED_WBGT = 25;
export const COOLING_RECOMMENDED_WBGT = 21;

/** 冷房要否の表示ラベル（LAUNDRY_LEVEL_LABELSと同様、表示文言は本ファイルに集約する） */
export const COOLING_LABELS: Readonly<Record<CoolingNeed, string>> = {
  required: '冷房必須',
  recommended: '冷房推奨',
  none: '冷房なしでも可',
};

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

/** 日別サマリーで「日中」とみなす時間帯（時、開始を含み終了を含まない） */
export const DAYTIME_START_HOUR = 9;
export const DAYTIME_END_HOUR = 18;

/** 活動推奨時間帯とみなすgradeの上限（これ以下を推奨） */
export const RECOMMENDED_MAX_GRADE = 1;

/** Open-Meteo JMAモデルAPI（気象庁MSM/GSMモデル由来の予報データ） */
export const OPEN_METEO_BASE_URL = 'https://api.open-meteo.com/v1/jma';

/**
 * Open-Meteo標準予報API（複数モデルの合成）
 * 降水確率は気象庁モデルAPIでは提供されないため、この標準APIから補完取得する
 */
export const OPEN_METEO_FORECAST_BASE_URL = 'https://api.open-meteo.com/v1/forecast';

/** Open-Meteoジオコーディングv1 API（都市名・郵便番号から座標を検索する） */
export const GEOCODING_BASE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/**
 * zipcloud 郵便番号検索API（日本の郵便番号→住所変換）
 * Open-Meteoの検索は日本の郵便番号を確実には引けないため、
 * 郵便番号はまず住所（市区町村名）へ変換してから地名で検索する
 */
export const ZIPCLOUD_BASE_URL = 'https://zipcloud.ibsnet.co.jp/api/search';

/** 地点検索クエリの最大文字数（異常に長い入力を上流へ流さない） */
export const GEOCODING_MAX_QUERY_LENGTH = 100;

/** 地点検索の最大候補数 */
export const GEOCODING_MAX_RESULTS = 5;

/**
 * 地名検索が0件だったときに補う市区町村の接尾辞（試行順）
 * Open-Meteoジオコーディングは2文字以下の検索語を完全一致でしか照合しないため、
 * 「蒲郡」のように登録名が「蒲郡市」の地点は素の検索で0件になる。
 * 2文字以下で0件のときに限り、これらを順に補って再検索する
 * （3文字以上は部分一致が働くため対象外。上流呼び出しの増幅も防ぐ）
 */
export const GEOCODING_CITY_SUFFIXES: readonly string[] = ['市', '町', '村', '区'];

/**
 * 郵便番号から得た市区町村名を段階的に短くして再検索する回数の上限
 * zipcloudの住所（address2）は「大阪市北区」「伊都郡高野町」のような複合名を返すが、
 * Open-Meteoジオコーディングの登録名は「大阪市」「高野町」「御殿場」のように
 * 単一の自治体名（接尾辞の有無も一定しない）のため、複合名のままでは0件になる。
 * 政令市の区→市、郡→町村、接尾辞除去の順で候補を絞り込む。
 * 現在の絞り込み規則が作る候補は最大3件だが、規則を増やしたときに
 * 上流呼び出しが際限なく増えないよう上限として明示する
 */
export const GEOCODING_CITY_FALLBACK_LIMIT = 3;

/** 地点検索レスポンスのキャッシュ時間（秒）。地名データはほぼ変化しないため7日 */
export const GEOCODING_CACHE_TTL_SECONDS = 604800;

/** 上流APIレスポンスのキャッシュ時間（秒）。MSMの更新は3時間ごとのため30分で十分 */
export const UPSTREAM_CACHE_TTL_SECONDS = 1800;

/**
 * 上流APIの応答待ちタイムアウト（ミリ秒）
 * 通常応答は1秒未満のため、エッジキャッシュミス時の余裕を見ても10秒で十分。
 * 上流の応答停滞時にユーザーリクエストを長時間道連れにしないための上限
 */
export const UPSTREAM_TIMEOUT_MS = 10000;

/**
 * 上流APIが5xxを返したときに取り直すまでの待ち時間（ミリ秒）
 * Open-Meteo自身もCDNの背後にあり、CDNからオリジンへ到達できない数百ミリ秒の
 * 瞬断（HTTP 525など）が実際に観測されている。利用者を待たせすぎない範囲で
 * 瞬断をまたげる長さにする
 */
export const UPSTREAM_RETRY_DELAY_MS = 250;

/** 自APIレスポンスのブラウザキャッシュ時間（秒） */
export const RESPONSE_CACHE_MAX_AGE_SECONDS = 600;

/**
 * 取得する予報日数のデフォルトと上限
 * 気象庁MSMの予報範囲は4日先までで、それ以降のGSMには日射量データがなく
 * WBGT計算ができないため、上限を4日とする
 */
export const DEFAULT_FORECAST_DAYS = 4;
export const MAX_FORECAST_DAYS = 4;

/**
 * APIレスポンスの帰属表示（Open-Meteoの利用規約により表示時の出典明記が必要。
 * CC BY 4.0。https://open-meteo.com/en/license）
 */
export const ATTRIBUTION = {
  weatherData: 'Weather data by Open-Meteo.com（気象庁MSM/GSMモデル）',
  weatherDataUrl: 'https://open-meteo.com/',
  license: 'CC BY 4.0',
} as const;

/** 通年で表示する注意事項 */
export const YEAR_ROUND_NOTICES: readonly string[] = [
  '着ぐるみ内は冬でも数分で発汗する高温多湿環境です。季節を問わず熱中症対策が必要です。',
  '必ず2人以上で行動し、着用者以外の付き添い（ハンドラー・アテンド）を付けてください。',
  '表示の連続活動時間は気象条件から見た上限の目安です。「30分着たら30分休む」を基本に、吐き気・めまい・頭痛を感じたら直ちに脱いでください。',
  '本予報は目安です。体調や装備により安全な活動時間は変わります。最終判断はご自身で行ってください。',
];

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
