# このサービスについて（FursuitWeather）

> FursuitWeather（着ぐるみ天気予報）の「このサービスについて」ページのMarkdown版です。
> HTML版: <https://fursuit-weather.223n.tech/about>

判定の仕組み、会場表示モード、使い方、この端末に保存されるもの、API、エッジ配信とキャッシュ、免責事項、データ出典をまとめています。

## 判定の仕組み

### 暑さ指数（WBGT）と着ぐるみ補正

環境省の熱中症予防情報サイトと同じ推定式（小野ら2014）で暑さ指数（WBGT）を計算しています。

```text
WBGT = 0.735×Ta + 0.0374×RH + 0.00292×Ta×RH
+ 7.619×SR − 4.557×SR² − 0.0572×WS − 4.064

Ta: 気温（℃）  RH: 相対湿度（%）
SR: 全天日射量（kW/m²）  WS: 風速（m/s）
```

着ぐるみの熱負荷は、厚生労働省「職場における熱中症予防基本対策要綱」のWBGT着衣補正値（フード付き蒸気不透過つなぎ服 = **+11℃**）で補正し、環境省の5段階（21・25・28・31℃）で判定します。

| 補正後WBGT | 判定 | 連続活動時間の上限目安 |
|---|---|---|
| 21℃未満 | ◎ほぼ安全 | ◎45分 |
| 21〜25℃ | ○注意 | ○30分 |
| 25〜28℃ | △警戒 | △20分 |
| 28〜31℃ | ✕厳重警戒 | ✕10分 |
| 31℃以上 | 危険 | 中止 |

連続活動時間は、次のような自治体の着ぐるみ運用マニュアル（1回30分以内、夏季は10〜20分）やイベントガイドなど（30〜45分で休憩）を参考に段階化した上限の目安です。基本は「30分着たら30分休む」を推奨します。

- [さいたま市「着ぐるみ使用マニュアル」（PDF）](https://www.city.saitama.lg.jp/006/012/001/004/004/p010212_d/fil/kigurumi-m.pdf)
- [三原市「公式マスコットキャラクター使用に関するマニュアル」（PDF）](https://www.city.mihara.hiroshima.jp/uploaded/life/150268_522697_misc.pdf)
- [Anthrocon「Fursuiting in the Summer」](https://www.anthrocon.org/guides/fursuiting-in-the-summer/)
- [Melbourne Fur Con「Fursuiting Guidelines」](https://melbfurcon.com/fursuiting-guidelines/)

### 実測WBGTから判定

会場でWBGT計（暑さ指数計）で測った値からの判定は、トップページの[「実測WBGT」タブ](https://fursuit-weather.223n.tech/#tab-measured)で確認できます。実測値に着衣補正を加えて、上の対応表と同じ基準で判定します。

### 低温側の判定

気温15℃未満では体感温度による低温判定（0・−10・−20℃境界）を併用し、汗冷え・凍結路面・凍傷などの注意を表示します。着ぐるみは低温でも発熱するため、暑熱判定と低温判定の深刻な方を採用します。

### 屋内判定と冷房要否

屋内は日射なし・微風（空調のない会場で室温が外気温と同程度になる場合）を想定した参考値です。着ぐるみ補正後のWBGTが25℃以上で✕冷房必須、21℃以上で○冷房推奨と判定します。

### 洗濯乾燥指数

Tetensの式による飽和水蒸気圧から飽差（VPD: 空気の乾きやすさ）を求め、風速関数を掛けた乾燥スピードを干し時間帯（9〜15時）で積算して0〜100に指数化します。降水時は✕外干しNG（雨）、平均気温5℃未満は✕乾きにくい（低温）となります。

かんたんに言うと: Tetensの式は「気温から、空気が抱えられる水蒸気の上限を求める式」です。空気は温かいほど多くの水蒸気を抱えられ、10℃上がると上限はほぼ2倍になります。上限までの残り（飽差）が大きいほど、洗濯物の水分が空気へ移りやすくなります。つまり「気温が高く、湿度が低く、風がある日ほどよく乾く」という経験則を、そのまま計算式にしたものです。

着ぐるみの全身洗いは扇風機併用で24〜48時間の乾燥目安を表示し、乾きにくい日はカビ警告を出します。乾燥機は熱でファーが傷むため使用禁止です。

## 会場表示モード

イベント会場のモニターへ掲示するための自動表示ページを用意しています。トップページで会場の地点を表示し、「会場表示モードで開く」から利用してください。いまの判定・この後の予報・3日間の天気・全国の天気を自動で切り替えながら、予報を定期的に更新し続けます（掲示中の操作は不要です）。

設営前のチェック（端末の時刻合わせ・初回は必ずオンラインで開く・`?demo=1`でのリハーサルなど）と設置手順の詳細は、GitHubリポジトリの[会場表示モードの使い方（docs/display.md）](https://github.com/223n/FursuitWeather/blob/main/docs/display.md)を参照してください。

## 使い方

### しばらく着ていない人へ（暑熱順化について）

体が暑さに慣れる「暑熱順化」は、7日以上かけて暑さにさらされる時間を少しずつ延ばすことで得られ、おおむね4日以上暑さから離れると失われ始めます（厚生労働省「職場における熱中症予防基本対策要綱」より）。シーズン最初のイベントや数週間ぶりの活動では、真夏と同じ感覚で着ると熱中症のリスクが高くなります。

再開の初日は計画の目安のおよそ半分から始め、数回かけて段階的に延ばすのが安全です（米国の労働安全衛生機関（NIOSH/OSHA）の再順化スケジュール（初日は通常の50%から漸増）に基づく目安です）。

トップページの[「活動プランナー」タブ](https://fursuit-weather.223n.tech/#tab-planner)では、暑さのリスクがある計画にこの慣らしの注意を表示します。

### イベント予報（主催者の方へ）

トップページの[地点選択の「イベント」タブ](https://fursuit-weather.223n.tech/#picker-tabs)から、掲載されているイベントの開催地の予報を表示できます。イベントを選ぶと次の機能が使えます。

- **固定リンクをコピー**: 開くと、そのイベントの予報が表示されるURLです。告知ページやSNSへの掲載にお使いください。
- **カレンダーに登録**: 掲載中のイベントをiCalendar形式（.icsファイル）で取り込めます。全件のほか、選択中のイベントだけの登録もできます。
- **判定バッジ**: 告知ページに当日の判定を貼れるSVG画像です（使い方は[GET /api/badge.svg（判定バッジ）](https://fursuit-weather.223n.tech/about#badge)）。

開催日時・会場などの詳細は主催者の告知をご確認ください。イベントの掲載を希望する主催者の方は、[GitHubリポジトリのissue（イベント掲載依頼フォーム）](https://github.com/223n/FursuitWeather/issues/new?template=event_request.yml)からご連絡ください。

### ホーム画面に追加して毎日見る

このサイトはWebアプリとしてホーム画面に追加できます。追加すると、ブラウザのタブを探さずに1タップで開けます。追加の手順は環境ごとに異なるため、トップページの[「この予報について」](https://fursuit-weather.223n.tech/#about-heading)にある「ホーム画面に追加して毎日見る（かんたん案内）」で、お使いの環境に合った案内を表示します。

## この端末に保存されるもの

このサイトは、利用者の識別や行動の追跡をしません。次のものは**お使いの端末の中だけ**に保存され、サーバーへは送られません（ブラウザの設定でサイトデータを消すと、あわせて消えます）。

- 最後に表示していた地点（名前と座標）と、お気に入りに登録した地点
- 着用タイマーの開始時刻・休憩の状態（リロードやスリープ復帰後も続けるため）
- 着用記録（最新20件）と、当日ボードに登録した着用者の名前・状態
- 実測WBGTの会場ログ（最大200件）
- 前回表示した日別の判定（最大10日分。次に開いたとき「前回から変わった点」を出すため）
- 持ち物リストのチェック状態と、自分で追加した持ち物
- 見やすさ設定（文字サイズ・配色）と、会場表示モードで選んだスライドの設定

**現在地（GPS）の座標は保存しません。**「現在地から」を押したときに取得した座標は、その場で小数第2位（約1km四方）へ丸めて予報の取得だけに使い、端末にもURLにも残しません。共有リンクに含まれる座標も同じ精度に丸めたものです。

コンディションチェックの回答は、答えた直後の助言を出すためだけに使い、端末にもサーバーにも保存しません。アクセス解析にはCookieを使わないCloudflare Web Analyticsを利用しています（個人を識別する情報は収集しません）。

## API

予報データはJSON APIとして公開しています。CORS対応のため、ほかのサイトやアプリからも利用できます。

### GET /api/forecast

| パラメータ | 必須 | 説明 |
|---|---|---|
| `lat` | 必須 | 緯度（`-90`〜`90`） |
| `lon` | 必須 | 経度（`-180`〜`180`） |
| `days` | 任意 | 予報日数（`1`〜`4`、デフォルト`4`） |
| `demo` | 任意 | `1`でデモデータを返す |

リクエスト例:

```bash
curl "https://fursuit-weather.223n.tech/api/forecast?lat=35.6785&lon=139.6823"
```

### レスポンスJSONの仕様

レスポンスのトップレベルは以下のフィールドで構成されます。

表内の要素名の区切りは、並列のフィールドを「・」、いずれか1つを取る値を「／」で表記しています。

| フィールド | 型 | 説明 |
|---|---|---|
| `location` | object | 予報地点（`latitude`・`longitude`・`timezone`）。気象モデルの格子点に丸められた座標 |
| `generatedAt` | string | レスポンス生成時刻（ISO 8601・UTC、例: `2026-08-15T09:00:00.000Z`） |
| `model` | string | 使用した気象モデル（通常は`jma_seamless（気象庁MSM/GSM）`、デモ時は`demo`） |
| `attribution` | object | データ出典表記（`weatherData`・`weatherDataUrl`・`license`）。表示時は出典の明記が必要 |
| `notices` | string[] | 通年の注意事項（活動時の安全に関する文言） |
| `suddenHeat` | object・null | 急な暑さ（暑熱順化前）の注意。初日の最高気温が直近7日の平均最高気温を5℃以上上回り、かつ25℃以上のときに`date`（対象日）・`recentAverageMax`（直近平均、℃）・`targetMax`（対象日の最高気温、℃）を返す。該当しない・過去データ不足のときは`null` |
| `hours` | array | 1時間ごとの予報（下表） |
| `days` | array | 日別サマリー（下表） |

`hours[]`の各要素:

| フィールド | 型 | 説明 |
|---|---|---|
| `time` | string | ローカル時刻（Asia/Tokyo、例: `2026-08-15T09:00`） |
| `weather` | object | 気象値: `temperature`（℃）、`humidity`（%）、`apparentTemperature`（℃）、`precipitation`（mm）、`precipitationProbability`（%。気象庁モデルにないためOpen-Meteo標準予報APIから補完。取得できない場合・欠測時は`null`）、`weatherCode`（WMOコード。欠測時は`-1`）、`solarRadiation`（W/m²）、`windSpeed`（m/s） |
| `weatherLabel` | string | 天気の日本語ラベル（晴れ・曇りなど） |
| `outdoor` | object | 屋外の着ぐるみ判定（下記の判定オブジェクト） |
| `indoor` | object | 屋内の判定。判定オブジェクトに`cooling`（`none`／`recommended`／`required`）と`coolingLabel`が加わる |

判定オブジェクト（`outdoor`・`indoor`共通）:

| フィールド | 型 | 説明 |
|---|---|---|
| `wbgt` | number | 素のWBGT推定値（℃） |
| `suitWbgt` | number | 着ぐるみ着衣補正（+11℃）後のWBGT（℃） |
| `level` | string | レベルID: 暑熱側: `safe`／`caution`／`warning`／`severe`／`danger`、低温側: `optimal`／`coldCaution`／`coldWarning`／`coldDanger` |
| `label` | string | 日本語ラベル（ほぼ安全・注意など） |
| `grade` | number | 深刻度（0=快適〜4=危険）。色分け用 |
| `activityMinutes` | number | 連続活動時間の上限目安（分、0は着用中止） |
| `advice` | string | 注意文 |

`days[]`の各要素:

| フィールド | 型 | 説明 |
|---|---|---|
| `date` | string | 日付（YYYY-MM-DD） |
| `temperatureMin`・`temperatureMax` | number | 最低・最高気温（℃） |
| `weatherCode`・`weatherLabel` | number・string | 日中の代表天気 |
| `sunrise`・`sunset` | string・null | 日の出・日の入り時刻（`HH:mm`）。上流が提供しない場合・欠測時は`null` |
| `outdoorWorst`・`outdoorBest` | object | 日中（9〜18時）の最も厳しい・最も穏やかな屋外判定（`level`・`label`・`grade`） |
| `recommendedHours` | string[] | 屋外活動に適した時間帯（`HH:00`形式）。深刻度1以下かつ降水なしの時間帯が対象 |
| `coolingRequired` | boolean | 日中に冷房必須となる時間があるか |
| `maxWbgt` | number | その日の素のWBGT（着衣補正前）の最大値（℃）。33以上は環境省の熱中症警戒アラートの発表基準に相当 |
| `maxWindSpeed` | number | その日の最大風速（m/s、1時間平均の最大）。10以上は気象庁の「やや強い風」に相当 |
| `laundry` | object | 洗濯乾燥判定: `score`（`0`〜`100`）、`level`（`noDryRain`／`noDryCold`／`indoorDry`／`fair`／`good`／`veryGood`／`excellent`）、`label`、`fursuitDryingHours`（時間）、`moldWarning`（boolean）、`advice` |
| `staticElectricity` | object | 静電気の起きやすさ（`level`: `low`／`medium`／`high`、`label`: 低／中／高、`advice`: 「高」の日の対策の一言・それ以外は`null`）。日中の各時間の湿度・気温を個別に判定し最も厳しいレベルを採用（湿度25%未満で「高」、湿度40%未満かつ気温20℃未満で「中」）。帯電対策の一般的な目安に基づく生活指数です |
| `airQuality` | object・null | 空気のよごれ（黄砂・PM2.5。`level`: `low`／`medium`／`high`、`label`: 低／中／高、`pm25Mean`: PM2.5の日平均μg/m³、`dustMax`: 黄砂の最大濃度μg/m³、`advice`: 「高」の日の注意・それ以外は`null`）。PM2.5の日平均35μg/m³以上または黄砂100μg/m³以上で「中」、PM2.5の日平均70μg/m³以上または黄砂500μg/m³以上で「高」。Open-Meteo Air Quality API（CAMS全球モデル）の推定値に基づく目安で、公式の観測・注意報ではありません。取得できない日は`null` |

レスポンス例（一部のフィールドと配列要素は省略しています。そのまま整形ツールへ貼り付けられる有効なJSONです）:

```json
{
  "location": {
    "latitude": 35.7,
    "longitude": 139.6875,
    "timezone": "Asia/Tokyo"
  },
  "generatedAt": "2026-08-15T09:00:00.000Z",
  "model": "jma_seamless（気象庁MSM/GSM）",
  "attribution": {
    "weatherData": "Weather data by Open-Meteo.com（気象庁MSM/GSMモデル）"
  },
  "notices": [
    "着ぐるみ内は冬でも数分で発汗する高温多湿環境です。季節を問わず熱中症対策が必要です。"
  ],
  "hours": [
    {
      "time": "2026-08-15T09:00",
      "weather": {
        "temperature": 28.1,
        "humidity": 54,
        "windSpeed": 2.5
      },
      "weatherLabel": "晴れ",
      "outdoor": {
        "wbgt": 25.8,
        "suitWbgt": 36.8,
        "level": "danger",
        "label": "危険",
        "grade": 4,
        "activityMinutes": 0
      },
      "indoor": {
        "wbgt": 23.9,
        "suitWbgt": 34.9,
        "level": "danger",
        "grade": 4,
        "cooling": "required",
        "coolingLabel": "冷房必須"
      }
    }
  ],
  "days": [
    {
      "date": "2026-08-15",
      "temperatureMin": 18.3,
      "temperatureMax": 34.0,
      "weatherLabel": "晴れ",
      "outdoorWorst": {
        "level": "danger",
        "label": "危険",
        "grade": 4
      },
      "recommendedHours": [],
      "coolingRequired": true,
      "laundry": {
        "score": 100,
        "level": "excellent",
        "label": "大変よく乾く",
        "fursuitDryingHours": 24,
        "moldWarning": false
      }
    }
  ]
}
```

### GET /api/badge.svg（判定バッジ）

当日（日本時間）の最も厳しい屋外判定を、イベントの告知ページなどに貼れるSVGバッジで返します。地点は主要12都市名（`city`。トップページの地点セレクトと同じ名前）か、登録済みイベント名（`event`。開催地の判定になります）のどちらか一方で指定します。バッジはブラウザで10分キャッシュされ、判定の更新もこの周期です。

貼り付け例（都市名で指定）:

```html
<img src="https://fursuit-weather.223n.tech/api/badge.svg?city=東京"
     alt="東京の本日の着ぐるみ判定" width="216" height="24">
```

貼り付け例（イベント名で指定。開催地の判定になります）:

```html
<img src="https://fursuit-weather.223n.tech/api/badge.svg?event=けもケット17"
     alt="けもケット17開催地の本日の着ぐるみ判定" width="216" height="24">
```

イベント名で指定したバッジは、イベントが定義（events.json）から削除されると表示されなくなります（画像が壊れて見えます）。イベント終了後は告知ページのバッジも合わせて外してください。表示の確認には`?demo=1`（上流を呼ばない固定の見本）も使えます。

### 利用上の注意

- 予報日数の上限は4日です（気象庁MSMの予報範囲。それ以降は日射量データがなくWBGTを計算できないため）
- 気象データはエッジで30分キャッシュされます（詳細は次のセクション）
- 大量アクセスはデータ提供元（Open-Meteo）の無料枠を圧迫するためお控えください
- フィールドの追加は後方互換として予告なく行うことがあります。未知のフィールドは無視してください

このページで紹介しているのは主要な2エンドポイントです。全7エンドポイント（`/api/forecast`・`/api/geocode`・`/api/national`・`/api/events.ics`・`/api/badge.svg`・`/api/alert`・`/api/levels`）の完全な仕様は、GitHubリポジトリの[API仕様（docs/api.md）](https://github.com/223n/FursuitWeather/blob/main/docs/api.md)を参照してください（機械可読な[OpenAPI定義](https://github.com/223n/FursuitWeather/blob/main/docs/openapi.yaml)もあります）。

## エッジ配信とキャッシュ

本サービスはCloudflare Workersで動作しており、世界中に分散したCloudflareのデータセンター網（**エッジ**）のうち、利用者に最も近い拠点でプログラムが実行されます。特定のサーバー1台に集中しないため、高速で障害にも強い構成です。

予報データは2段階でキャッシュされます。

### (1) エッジでの気象データキャッシュ（30分）

WorkerがOpen-Meteoから取得した気象データは、そのデータセンター内に30分保存されます。同じ地点・同じ日数のリクエストが30分以内に来た場合、Open-Meteoへは問い合わせず保存済みのコピーから即座に応答します。これにより、データ提供元の無料枠（1日1万コール）を守りながら応答を高速化しています。キャッシュはURL単位・データセンター単位で独立しており、地点（座標）が異なれば別のキャッシュになります。

### (2) ブラウザキャッシュ（10分）

APIレスポンスには`Cache-Control: public, max-age=600`を付けているため、同じブラウザからの再リクエストは10分間キャッシュが再利用されます。「予報を更新」を押しても10分以内は同じ内容が表示されることがあります。

### データの鮮度について

表示される予報は最大で約40分前（エッジ30分+ブラウザ10分）に取得されたものの可能性があります。元データの気象庁MSMの更新は3時間ごとのため、実用上の鮮度への影響はありません。キャッシュされるのは公開の気象データのみで、現在地の座標などがほかの利用者と共有されることはありません。

## 免責事項

- 本予報は目安であり、安全を保証するものではありません。医学的な助言に代わるものでもありません。
- 体調・装備・活動内容により安全な活動時間は変わります。最終判断はご自身で行ってください。
- 着ぐるみ活動は必ず2人以上で行い、着用者以外の付き添い（ハンドラー・アテンド）を付けてください。吐き気・めまい・頭痛などの体調の変化を感じたら直ちに中止してください。
- 予報データは数値予報モデルによる推定値であり、実際の気象と異なる場合があります。
- 本サービスの利用により生じたいかなる損害についても、開発者は責任を負いません。
- 本サービスは予告なく変更・停止することがあります。

## データ出典・ライセンス

- 気象データ: [Weather data by Open-Meteo.com](https://open-meteo.com/)（CC BY 4.0、気象庁MSM/GSMモデル由来、非商用利用）
- WBGT推定式: [環境省熱中症予防情報サイト](https://www.wbgt.env.go.jp/)（小野ら2014）
- 着衣補正値: 厚生労働省「職場における熱中症予防基本対策要綱」（ISO 7243:2017準拠）
- アイコン: [Font Awesome Free](https://fontawesome.com/)（CC BY 4.0）
- ソースコード: [GitHub: 223n/FursuitWeather](https://github.com/223n/FursuitWeather)（Apache License 2.0）
