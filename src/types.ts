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
  /** WMO天気コード */
  weatherCode: number;
  /** 全天日射量（W/m²） */
  solarRadiation: number;
  /** 風速（m/s） */
  windSpeed: number;
}

/** 暑熱側のレベルID（環境省5段階に対応） */
export type HeatLevelId = 'safe' | 'caution' | 'warning' | 'severe' | 'danger';

/** 低温側のレベルID */
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
  /** 深刻度（0=快適〜4=危険、UIの色分け用） */
  grade: number;
  /** 1回あたりの連続活動時間の目安（分、0は着用中止） */
  activityMinutes: number;
  /** 注意文 */
  advice: string;
}

/** 冷房の要否 */
export type CoolingNeed = 'none' | 'recommended' | 'required';

/** 屋内活動判定 */
export interface IndoorAssessment extends ActivityAssessment {
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
  /** ファースーツ全身洗いの乾燥目安時間（扇風機併用前提） */
  fursuitDryingHours: number;
  /** カビ発生リスク警告（48時間以内に乾かない恐れ） */
  moldWarning: boolean;
  advice: string;
}

/** レベルの要約（日別サマリー用） */
export interface LevelSummary {
  level: OutdoorLevelId;
  label: string;
  grade: number;
}

/** 1日分の予報サマリー */
export interface DayForecast {
  /** 日付（YYYY-MM-DD） */
  date: string;
  temperatureMin: number;
  temperatureMax: number;
  /** 日中の代表天気コード */
  weatherCode: number;
  weatherLabel: string;
  /** 日中（9〜18時）の最も厳しい屋外判定 */
  outdoorWorst: LevelSummary;
  /** 日中（9〜18時）の最も穏やかな屋外判定 */
  outdoorBest: LevelSummary;
  /** 屋外活動に適した時間帯（HH:00形式、9〜18時のうちgrade1以下） */
  recommendedHours: string[];
  /** 日中に冷房必須となる時間があるか */
  coolingRequired: boolean;
  laundry: LaundryAssessment;
}

/** APIレスポンス全体 */
export interface ForecastResponse {
  location: {
    latitude: number;
    longitude: number;
    timezone: string;
  };
  /** 生成時刻（ISO8601） */
  generatedAt: string;
  /** 使用した気象モデル */
  model: string;
  attribution: {
    weatherData: string;
    weatherDataUrl: string;
    license: string;
  };
  /** 通年の注意事項 */
  notices: string[];
  hours: HourForecast[];
  days: DayForecast[];
}
