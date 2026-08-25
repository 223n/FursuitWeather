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
| `suddenHeat` | object・null | 急な暑さ（暑熱順化前）の注意。初日の最高気温が直近7日の平均最高気温を5℃以上上回り、かつ最高気温25℃以上のときに`date`（対象日）・`recentAverageMax`（直近平均、℃・小数1桁）・`targetMax`（対象日の最高気温、℃）を返す。該当しない・過去データが5日分未満で判定できないときは`null` |
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
| `sunrise`・`sunset` | string・null | 日の出・日の入り時刻（`HH:mm`）。上流が提供しない場合・欠測時は`null` |
| `outdoorWorst`・`outdoorBest` | object | 日中（9〜18時）の最も厳しい／穏やかな屋外判定（`level`・`label`・`grade`） |
| `recommendedHours` | string[] | 屋外活動に適した時間帯（`HH:00`形式）。日中（9〜18時）のうち深刻度1以下かつ降水量0の時間帯が対象 |
| `coolingRequired` | boolean | 日中に冷房必須となる時間があるか |
| `maxWbgt` | number | その日の素のWBGT（着衣補正前）の最大値（℃）。33以上は環境省の熱中症警戒アラートの発表基準に相当 |
| `maxWindSpeed` | number | その日の最大風速（m/s、1時間平均の最大。全時間帯から取る）。10以上は気象庁の「やや強い風」に相当し、瞬間風速は平均の1.5〜3倍程度になることがある |
| `laundry` | object | 洗濯乾燥判定（下記） |
| `staticElectricity` | object | 静電気の起きやすさ（`level`: `low`／`medium`／`high`、`label`: 低／中／高、`advice`: 「高」の日の対策の一言・それ以外は`null`）。日中の各時間の湿度・気温を個別に判定し最も厳しいレベルを採用。湿度25%未満で「高」、湿度40%未満かつ気温20℃未満で「中」（帯電対策の一般的な目安に基づく生活指数） |
| `airQuality` | object・null | 空気のよごれ（黄砂・PM2.5。`level`: `low`／`medium`／`high`、`label`: 低／中／高、`pm25Mean`: PM2.5の日平均μg/m³、`dustMax`: 黄砂の最大濃度μg/m³、`advice`: 「高」の日の注意・それ以外は`null`）。PM2.5の日平均35μg/m³以上または黄砂100μg/m³以上で「中」、PM2.5の日平均70μg/m³以上または黄砂500μg/m³以上で「高」。Open-Meteo Air Quality API（CAMS全球モデル）の推定値に基づく目安で、取得失敗・欠測時は`null`（ベストエフォート。本体の応答は巻き込まない） |

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

## GET /api/events.ics

登録済みイベント（`public/events.json`。トップページのイベントタブと同じ一覧）を
iCalendar（RFC 5545）形式で返します。カレンダーアプリへの取り込み用です。

- パラメータはありません。`Content-Type: text/calendar; charset=utf-8`と
  取り込み用の`Content-Disposition`（ファイル名`fursuit-weather-events.ics`）が
  付きます
- 掲載対象はトップページの一覧と同じ基準です（形式が不正な項目は除外し、
  終了済みイベントは載せません）
- 単日開催で開始・終了時刻が揃っているイベントは時刻付きの予定
  （UTC表記。JSTから変換）、複数日開催・時刻未定義は終日予定になります
- 各予定の`DESCRIPTION`と`URL`に開催地の予報リンク（`/?event=イベント名`）を
  含めます。取り込んだ予定は自動更新されないため、最新のイベント一覧と予報は
  サイト側が正です（予定内にもその旨を記載しています）
- 通知（VALARM）は含めません
- キャッシュはブラウザ10分（`/api/forecast`と同じ`max-age`）です

## GET /api/badge.svg

当日（日本時間）の最も厳しい屋外判定を、告知ページなどに`<img>`1行で
貼れるSVGバッジ（「着ぐるみ判定 | ✕ 厳重警戒」のような2セグメント表示）で
返します。判定を色だけに依存させない方針（記号+文字併記・CUD配色）は
埋め込み先でも維持されます。

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| `city` | どちらか一方 | 主要12都市名（トップページの地点セレクトと同じ。例: `東京`） |
| `event` | どちらか一方 | `events.json`に登録済みのイベント名（開催地を郵便番号から解決） |
| `demo` | 任意 | `1`で上流を呼ばずデモデータで応答（表示確認用。`city`・`event`は不要） |

```html
<img src="https://fursuit-weather.223n.tech/api/badge.svg?city=東京"
     alt="東京の本日の着ぐるみ判定" width="216" height="24">
```

- 受け付ける地点は**主要12都市と登録済みイベントの開催地に限定**しています。
  埋め込みは第三者サイトの閲覧ごとに自動でリクエストが発生するため、
  任意座標を受けるとデータ提供元（Open-Meteo）の無料枠を第三者が
  圧迫できてしまうことへの対策です
- 未知の都市名は400、未登録のイベント名・開催地を解決できない場合は404を
  返します
- 暑熱の「危険」判定では「着用中止」を文字で明示します
- レスポンスには`Content-Security-Policy`とキャッシュ（ブラウザ10分）が
  付きます。判定の更新もこの周期です

## GET /api/alert

環境省の熱中症警戒アラート発表状況CSV（電子情報提供サービス。例年おおむね
4月下旬〜10月下旬提供・毎日5時/17時発表）をWorkerが取得し、**表示地点の
最寄りの都道府県**（都道府県庁所在地の代表点で判定）の**当日**の発表状況を
返します。トップページの注意事項欄の「環境省発表」の赤帯が使用します。

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| `lat` | 必須 | 緯度（`-90`〜`90`） |
| `lon` | 必須 | 経度（`-180`〜`180`） |
| `demo` | 任意 | `1`で上流を呼ばず固定の発表例を返す（表示の死活確認用） |

```json
{ "alert": { "prefectureName": "東京都", "special": false, "targetDate": "2026-08-25" } }
```

- 発表がないとき・取得に失敗したとき・提供期間外（ファイルなし）・当日5時の
  発表前・CSVの対象日が当日と一致しないときは、すべて`{ "alert": null }`を
  200で返します（本体の予報表示を巻き込まないベストエフォート。様式変更などの
  異常はWorkerのログで検知します）
- `special`は熱中症特別警戒アラート（警戒より深刻な段階。CSVのフラグ2・3）です
- 県境付近では隣県に判定されることがあるため、画面表示には必ず都道府県名を
  併記しています
- 上流CSVはエッジで30分キャッシュされ、レスポンスにはブラウザキャッシュ
  （10分）が付きます

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
