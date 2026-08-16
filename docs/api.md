# API仕様

予報データはJSON APIとして公開しています。CORS対応のため、
ほかのサイトやアプリからも利用できます。

要素名の区切りは、並列のフィールドを「・」、いずれか1つを取る値を
「／」で表記しています。

## GET /api/forecast

| パラメータ | 必須 | 説明 |
|-----------|------|--------------------------------|
| `lat` | 必須 | 緯度（`-90`〜`90`） |
| `lon` | 必須 | 経度（`-180`〜`180`） |
| `days` | 任意 | 予報日数（`1`〜`4`、デフォルト`4`） |
| `demo` | 任意 | `1`でデモデータを返す |

予報日数の上限は4日です（気象庁MSMの予報範囲。それ以降は日射量データが
なくWBGTを計算できないため）。

リクエスト例:

```bash
curl "https://fursuit-weather.223n.tech/api/forecast?lat=35.6785&lon=139.6823"
```

## レスポンスJSONの仕様

### トップレベル

| フィールド | 型 | 説明 |
|--------------|----------|------------------------------------------|
| `location` | object | 予報地点（`latitude`・`longitude`・`timezone`）。気象モデルの格子点に丸められた座標 |
| `generatedAt` | string | レスポンス生成時刻（ISO 8601・UTC、例: `2026-08-15T09:00:00.000Z`） |
| `model` | string | 使用した気象モデル（通常は`jma_seamless（気象庁MSM/GSM）`、デモ時は`demo`） |
| `attribution` | object | データ出典表記（`weatherData`・`weatherDataUrl`・`license`）。表示時は出典の明記が必要 |
| `notices` | string[] | 通年の注意事項 |
| `hours` | array | 1時間ごとの予報 |
| `days` | array | 日別サマリー |

### hours[]の各要素

| フィールド | 型 | 説明 |
|--------------|----------|------------------------------------------|
| `time` | string | ローカル時刻（Asia/Tokyo、例: `2026-08-15T09:00`） |
| `weather` | object | 気象値（下記） |
| `weatherLabel` | string | 天気の日本語ラベル（晴れ・曇りなど） |
| `outdoor` | object | 屋外の着ぐるみ判定（判定オブジェクト） |
| `indoor` | object | 屋内の判定。判定オブジェクトに`cooling`（`none`／`recommended`／`required`）と`coolingLabel`が加わる |

`weather` は次のフィールドを持ちます。

- `temperature`（℃）
- `humidity`（%）
- `apparentTemperature`（℃）
- `precipitation`（mm）
- `precipitationProbability`（%。気象庁モデルにないためOpen-Meteo標準
  予報APIから補完。取得できない場合・欠測時は`null`）
- `weatherCode`（WMOコード。欠測時は`-1`）
- `solarRadiation`（W/m²）
- `windSpeed`（m/s）

### 判定オブジェクト（outdoor・indoor共通）

| フィールド | 型 | 説明 |
|--------------|----------|------------------------------------------|
| `wbgt` | number | 素のWBGT推定値（℃） |
| `suitWbgt` | number | 着ぐるみ着衣補正（+11℃）後のWBGT（℃） |
| `level` | string | レベルID（下記） |
| `label` | string | 日本語ラベル（ほぼ安全・注意など） |
| `grade` | number | 深刻度（0=快適〜4=危険）。色分け用 |
| `activityMinutes` | number | 連続活動時間の上限目安（分、`0`は着用中止） |
| `advice` | string | 注意文 |

`level` の値は次のとおりです。

- 暑熱側: `safe`／`caution`／`warning`／`severe`／`danger`
- 低温側: `optimal`／`coldCaution`／`coldWarning`／`coldDanger`

低温側の値が現れるのは`outdoor`（および`outdoorWorst`／`outdoorBest`）
のみです。`indoor`の`level`は暑熱側の値のみ返します。

### days[]の各要素

| フィールド | 型 | 説明 |
|--------------|----------|------------------------------------------|
| `date` | string | 日付（YYYY-MM-DD） |
| `temperatureMin`・`temperatureMax` | number | 最低・最高気温（℃） |
| `weatherCode`・`weatherLabel` | number・string | 日中の代表天気 |
| `outdoorWorst`・`outdoorBest` | object | 日中（9〜18時）の最も厳しい／穏やかな屋外判定（`level`・`label`・`grade`） |
| `recommendedHours` | string[] | 屋外活動に適した時間帯（`HH:00`形式）。深刻度1以下かつ降水なしの時間帯が対象 |
| `coolingRequired` | boolean | 日中に冷房必須となる時間があるか |
| `laundry` | object | 洗濯乾燥判定（下記） |

`laundry` は次のフィールドを持ちます。

- `score`（`0`〜`100`）
- `level`（`noDryRain`／`noDryCold`／`indoorDry`／`fair`／`good`／`veryGood`／`excellent`）
- `label`
- `fursuitDryingHours`（時間）
- `moldWarning`（boolean）
- `advice`

## GET /api/geocode

都市名または郵便番号から地点候補を検索します。
フロントエンドの地点検索が使用する補助APIで、Open-Meteoの
ジオコーディングAPIへWorkerが代理で問い合わせます。

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| `q` | 必須 | 都市名または郵便番号（100文字以内。例: `松山`、`790-0067`） |

レスポンスは次の形式です。候補は日本国内のみ、最大5件です。
該当がない場合は空配列を返します。

```json
{
  "results": [
    {
      "name": "松山",
      "admin1": "愛媛県",
      "latitude": 33.8392,
      "longitude": 132.7658
    }
  ]
}
```

地名データはほぼ変化しないため、レスポンスはエッジで7日間
キャッシュされます。

## 利用上の注意

- 気象データはエッジで30分キャッシュされます
  （詳細は[アーキテクチャ](architecture.md)を参照）
- 大量アクセスはデータ提供元（Open-Meteo）の無料枠を圧迫するため
  お控えください
- フィールドの追加は後方互換として予告なく行うことがあります。
  未知のフィールドは無視してください

レスポンス例を含む利用者向けの説明は
[公開サイトの説明ページ](https://fursuit-weather.223n.tech/about)にも
記載しています。
