# FursuitWeather

[![CI](https://github.com/223n/FursuitWeather/actions/workflows/ci.yml/badge.svg)](https://github.com/223n/FursuitWeather/actions/workflows/ci.yml)
[![Deploy](https://github.com/223n/FursuitWeather/actions/workflows/deploy.yml/badge.svg)](https://github.com/223n/FursuitWeather/actions/workflows/deploy.yml)

着ぐるみ天気予報 - 気象データから着ぐるみ（fursuit）で活動するのに
適切かどうかを予報するWebサービスです。

公開URL: <https://fursuit-weather.223n.tech/>

## 概要

気象庁MSM/GSMモデル由来の気象データ（気温・湿度・日射量・風速・
降水量など）をもとに、以下を予報します。

- **屋外活動指数**: 暑さ指数（WBGT）ベースの5段階判定
- **屋内活動指数**: 空調のない会場を想定した参考値と冷房要否（冷房必須/推奨/不要）
- **活動可能時間**: 1回あたりの連続活動時間の目安（45/30/20/10分/着用中止）
- **洗濯乾燥指数**: 洗濯物の乾きやすさ5段階と、着ぐるみ全身洗いの乾燥時間目安

判定は環境省の熱中症予防情報サイトと同じWBGT推定式（小野ら2014）に、
厚生労働省の着衣補正値（フード付き蒸気不透過つなぎ服 = +11℃）を加えて
行います。詳細は[判定ロジック](docs/logic.md)を参照してください。

## 主な機能

- **地点検索**: 都市名・郵便番号から地点を検索（郵便番号はzipcloudで
  住所へ変換。「蒲郡」のような短い地名は接尾辞を補って再検索）
- **現在地**: GPSで現在地の予報を表示。座標は約1kmに丸め、保存も
  URLへの反映もしない設計
- **地点の記憶**: 最後に表示した地点（現在地を除く）をブラウザ内にのみ
  保存し、次回のアクセス時に自動表示
- **予報の共有**: 表示中の地点の予報をURLで共有（座標は約1km精度）
- **イベント予報**: あらかじめ定義したイベント（`public/events.json`）を
  リストから選ぶと、郵便番号で引いた開催地の予報を表示。開催日が予報
  範囲内ならその日のタブへ自動で切り替え、開催時間は活動プランナーへ
  設定（[定義の書き方](docs/events.md)）
- **降水確率**: 時間別予報に降水確率を表示（Open-Meteo標準予報APIから補完）
- **実測WBGTツール**: WBGT計（暑さ指数計）の実測値から着ぐるみ判定を
  確認できる簡易ツール（トップページの「実測WBGT」タブ。判定の根拠と
  対応表は[説明ページ](https://fursuit-weather.223n.tech/about)に記載）

## クイックスタート

Node.js 22以上が必要です。

```bash
npm install
npm run dev
```

`http://localhost:8787` で動作確認できます。
気象APIに接続できない環境では `http://localhost:8787/?demo=1` で
デモデータの表示を確認できます。

```bash
npm test        # テスト（vitest）
npm run lint    # ESLint + tsc
```

## ドキュメント

開発ドキュメントは[docs/](docs/README.md)にあります。

| ドキュメント | 内容 |
|--------------|------|
| [判定ロジック](docs/logic.md) | WBGT・着衣補正・低温判定・冷房要否・洗濯乾燥指数の仕組みと根拠 |
| [API仕様](docs/api.md) | `GET /api/forecast`・`GET /api/geocode` のパラメータ・レスポンス・エラーの仕様 |
| [アーキテクチャ](docs/architecture.md) | システム構成、ソースコード構成、キャッシュ設計、エラー処理、プライバシー設計 |
| [開発ガイド](docs/development.md) | セットアップ、テスト、ビルド、CI/CD、カスタムドメイン |
| [アクセシビリティ設計](docs/accessibility.md) | 色覚多様性対応、スクリーンリーダー対応、キーボード操作、CLS対策 |
| [イベント予報の定義](docs/events.md) | `public/events.json`の書き方と画面での動き |
| [リリース手順](docs/release.md) | バージョニング方針、タグ作成、GitHubリリースの自動作成 |
| [参考資料・出典](docs/references.md) | 判定式・しきい値・データの出典と参考資料の一覧 |

利用者向けの説明（判定の仕組み・API・免責事項）は
[公開サイトの説明ページ](https://fursuit-weather.223n.tech/about)にも
あります。

## データ出典・利用条件

- 気象データ: [Weather data by Open-Meteo.com](https://open-meteo.com/)
  （CC BY 4.0、気象庁MSM/GSMモデル由来、非商用利用）
- WBGT推定式: [環境省 熱中症予防情報サイト](https://www.wbgt.env.go.jp/)
- 着衣補正値: 厚生労働省「職場における熱中症予防基本対策要綱」
- 郵便番号→住所変換: [zipcloud 郵便番号検索API](https://zipcloud.ibsnet.co.jp/doc/api)

そのほかの出典は[参考資料・出典](docs/references.md)を参照してください。

## 免責事項

本予報は目安であり、安全を保証するものではありません。
体調・装備・活動内容により安全な活動時間は変わります。
着ぐるみ活動は必ず2人以上で行い、体調の変化を感じたら直ちに中止してください。

## ライセンス

[Apache License 2.0](LICENSE)
