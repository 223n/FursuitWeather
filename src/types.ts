// FursuitWeather 共有型定義

/** 1時間分の気象データ（Open-Meteo JMAモデルAPIから取得） */
export interface HourlyWeather {
  /** ローカル時刻（Asia/Tokyo、例: 2026-08-15T09:00） */
  time: string;
  /** 気温（℃） */
  temperature: number;
  /** 相対湿度（%） */
  humidity: number;
  /** 体感温度（℃） */
  apparentTemperature: number;
  /** 降水量（mm） */
  precipitation: number;
  /** 降水確率（%）。上流が提供しない場合・欠測時はnull */
  precipitationProbability: number | null;
  /** WMO天気コード（欠測時は-1） */
  weatherCode: number;
  /** 全天日射量（W/m²） */
  solarRadiation: number;
  /** 風速（m/s） */
  windSpeed: number;
}

/**
 * 深刻度（0=快適〜4=危険、UIの色分け用）
 * フロントの`grade-0`〜`grade-4` CSSクラスとGRADE_SYMBOLSの添字に直結する
 * 閉じた値域のため、帯の追加時に範囲外の値を書くとコンパイルエラーになる
 */
export type Grade = 0 | 1 | 2 | 3 | 4;

/** 暑熱側のレベルID（環境省5段階に対応） */
export type HeatLevelId = 'safe' | 'caution' | 'warning' | 'severe' | 'danger';

/**
 * 低温側のレベルID
 * 'optimal'を除き'cold'接頭辞が必須。public/app.jsのcreateBadgeが接頭辞で
 * 低温スタイル（青系配色+温度計アイコン）を判定する（test/htmlSync.test.tsで検証）
 */
export type ColdLevelId = 'optimal' | 'coldCaution' | 'coldWarning' | 'coldDanger';

/** 屋外活動レベルID */
export type OutdoorLevelId = HeatLevelId | ColdLevelId;

/** 活動判定の共通形 */
export interface ActivityAssessment {
  /** 素のWBGT推定値（℃、小数1桁） */
  wbgt: number;
  /** 着ぐるみ着衣補正（+11℃）後のWBGT（℃、小数1桁） */
  suitWbgt: number;
  /** レベルID */
  level: OutdoorLevelId;
  /** 日本語ラベル */
  label: string;
  /** 深刻度 */
  grade: Grade;
  /** 1回あたりの連続活動時間の目安（分、0は着用中止） */
  activityMinutes: number;
  /** 注意文 */
  advice: string;
}

/** 冷房の要否 */
export type CoolingNeed = 'none' | 'recommended' | 'required';

/** 屋内活動判定 */
export interface IndoorAssessment extends ActivityAssessment {
  /** 屋内は暑熱判定のみ行うため、レベルは暑熱側に限定される */
  level: HeatLevelId;
  cooling: CoolingNeed;
  coolingLabel: string;
}

/** 1時間分の予報 */
export interface HourForecast {
  time: string;
  weather: HourlyWeather;
  weatherLabel: string;
  outdoor: ActivityAssessment;
  indoor: IndoorAssessment;
}

/** 洗濯乾燥のレベルID */
export type LaundryLevelId =
  | 'noDryRain'
  | 'noDryCold'
  | 'indoorDry'
  | 'fair'
  | 'good'
  | 'veryGood'
  | 'excellent';

/** 洗濯乾燥判定（1日単位） */
export interface LaundryAssessment {
  /** 乾燥指数（0〜100） */
  score: number;
  level: LaundryLevelId;
  label: string;
  /** 着ぐるみ全身洗いの乾燥目安時間（扇風機併用前提） */
  fursuitDryingHours: number;
  /** カビ発生リスク警告（48時間以内に乾かない恐れ） */
  moldWarning: boolean;
  advice: string;
}

/** 静電気の起きやすさレベル（低・中・高の3段階） */
export type StaticElectricityLevelId = 'low' | 'medium' | 'high';

/**
 * 静電気指数（1日単位）
 * 乾燥期の化繊ファーの帯電（グリーティングでの放電・ほこり吸着）への
 * 備え（帯電防止スプレー・加湿）の判断に使う
 */
export interface StaticElectricityAssessment {
  level: StaticElectricityLevelId;
  /** 日本語ラベル（低・中・高） */
  label: string;
  /** 「高」の日の対策の一言（それ以外はnull） */
  advice: string | null;
}

/** 空気のよごれ（黄砂・PM2.5）レベル（低・中・高の3段階） */
export type AirQualityLevelId = 'low' | 'medium' | 'high';

/**
 * 空気のよごれ指数（1日単位）
 * 春の黄砂・PM2.5による白系ファーの汚れ・屋外撮影のかすみへの
 * 事前判断に使う。CAMS全球モデルの推定値に基づく「目安」で、
 * 取得失敗・欠測時はレスポンスでnullになる
 */
export interface AirQualityAssessment {
  level: AirQualityLevelId;
  /** 日本語ラベル（低・中・高） */
  label: string;
  /** その日のPM2.5の日平均（μg/m³、小数1桁）。欠測はnull */
  pm25Mean: number | null;
  /** その日の黄砂（dust）の最大濃度（μg/m³、小数1桁）。欠測はnull */
  dustMax: number | null;
  /** 「高」の日の注意の一言（それ以外はnull） */
  advice: string | null;
}

/** レベルの要約（日別サマリー用）。ActivityAssessmentの部分集合であることを型で明示する */
export type LevelSummary = Pick<ActivityAssessment, 'level' | 'label' | 'grade'>;

/** 1日分の予報サマリー */
export interface DayForecast {
  /** 日付（YYYY-MM-DD） */
  date: string;
  temperatureMin: number;
  temperatureMax: number;
  /** 日中の代表天気コード（日中データがない日は全時間帯で代替） */
  weatherCode: number;
  weatherLabel: string;
  /** 日の出時刻（HH:mm）。上流が提供しない・欠測時はnull */
  sunrise: string | null;
  /** 日の入り時刻（HH:mm）。上流が提供しない・欠測時はnull */
  sunset: string | null;
  /** 日中（9〜18時）の最も厳しい屋外判定（日中データがない日は全時間帯で代替） */
  outdoorWorst: LevelSummary;
  /** 日中（9〜18時）の最も穏やかな屋外判定（日中データがない日は全時間帯で代替） */
  outdoorBest: LevelSummary;
  /** 屋外活動に適した時間帯（HH:00形式、9〜18時のうちgrade1以下かつ降水量0） */
  recommendedHours: readonly string[];
  /** 日中に冷房必須となる時間があるか（日中データがない日は全時間帯で判定） */
  coolingRequired: boolean;
  /** その日の素のWBGT（着衣補正前）の最大値（℃）。熱中症警戒アラートの
   * 発表基準（33以上）への該当判断に使える */
  maxWbgt: number;
  /** その日の最大風速（m/s、1時間平均の最大。全時間帯から取る） */
  maxWindSpeed: number;
  laundry: LaundryAssessment;
  /** 静電気の起きやすさ（日中の各時間のうち最も厳しいレベルを採用） */
  staticElectricity: StaticElectricityAssessment;
  /** 空気のよごれ（黄砂・PM2.5）。取得失敗・欠測時はnull（ベストエフォート） */
  airQuality: AirQualityAssessment | null;
}

/**
 * 急な暑さ（暑熱順化前）の注意
 * 対象日の最高気温が直近数日の平均最高気温を大きく上回るときに付く。
 * 判定できないとき（過去データの不足・欠測）はレスポンスでnullになる
 */
export interface SuddenHeatWarning {
  /** 対象日（YYYY-MM-DD） */
  date: string;
  /** 直近の平均最高気温（℃、小数1桁） */
  recentAverageMax: number;
  /** 対象日の最高気温（℃） */
  targetMax: number;
}

/** 地点検索（ジオコーディング）の1候補 */
export interface GeocodeResult {
  /** 地名（例: 松山） */
  name: string;
  /** 都道府県などの上位区分（例: 愛媛県）。不明なら空文字 */
  admin1: string;
  latitude: number;
  longitude: number;
}

/** 予報対象の位置情報 */
export interface ForecastLocation {
  latitude: number;
  longitude: number;
  timezone: string;
}

/** APIレスポンスの帰属表示（Open-Meteo利用規約による出典明記） */
export interface Attribution {
  readonly weatherData: string;
  readonly weatherDataUrl: string;
  readonly license: string;
}

/** 全国天気の1都市分の当日サマリー（/api/national） */
export interface NationalCitySummary {
  /** 都市名（例: 札幌） */
  name: string;
  latitude: number;
  longitude: number;
  /** 日中の代表天気コード */
  weatherCode: number;
  weatherLabel: string;
  temperatureMin: number;
  temperatureMax: number;
  /** 日中（9〜18時）の最も厳しい屋外判定 */
  outdoorWorst: LevelSummary;
}

/** /api/national レスポンス全体 */
export interface NationalResponse {
  /** 生成時刻（ISO8601） */
  generatedAt: string;
  /** 対象日（YYYY-MM-DD、日本時間の当日） */
  date: string;
  /** 使用した気象モデル */
  model: string;
  attribution: Attribution;
  /** 取得できた都市のみ（失敗した都市は含まれない） */
  cities: readonly NationalCitySummary[];
}

/** APIレスポンス全体 */
export interface ForecastResponse {
  location: ForecastLocation;
  /** 生成時刻（ISO8601） */
  generatedAt: string;
  /** 使用した気象モデル */
  model: string;
  attribution: Attribution;
  /** 通年の注意事項 */
  notices: readonly string[];
  /** 急な暑さ（暑熱順化前）の注意。該当なし・判定不能はnull */
  suddenHeat: SuddenHeatWarning | null;
  hours: readonly HourForecast[];
  days: readonly DayForecast[];
}
