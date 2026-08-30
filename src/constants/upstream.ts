// 上流APIのURL・キャッシュ・タイムアウトと、応答に載せる表記（モデル名・失敗文言・帰属表示）
// 係数・しきい値には出典を明記する（一覧と方針はindex.tsを参照）

import type { Attribution } from '../types';

/** APIレスポンスのmodelフィールドに使う気象モデル表記（/api/forecast・/api/national共通） */
export const WEATHER_MODEL_LABEL = 'jma_seamless（気象庁MSM/GSM）';

/** 予報本体の取得失敗の利用者向け文言
 * （openMeteo.tsの上流失敗と、forecast.tsの日付またぎ防御502が共有する単一情報源） */
export const WEATHER_FETCH_FAILURE_MESSAGE =
  '気象データの取得に失敗しました。時間をおいて再度お試しください';

/** Open-Meteo JMAモデルAPI（気象庁MSM/GSMモデル由来の予報データ） */
export const OPEN_METEO_BASE_URL = 'https://api.open-meteo.com/v1/jma';

/**
 * Open-Meteo標準予報API（複数モデルの合成）
 * 降水確率は気象庁モデルAPIでは提供されないため、この標準APIから補完取得する
 */
export const OPEN_METEO_FORECAST_BASE_URL = 'https://api.open-meteo.com/v1/forecast';

/**
 * Open-Meteo Air Quality API（CAMS全球モデル・無料）
 * 空気のよごれ指数（黄砂・PM2.5）の推定値をここから補完取得する
 * （降水確率と同じベストエフォート。失敗しても予報本体を巻き込まない）
 */
export const OPEN_METEO_AIR_QUALITY_BASE_URL =
  'https://air-quality-api.open-meteo.com/v1/air-quality';

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
 * 環境省の熱中症警戒アラート発表状況CSVの取得元
 * 電子情報提供サービスの公開ファイル（例年おおむね4月下旬〜10月下旬提供、
 * 毎日5時・17時発表）。当日分は /{年}/alert_{YYYYMMDD}_05.csv。
 * 様式は年度で変わり得るため、毎年4月の提供開始時に実ファイルとの突合を行う
 * （手順はdocs/release.mdの年次確認を参照。2026年度の様式はtest/fixturesに保存）
 */
export const WBGT_ALERT_BASE_URL = 'https://www.wbgt.env.go.jp/alert/dl';

/** アラート発表状況の上流エッジキャッシュTTL（秒）。発表は1日2回（5時・17時）のため、
 * 気象データと同じ30分で十分に追従できる */
export const ALERT_CACHE_TTL_SECONDS = 1800;

/**
 * APIレスポンスの帰属表示（Open-Meteoの利用規約により表示時の出典明記が必要。
 * CC BY 4.0。https://open-meteo.com/en/license）
 */
export const ATTRIBUTION = {
  weatherData: 'Weather data by Open-Meteo.com（気象庁MSM/GSMモデル）',
  weatherDataUrl: 'https://open-meteo.com/',
  license: 'CC BY 4.0',
  // satisfiesでレスポンス型（types.tsのAttribution）との形の一致をコンパイル時に強制する
} as const satisfies Attribution;
