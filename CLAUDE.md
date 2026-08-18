# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

内容を変えるときは`AGENTS.md`・`.github/copilot-instructions.md`も同期してください。

## プロジェクト概要

着ぐるみ天気予報（FursuitWeather）。Cloudflare Workers上で動作する日本語のWebサービスで、気象データから着ぐるみ活動の適否（WBGTベース）を予報する。UI文言・コメント・コミットメッセージ・ドキュメントはすべて日本語で書く。

## コマンド

```bash
npm run dev                          # wrangler dev（http://localhost:8787、?demo=1で上流なしのデモ表示）
npm test                             # vitest全件
npx vitest run test/geocode.test.ts  # 単一テストファイル
npx vitest run -t "テスト名の一部"    # テスト名で絞り込み
npm run lint                         # ESLint + tsc --noEmit
npm run test:coverage                # カバレッジ（しきい値未達で失敗）
npm run build                        # minify + CSSインライン化（下記の注意を必ず読むこと）
```

### npm run build の重要な注意

`npm run build`は`public/`のファイルを**破壊的に上書き**する（app.js・style.cssのminify、HTMLへのCSSインライン化）。必ず**コミット後**に実行し、検証が済んだら`git checkout -- public/`で復元する。未コミットの`public/`編集がある状態で実行すると編集が失われる。

## CIが強制する契約

- **カバレッジ100%**: statements・lines・functionsは100%が`vitest.config.ts`のしきい値でCI強制される。`src/`に新しいコードを書いたら必ずテストを追加する（`public/`のブラウザJSは対象外）
- **htmlSync同期テスト**（`test/htmlSync.test.ts`）: 文言・しきい値の複製箇所を`?raw`インポートで機械検証する。次を編集するときは両側を揃えないとテストが落ちる
  - `src/constants.ts` ↔ index.htmlの注意事項・判定凡例・about.htmlのしきい値表・テーブルcaption
  - `public/app.js`のCITIES配列 ↔ index.htmlの地点セレクト、preloadのURL
  - `public/wbgt-tool.js`の判定表（HEAT_BANDSの形式まで完全一致で検証される）
  - `docs/api.md`・`docs/logic.md`・`public/llms.txt`の数値記述
  - フッターのバージョン表記（3ページ） ↔ `package.json`のversion
- HTMLページを追加する場合、`<link rel="stylesheet" href="/style.css">`の完全一致タグがないとビルドが失敗する（`scripts/inline-css.mjs`の安全確認）

## アーキテクチャの要点

詳細は`docs/architecture.md`。以下は複数ファイルにまたがる不変条件。

### バックエンド（src/）

- 2層構成: 静的アセット（`public/`）+ Worker（`/api/*`のみ起動、`wrangler.jsonc`の`run_worker_first`）
- `src/logic/`は純粋関数のみでIO（fetch）から分離。係数・しきい値は`src/constants.ts`に出典コメント付きで集約（単一情報源。文言やしきい値を変えるときはここを起点にする)
- 上流は4系統: Open-Meteo JMAモデル（予報本体）、標準予報API（降水確率の補完）、ジオコーディング（地名検索）、zipcloud（郵便番号→市区町村名）
- **エラー処理方針**: 利用者へは固定の日本語文、原因詳細（英語ランタイム文言・上流ボディ）は`console.error`のみ。上流障害は`UpstreamError`→502、検証エラー→400、予期しない例外は`src/index.ts`の最終防衛線が500+CORSで返す。補助取得（降水確率・zipcloud）はベストエフォートで、失敗しても本体の応答を巻き込まない
- キャッシュ設計は予報と地点検索で正反対（予報: エッジ30分+ブラウザ10分／地点検索: 上流エッジ7日+レスポンスno-store）。エラーレスポンスは常に`no-store`

### フロントエンド（public/app.js、素のJS・IIFE・フレームワークなし）

- **「最後の明示操作が勝つ」並行制御**: `requestSeq`（fetch応答の世代ガード）・`searchSeq`（検索応答）・`cityChangeTimer`（セレクトのデバウンス）・`manualTabSeq`（利用者のタブ操作。イベント表示の完了後の自動切り替えが後の明示操作を上書きしないため）で、遅れて届いた古い応答が新しい操作を上書きしないようにしている。地点読み込み系を触るときはこの不変条件を壊さないこと
- **プライバシー契約**: GPS座標は取得直後に小数2桁（約1km）へ丸め、localStorageにもURLにも保存しない（`persist: false`）。URLに現れる座標はすべて小数2桁に統一。「位置情報は保存しません」という利用者への約束が画面に明記されている
- **表示名とURL名の分離**: 画面ラベルに付ける注記（共有URLで開いたときの「（共有・…）」など）はURL・共有リンクへ書き戻さない。注記なしの名前を`loadForecast`の`urlName`で渡す（注記付きのまま書き戻すと、共有が1往復するたびに名前が伸びて80文字で切られ、壊れる）
- 初期表示の優先順位: demo指定 → 共有URLの座標 → 記憶した地点（localStorage） → 既定都市
- イベント予報: `public/events.json`（運営者が編集するデータファイル）のイベントを選ぶと、開催地の郵便番号を`/api/geocode`で座標へ解決して予報を表示する。形式は`test/events.test.ts`がCIで検証し、フロントも不正項目を黙って除外する（書き方は`docs/events.md`）

## 障害時の切り分け

上流APIが取れないときは、**まずworkers.devとカスタムドメインを比べる**
（`wrangler.jsonc`の`workers_dev: true`はこのため）。同じWorker・同じ上流URLで
環境だけが違うので、1回でコード側の可能性を排除できる。workers.devだけ成功する
なら原因は223n.techゾーンのCloudflare設定。HTTP 525はCloudflareエッジと接続先
オリジンのTLSハンドシェイク失敗で、上流のアプリまで届いていない
（実例と経緯は`docs/architecture.md`の「Worker外向きfetchの525」）。

## 開発フロー

- mainへは直接pushできない（ブランチ保護）。PR必須で、CI+CodeQL（デフォルトセットアップ運用のためワークフローファイルはない）がマージを阻む
- mainへのマージで`deploy.yml`が本番へ自動デプロイ（並走時は最後のpushが勝つconcurrency設定）
- リリースは`docs/release.md`の手順（バージョン更新は`npm version X.Y.Z --no-git-tag-version`でlockも同期し、フッター3ページも更新。タグ作成はActionsの`Release`ワークフロー手動実行が簡単）

## アクセシビリティ

安全情報を扱うため機能要件として扱う（詳細は`docs/accessibility.md`）。判定は色だけに依存させず記号+文字を併記、CUD配色パレット（`style.css`の`:root`）を使う。動的な表示領域は高さ事前確保などのCLS対策を守る。注意文は`.notice-panel`（黄色系の枠+左上の△!）で全ページ統一し、警戒レベルの`.alert-notice`（赤）とは色で区別する。UIを追加するときは既存の設計判断（ライブ領域・aria・フォーカスリング#A66E00）に合わせる。
