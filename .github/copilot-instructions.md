# Copilot向けリポジトリ指示

着ぐるみ天気予報（FursuitWeather）。Cloudflare Workers上の日本語Webサービス。
詳細なガイドはリポジトリ直下の`AGENTS.md`にある。
この内容を変えるときは`CLAUDE.md`・`AGENTS.md`も同期すること。

## 必ず守ること

- UI文言・コメント・コミットメッセージ・ドキュメントはすべて日本語で書く
- `src/`のコードを変えたらテストを追加する。カバレッジ（statements・
  lines・functions）100%がCIで強制される
- 係数・しきい値・文言は`src/constants.ts`が単一情報源。HTML・
  `public/app.js`・`public/wbgt-tool.js`・`docs/api.md`・`docs/logic.md`・
  `public/llms.txt`・フッターのバージョン表記に複製があり、
  `test/htmlSync.test.ts`が同期を機械検証する。片側だけ変えるとCIが落ちる
- `npm run build`は`public/`を破壊的に上書きする。コミット後に実行し、
  `git checkout -- public/`で復元する
- エラー処理: 利用者向けは固定の日本語文、詳細は`console.error`のみ。
  上流障害は`UpstreamError`→502、検証エラー→400。補助取得
  （降水確率・zipcloud）は失敗しても本体応答を巻き込まない
- プライバシー: GPS座標は取得直後に小数2桁（約1km）へ丸め、保存も
  URL反映もしない。URLに現れる座標は常に小数2桁
- `public/app.js`の世代ガード（`requestSeq`・`searchSeq`・
  `cityChangeTimer`・`manualTabSeq`）による「最後の明示操作が勝つ」
  制御を壊さない
- イベント予報の定義`public/events.json`は運営者が編集するデータ
  ファイル。開催地は郵便番号で指定し`/api/geocode`で座標へ解決する。
  形式は`test/events.test.ts`がCIで検証する（書き方は`docs/events.md`）
- 判定表示は色だけに依存させず記号+文字を併記する（CUD配色。
  詳細は`docs/accessibility.md`）

## コマンド

- 開発: `npm run dev`（`?demo=1`で上流なしのデモ表示）
- テスト: `npm test`／単一ファイルは`npx vitest run test/<file>.test.ts`
- lint: `npm run lint`（ESLint + tsc）
- カバレッジ: `npm run test:coverage`
