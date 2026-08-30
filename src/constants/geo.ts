// 地理データ（全国主要都市・都道府県の代表点）
// 係数・しきい値には出典を明記する（一覧と方針はindex.tsを参照）

/** 全国天気（/api/national）の対象都市 */
export interface NationalCity {
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
}

/**
 * 全国天気の主要都市リスト（会場表示モードの全国スライド用）
 * public/app.jsのCITIES（地点セレクトのプリセット）と同一リストにする
 * （ずれはtest/htmlSync.test.tsが検出する）
 */
export const NATIONAL_CITIES: readonly NationalCity[] = [
  { name: '札幌', lat: 43.0618, lon: 141.3545 },
  { name: '仙台', lat: 38.2682, lon: 140.8694 },
  { name: '東京', lat: 35.6785, lon: 139.6823 },
  { name: '新潟', lat: 37.9026, lon: 139.0236 },
  { name: '金沢', lat: 36.5613, lon: 136.6562 },
  { name: '名古屋', lat: 35.1815, lon: 136.9066 },
  { name: '大阪', lat: 34.6937, lon: 135.5023 },
  { name: '広島', lat: 34.3853, lon: 132.4553 },
  { name: '高松', lat: 34.3428, lon: 134.0466 },
  { name: '福岡', lat: 33.5902, lon: 130.4017 },
  { name: '鹿児島', lat: 31.5966, lon: 130.5571 },
  { name: '那覇', lat: 26.2124, lon: 127.6809 },
];

/** 都道府県の代表点（都道府県庁所在地の座標） */
export interface PrefecturePoint {
  /** 都道府県コード（JIS X 0401の2桁。アラートCSVの都道府県コード列と同じ体系） */
  readonly code: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
}

/**
 * 都道府県の代表点一覧（アラート発表状況の突合用）
 * 表示地点から最も近い代表点の都道府県を「表示地点の都道府県」とみなす。
 * 県境付近では隣県に判定され得るため、画面には必ず都道府県名を併記して
 * どの発表を示しているか分かるようにする。座標は国土地理院の
 * 「都道府県庁の位置」に基づく（小数4桁）
 */
export const PREFECTURE_POINTS: readonly PrefecturePoint[] = [
  { code: '01', name: '北海道', lat: 43.0642, lon: 141.3469 },
  { code: '02', name: '青森県', lat: 40.8244, lon: 140.74 },
  { code: '03', name: '岩手県', lat: 39.7036, lon: 141.1525 },
  { code: '04', name: '宮城県', lat: 38.2688, lon: 140.8721 },
  { code: '05', name: '秋田県', lat: 39.7186, lon: 140.1024 },
  { code: '06', name: '山形県', lat: 38.2404, lon: 140.3633 },
  { code: '07', name: '福島県', lat: 37.75, lon: 140.4678 },
  { code: '08', name: '茨城県', lat: 36.3418, lon: 140.4468 },
  { code: '09', name: '栃木県', lat: 36.5658, lon: 139.8836 },
  { code: '10', name: '群馬県', lat: 36.3911, lon: 139.0608 },
  { code: '11', name: '埼玉県', lat: 35.8569, lon: 139.6489 },
  { code: '12', name: '千葉県', lat: 35.6047, lon: 140.1233 },
  { code: '13', name: '東京都', lat: 35.6895, lon: 139.6917 },
  { code: '14', name: '神奈川県', lat: 35.4478, lon: 139.6425 },
  { code: '15', name: '新潟県', lat: 37.9026, lon: 139.0236 },
  { code: '16', name: '富山県', lat: 36.6953, lon: 137.2113 },
  { code: '17', name: '石川県', lat: 36.5947, lon: 136.6256 },
  { code: '18', name: '福井県', lat: 36.0652, lon: 136.2216 },
  { code: '19', name: '山梨県', lat: 35.6642, lon: 138.5684 },
  { code: '20', name: '長野県', lat: 36.6513, lon: 138.181 },
  { code: '21', name: '岐阜県', lat: 35.3912, lon: 136.7223 },
  { code: '22', name: '静岡県', lat: 34.9769, lon: 138.3831 },
  { code: '23', name: '愛知県', lat: 35.1802, lon: 136.9066 },
  { code: '24', name: '三重県', lat: 34.7303, lon: 136.5086 },
  { code: '25', name: '滋賀県', lat: 35.0045, lon: 135.8686 },
  { code: '26', name: '京都府', lat: 35.0212, lon: 135.7556 },
  { code: '27', name: '大阪府', lat: 34.6863, lon: 135.52 },
  { code: '28', name: '兵庫県', lat: 34.6913, lon: 135.183 },
  { code: '29', name: '奈良県', lat: 34.6851, lon: 135.8329 },
  { code: '30', name: '和歌山県', lat: 34.226, lon: 135.1675 },
  { code: '31', name: '鳥取県', lat: 35.5039, lon: 134.2383 },
  { code: '32', name: '島根県', lat: 35.4723, lon: 133.0505 },
  { code: '33', name: '岡山県', lat: 34.6618, lon: 133.9344 },
  { code: '34', name: '広島県', lat: 34.3966, lon: 132.4596 },
  { code: '35', name: '山口県', lat: 34.1861, lon: 131.4705 },
  { code: '36', name: '徳島県', lat: 34.0658, lon: 134.5593 },
  { code: '37', name: '香川県', lat: 34.3401, lon: 134.0434 },
  { code: '38', name: '愛媛県', lat: 33.8417, lon: 132.7657 },
  { code: '39', name: '高知県', lat: 33.5597, lon: 133.5311 },
  { code: '40', name: '福岡県', lat: 33.6064, lon: 130.4181 },
  { code: '41', name: '佐賀県', lat: 33.2494, lon: 130.2988 },
  { code: '42', name: '長崎県', lat: 32.7448, lon: 129.8737 },
  { code: '43', name: '熊本県', lat: 32.7898, lon: 130.7417 },
  { code: '44', name: '大分県', lat: 33.2382, lon: 131.6126 },
  { code: '45', name: '宮崎県', lat: 31.9111, lon: 131.4239 },
  { code: '46', name: '鹿児島県', lat: 31.5602, lon: 130.5581 },
  { code: '47', name: '沖縄県', lat: 26.2124, lon: 127.6809 },
];
