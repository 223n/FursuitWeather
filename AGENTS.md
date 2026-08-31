# AGENTS.md

AIコーディングエージェント向けの、このリポジトリで作業する際のガイドです。
内容を変えるときは`CLAUDE.md`・`.github/copilot-instructions.md`も同期してください。

## プロジェクト概要

着ぐるみ天気予報（FursuitWeather）。Cloudflare Workers上で動作する日本語のWebサービスで、気象データから着ぐるみ活動の適否を予報する。中心はWBGT（暑さ指数）+着衣補正による活動判定で、洗濯乾燥・静電気・空気のよごれ（黄砂・PM2.5）・急な暑さ（暑熱順化前）の各指数が付く。配信面は3つある: 本体UI（index.html）、イベント会場のモニター向け表示（display.html）、外部サイト向けの埋め込み（`/api/badge.svg`・`/api/events.ics`）。UI文言・コメント・コミットメッセージ・ドキュメントはすべて日本語で書く。

## コマンド

```bash
npm run dev                          # wrangler dev（http://localhost:8787、?demo=1で上流なしのデモ表示）
npm test                             # vitest全件（src/のユニットテスト）
npx vitest run test/geocode.test.ts  # 単一テストファイル
npx vitest run -t "テスト名の一部"    # テスト名で絞り込み
npm run test:e2e                     # Playwright（public/のブラウザJS。下記の約束事を必ず読むこと）
npm run lint                         # ESLint + tsc --noEmit
npm run test:coverage                # カバレッジ（しきい値未達で失敗）
npm run build                        # minify + CSSインライン化（下記の注意を必ず読むこと）
```

### npm run build の重要な注意

`npm run build`は`public/`のファイルを**破壊的に上書き**する（JS5本（app.js・prefs.js・wbgt-tool.js・display.js・sw.js）とCSS2本（style.css・display.css）のminify、HTMLへのCSSインライン化（display.htmlは2ファイル分）、HTMLコメントの除去（配信物のみ。`display.html`のバージョンコメントだけは運用で使うため残す））。必ず**コミット後**に実行し、検証が済んだら`git checkout -- public/`で復元する。未コミットの`public/`編集がある状態で実行すると編集が失われる。

## CIが強制する契約

- **カバレッジ100%**: statements・lines・functionsは100%が`vitest.config.ts`のしきい値でCI強制される。`src/`に新しいコードを書いたら必ずテストを追加する（`public/`のブラウザJSは対象外で、実挙動はE2Eが受け持つ。ただし`sw.js`だけは例外で、下記のE2E節を参照）
- **E2Eテスト**: `ci.yml`の独立ジョブ`e2e`が`e2e/`配下を実ブラウザで実行する。書き方は「E2E（Playwright）の約束事」を参照
- **htmlSync同期テスト**（`test/htmlSync.test.ts`）: 文言・しきい値の複製箇所を`?raw`インポートで機械検証する。両側を揃えないとテストが落ちる。複製は`src/constants/`（単一情報源）から静的HTML・`public/app.js`・`public/display.js`・`public/wbgt-tool.js`・`public/prefs.js`・`public/style.css`・`docs/*`・`public/llms.txt`へ広く伸びており、検証は60件を超えて増え続けている。**触る前に`test/htmlSync.test.ts`の`describe`・`it`名を一覧して、その箇所が検証対象かを確かめる**（このファイルの見出しが実質の同期対象一覧なので、ここでは代表例だけ挙げる）
  - `src/constants/`のしきい値・ラベル ↔ index.htmlの注意事項・判定凡例、about.htmlのしきい値表、`public/wbgt-tool.js`の判定表（配列の形式まで完全一致で検証される）
  - `src/constants/`のNATIONAL_CITIES ↔ `public/app.js`のCITIES ↔ index.htmlの地点セレクト（名前・座標・順序まで一致）
  - `package.json`のversion ↔ フッターのバージョン表記（index・about・404・emergencyの4ページ）・display.htmlのバージョンコメント
  - index.htmlの`/about#…`リンク ↔ about.htmlの見出しid（説明をabout.htmlへ集約したため、飛び先が消えると無言でリンクが壊れる）
- **設定の同期テスト**（`test/csp.test.ts`・`test/sitemap.test.ts`）: `src/csp.ts`のHTML_PATHSは`wrangler.jsonc`の`run_worker_first`・`public/sw.js`のSHELL_URLS・`public/sitemap.xml`と一致させる。ずれるとWorkerが起動せず、**nonceの無い`_headers`側のCSPで無言配信される**（ページ自体は開くため気付きにくい）
- HTMLページを追加する場合、`<link rel="stylesheet" href="/style.css">`の完全一致タグがないとビルドが失敗する（`scripts/inline-css.mjs`の安全確認）

## アーキテクチャの要点

詳細は`docs/architecture.md`。以下は複数ファイルにまたがる不変条件。

### バックエンド（src/）

- 2層構成: 静的アセット（`public/`）+ Worker（`/api/*`とHTMLページで起動、`wrangler.jsonc`の`run_worker_first`。HTMLはCSP nonceのため）
- **APIルーター**: エンドポイントの追加は`src/index.ts`の`API_ROUTES`表へ1行足す（現在6本: `/api/forecast`・`/api/geocode`・`/api/national`・`/api/events.ics`・`/api/badge.svg`・`/api/alert`）。メソッド制約・CORSプリフライト・`UpstreamError`→502・予期しない例外→500はルーターが一括で持つため、ハンドラはGET前提で書き、`UpstreamError`はそのまま投げてよい
- レスポンスヘッダー（CORS・nosniff・キャッシュ）の単一情報源は`src/api/http.ts`の`apiHeaders()`。JSON以外（SVG・iCal）の応答もここを通す
- `src/logic/`は純粋関数のみでIO（fetch）から分離。係数・しきい値は`src/constants/`に出典コメント付きで集約（単一情報源。文言やしきい値を変えるときはここを起点にする)。関心事ごとに`activity`・`laundry`・`staticElectricity`・`airQuality`・`weather`・`upstream`・`geo`・`badge`へ分けてあるが、`index.ts`が全てを再exportするため利用側は`../constants`から取ればよい（どこに足すか迷ったら`index.ts`の一覧表を見る）
- 上流は6系統: Open-Meteo JMAモデル（予報本体）、標準予報API（降水確率の補完）、Air Quality API（黄砂・PM2.5）、ジオコーディング（地名検索）、zipcloud（郵便番号→市区町村名）、環境省アラート発表状況CSV（公式発表の突合。全経路ベストエフォート）
- **エラー処理方針**: 利用者へは固定の日本語文、原因詳細（英語ランタイム文言・上流ボディ）は`console.error`のみ。上流障害は`UpstreamError`→502、検証エラー→400、予期しない例外は`src/index.ts`の最終防衛線が500+CORSで返す。補助取得（降水確率・zipcloud）はベストエフォートで、失敗しても本体の応答を巻き込まない
- キャッシュ設計は予報と地点検索で正反対（予報: エッジ30分+ブラウザ10分／地点検索: 上流エッジ7日+レスポンスno-store）。エラーレスポンスは常に`no-store`
- **CSPは2系統**: 静的アセットは`public/_headers`、HTMLページは`src/csp.ts`がリクエストごとのnonce付きで組み立てる。`default-src 'none'`起点のため、外部の取得先（CDN・Webフォント・外部画像など）を足すときは**両方**を更新する（片方だけだともう片方で黙ってブロックされる）

### フロントエンド（public/app.js、素のJS・IIFE・フレームワークなし）

- **「最後の明示操作が勝つ」並行制御**: `requestSeq`（fetch応答の世代ガード）・`searchSeq`（検索応答）・`cityChangeTimer`（セレクトのデバウンス）・`manualTabSeq`（利用者のタブ操作。イベント表示の完了後の自動切り替えが後の明示操作を上書きしないため）で、遅れて届いた古い応答が新しい操作を上書きしないようにしている。地点読み込み系を触るときはこの不変条件を壊さないこと
- **プライバシー契約**: GPS座標は取得直後に小数2桁（約1km）へ丸め、localStorageにもURLにも保存しない（`persist: false`）。URLに現れる座標はすべて小数2桁に統一。「位置情報は保存しません」という利用者への約束が画面に明記されている。サーバー側も`parseLatLonParams`（`src/api/http.ts`）で受け取った座標を小数2桁へ丸める（画面の契約と揃えるとともに、任意精度の座標で上流キャッシュキーが際限なく分かれるのを防ぐ）
- **表示名とURL名の分離**: 画面ラベルに付ける注記（共有URLで開いたときの「（共有・…）」など）はURL・共有リンクへ書き戻さない。注記なしの名前を`loadForecast`の`urlName`で渡す（注記付きのまま書き戻すと、共有が1往復するたびに名前が伸びて80文字で切られ、壊れる）
- 初期表示の優先順位: demo指定 → 共有URLの座標 → 記憶した地点（localStorage） → 既定都市
- イベント予報: `public/events.json`（運営者が編集するデータファイル）のイベントを選ぶと、開催地の郵便番号を`/api/geocode`で座標へ解決して予報を表示する。形式は`test/events.test.ts`がCIで検証し、フロントも不正項目を黙って除外する（書き方は`docs/events.md`）

## E2E（Playwright）の約束事

`e2e/`は`public/`のブラウザJS（カバレッジ対象外）の実挙動を実ブラウザで検証する層。設定は`playwright.config.mjs`で、`npm run test:e2e`が`wrangler dev`を自動起動する（起動済みなら再利用する）。

- **上流ネットワークへ接続しない**: `/api/*`と`events.json`は`page.route`で同一オリジンの`?demo=1`などへ差し替え、応答を決定的にする
- **時刻に依存させない**: 判定も表示も時刻で変わるため、`page.goto`の前に`page.clock.install`でJST基準の固定時刻を入れる。ここを外すと「夕方以降だけ落ちる」「深夜だけ落ちる」テストになる（実際に作り込んで直した経緯がある）。スライドの自動送りや鮮度警告の検証も`page.clock.fastForward`で行い、実時間を待たない
- **`serviceWorkers: 'block'`を外さない**: SWが介在すると`page.route`のモックが素通しされ、2回目以降の遷移でキャッシュが返る。変更が効いていないのに効いて見えるため、計測を誤る。その代わりSW自体（`public/sw.js`）の挙動はE2Eの検証対象外になり、自動検証は`test/csp.test.ts`のSHELL_URLS一致のみ。sw.jsを変えたときは手動で確認する
- CSPにより`page.addStyleTag`は弾かれる。CSSを差し替えて試したいときは`page.route('**/display.css', …)`で応答を作る
- ローカルに`ms-playwright`のブラウザが無い環境では、`PLAYWRIGHT_CHROMIUM_PATH`にシステムのChromeの実行ファイルを指定して実行できる

## 障害時の切り分け

上流APIが取れないときは、**まずworkers.devとカスタムドメインを比べる**
（`wrangler.jsonc`の`workers_dev: true`はこのため）。同じWorker・同じ上流URLで
環境だけが違うので、1回でコード側の可能性を排除できる。workers.devだけ成功する
なら原因は223n.techゾーンのCloudflare設定。HTTP 525はCloudflareエッジと接続先
オリジンのTLSハンドシェイク失敗で、上流のアプリまで届いていない
（実例と経緯は`docs/architecture.md`の「Worker外向きfetchの525」）。

## 開発フロー

- mainへは直接pushできない（ブランチ保護）。PR必須で、CI+CodeQL（デフォルトセットアップ運用のためワークフローファイルはない）がマージを阻む
- **1つのPRにつき1つのブランチを作る**（例: `claude/print-picker-cls-20260826`）。
  1本のブランチを使い回すと、ブランチからPRを逆引きする仕組み（GitHubや周辺ツール）が
  同じブランチの過去のPRを引き当て、無関係な古いPRが表示される。
  マージ済みブランチはリポジトリ設定の「Automatically delete head branches」で自動削除する
- mainへのマージで`deploy.yml`が本番へ自動デプロイ（並走時は最後のpushが勝つconcurrency設定）
- PRごとに`preview.yml`がプレビュー版を上げ、URLをPRへコメントする（`wrangler versions upload`。本番のアクティブなデプロイは差し替えない。フォークとDependabotのPRはSecretsが渡らないため動かない。詳細は`docs/development.md`）
- ワークフローの外部アクションはタグではなく**コミットSHAで固定**する（`uses: actions/checkout@<sha> # v7`）。タグは付け替えられるため、乗っ取られたタグでシークレット付きのジョブが動く事故を防ぐ。併記の`# vN`はDependabotが追従する
- リリースは`docs/release.md`の手順（バージョン更新は`npm version X.Y.Z --no-git-tag-version`でlockも同期し、フッター4ページ（index・about・404・emergency）とdisplay.htmlのバージョンコメントも更新。タグ作成はActionsの`Release`ワークフロー手動実行が簡単）

## アクセシビリティ

安全情報を扱うため機能要件として扱う（詳細は`docs/accessibility.md`）。判定は色だけに依存させず記号+文字を併記、CUD配色パレット（`style.css`の`:root`）を使う。動的な表示領域は高さ事前確保などのCLS対策を守る。注意文は`.notice-panel`（黄色系の枠+左上の△!）で全ページ統一し、警戒レベルの`.alert-notice`（赤）とは色で区別する。UIを追加するときは既存の設計判断（ライブ領域・aria・フォーカスリング#A66E00）に合わせる。
