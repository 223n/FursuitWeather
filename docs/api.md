# API仕様

予報データはJSON APIとして公開しています。CORS対応のため、
ほかのサイトやアプリからも利用できます。
機械可読な仕様は[OpenAPI定義（openapi.yaml）](openapi.yaml)にもあります
（クライアント生成やAPIツールへの取り込みに使えます）。

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

`demo=1`のときは`lat`・`lon`・`days`を検証せず無視し、常に当日からの
2日分（真夏の晴天日と雨天日）の決定的なデモデータを返します。

正常レスポンスには`Cache-Control: public, max-age=600`が付き、
同じブラウザからの再リクエストは10分間キャッシュが再利用されます。

リクエスト例:

```bash
curl "https://fursuit-weather.223n.tech/api/forecast?lat=35.68&lon=139.68"
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

WBGT計算に必要な気象値（気温・湿度・体感温度・風速・日射量）が欠測の
時間は配列から除外されるため、`hours`は1時間ごとの連続を保証しません。
配列の添字を時刻とみなさず、`time`フィールドで突き合わせてください。

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
| `recommendedHours` | string[] | 屋外活動に適した時間帯（`HH:00`形式）。日中（9〜18時）のうち深刻度1以下かつ降水量0の時間帯が対象 |
| `coolingRequired` | boolean | 日中に冷房必須となる時間があるか |
| `maxWbgt` | number | その日の素のWBGT（着衣補正前）の最大値（℃）。33以上は環境省の熱中症警戒アラートの発表基準に相当 |
| `laundry` | object | 洗濯乾燥判定（下記） |

`laundry` は次のフィールドを持ちます。

- `score`（`0`〜`100`）
- `level`（`noDryRain`／`noDryCold`／`indoorDry`／`fair`／`good`／`veryGood`／`excellent`）
- `label`
- `fursuitDryingHours`（時間）
- `moldWarning`（boolean）
- `advice`

### レスポンス例（1時間分・1日分の抜粋）

```json
{
  "location": { "latitude": 35.68, "longitude": 139.69, "timezone": "Asia/Tokyo" },
  "model": "jma_seamless（気象庁MSM/GSM）",
  "hours": [
    {
      "time": "2026-08-15T09:00",
      "weather": { "temperature": 31.2, "humidity": 65, "precipitation": 0, "precipitationProbability": 10 },
      "weatherLabel": "晴れ",
      "outdoor": { "suitWbgt": 40.1, "level": "danger", "label": "危険", "grade": 4, "activityMinutes": 0 },
      "indoor": { "suitWbgt": 38.2, "cooling": "required", "coolingLabel": "冷房必須" }
    }
  ],
  "days": [
    {
      "date": "2026-08-15",
      "outdoorWorst": { "level": "danger", "label": "危険", "grade": 4 },
      "recommendedHours": [],
      "coolingRequired": true,
      "laundry": { "score": 88, "level": "excellent", "label": "大変よく乾く" }
    }
  ]
}
```

一部のフィールドは省略しています。実際のレスポンスは上記の
フィールド表のとおりです。

## GET /api/geocode

都市名または郵便番号から地点候補を検索します。
フロントエンドの地点検索が使用する補助APIで、Open-Meteoの
ジオコーディングAPIへWorkerが代理で問い合わせます。

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| `q` | 必須 | 都市名または郵便番号（100文字以内。例: `松山`、`790-0067`。郵便番号はハイフンなし・全角でも可） |

郵便番号はzipcloudで住所へ変換してから地名検索します。上流の地名データは
「大阪市北区」「伊都郡高野町」のような複合名を持たないため、政令市の区→市、
郡→町村、接尾辞なしの順に候補を短くしながら検索し、郵便番号の都道府県と
一致する候補を優先します（詳細は`src/weather/geocoding.ts`）。

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

2文字以下の地名で見つからない場合は「市」「町」「村」「区」を順に
補って再検索します（Open-Meteoジオコーディングは2文字以下の検索語を
完全一致でしか照合しないため、「蒲郡」のような短い表記への対策です。
3文字以上は部分一致が働くため補完しません）。
郵便番号はzipcloud（郵便番号検索API）で市区町村名へ変換してから
地名で検索します。変換に失敗した場合や変換後の地名で見つからない
場合は、郵便番号のままハイフンあり・なしの両形式で直接検索します。
地名・郵便番号データはほぼ変化しないため、
上流への問い合わせはエッジで7日間キャッシュされます。
一方、`/api/geocode`のレスポンス自体は`no-store`で返します
（検索ロジックの改善が全利用者へすぐ反映されるようにするためです）。

## GET /api/national

全国の主要12都市（トップページの地点セレクトと同じ一覧）の当日予報サマリーを
返します。会場表示モード（`/display`）の全国スライドが使用します。
Workerが12都市分の気象データを並列取得し、都市単位のベストエフォートで
まとめます（一部の都市が失敗しても残りの都市で応答し、失敗した都市は
`cities`に含まれません。全都市失敗のときだけ502を返します）。

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| `demo` | 任意 | `1`で上流を呼ばずデモデータで応答（表示確認用） |

レスポンスは次の形式です。`date`は日本時間の当日、`outdoorWorst`は
日中（9〜18時）の最も厳しい屋外判定です（形式は`days[]`の同名フィールドと
同じです）。キャッシュは`/api/forecast`と同じ設計です
（エッジ30分+ブラウザ10分）。

```json
{
  "generatedAt": "2026-08-19T12:00:00.000Z",
  "date": "2026-08-19",
  "model": "jma_seamless（気象庁MSM/GSM）",
  "attribution": { "...": "（/api/forecastと同じ）" },
  "cities": [
    {
      "name": "札幌",
      "latitude": 43.0618,
      "longitude": 141.3545,
      "weatherCode": 1,
      "weatherLabel": "晴れ",
      "temperatureMin": 22.1,
      "temperatureMax": 30.4,
      "outdoorWorst": { "level": "severe", "label": "厳重警戒", "grade": 3 }
    }
  ]
}
```

## エラーレスポンス

エラー時は両エンドポイント共通で、次の形式のJSONを返します。
エラーレスポンスには`Cache-Control: no-store`が付き、復旧後に古い
エラーがブラウザに残りません。CORSヘッダーは正常時と同じく付与されます。

```json
{
  "error": "気象データの取得に失敗しました。時間をおいて再度お試しください"
}
```

| ステータス | 発生条件 |
|-----------|----------|
| `400` | パラメータの検証エラー（`lat`／`lon`の欠落・範囲外、`days`が`1`〜`4`の整数でない、`q`の欠落・100文字超） |
| `404` | 未知の`/api/*`パス |
| `405` | GET・OPTIONS以外のメソッド |
| `500` | 予期しないサーバー内部エラー |
| `502` | 上流APIの障害・タイムアウト・レスポンス形式異常 |

OPTIONSプリフライトには`204`とCORSヘッダーを返します。

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
