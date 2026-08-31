# Copilot向けリポジトリ指示

着ぐるみ天気予報（FursuitWeather）。Cloudflare Workers上の日本語Webサービス。
詳細なガイドはリポジトリ直下の`AGENTS.md`にある。
この内容を変えるときは`CLAUDE.md`・`AGENTS.md`も同期すること。

## 必ず守ること

- UI文言・コメント・コミットメッセージ・ドキュメントはすべて日本語で書く
- `src/`のコードを変えたらテストを追加する。カバレッジ（statements・
  lines・functions）100%がCIで強制される
- `public/`のブラウザJSはカバレッジ対象外で、実挙動は`e2e/`のPlaywright
  テスト（CIの`e2e`ジョブ）が受け持つ。上流へは接続せず`page.route`で
  APIをモックし、時刻は`page.clock`で固定する（固定しないと実行時刻に
  よって落ちるテストになる）。ただし`public/sw.js`はE2Eが
  `serviceWorkers: 'block'`で遮断するため検証対象外で、自動検証は
  `test/csp.test.ts`のSHELL_URLS一致のみ。変更時は手動確認する
- 係数・しきい値・文言は`src/constants/`が単一情報源。静的HTML・
  `public/app.js`・`public/display.js`・`public/wbgt-tool.js`・
  `public/prefs.js`・`public/style.css`・`docs/*`・`public/llms.txt`・
  フッターのバージョン表記（`display.html`はバージョンコメント）に
  複製があり、`test/htmlSync.test.ts`が同期を機械検証する。対象は
  60件を超えるため、触る前に同ファイルの`describe`・`it`名を確認する
- 長い説明は`public/about.html`へ集約する。index.htmlからの`/about#…`
  リンクは、飛び先の見出しidが実在するかも`test/htmlSync.test.ts`が検証する
- `src/csp.ts`のHTML_PATHSは`wrangler.jsonc`の`run_worker_first`・
  `public/sw.js`のSHELL_URLS・`public/sitemap.xml`と一致させる
  （ずれるとnonceの無いCSPで無言配信される。`test/csp.test.ts`が検証）
- APIの追加は`src/index.ts`の`API_ROUTES`へ1行足す。メソッド制約・
  CORS・502/500変換はルーターが持つのでハンドラはGET前提でよい。
  レスポンスヘッダーは`src/api/http.ts`の`apiHeaders()`が単一情報源
- CSPは2系統（静的アセットは`public/_headers`、HTMLページは`src/csp.ts`）。
  外部の取得先を足すときは両方を更新する
- PRは1つにつき1つのブランチを作る。1本を使い回すと、ブランチから
  PRを逆引きする仕組みが過去のPRを引き当ててしまう
- PRには必ずラベル（`bug`・`enhancement`・`documentation`・`refactor`・
  `accessibility`・`security`・`release`・`dependencies`・`github_actions`・
  `javascript`から該当するもの全部）を付け、`223n`をアサインする
- `npm run build`は`public/`を破壊的に上書きする。コミット後に実行し、
  `git checkout -- public/`で復元する
- インラインCSSはページごとに絞られる。JSが組み立てるクラス名
  （`grade-`のような接頭辞+変数）は`scripts/purge-css.mjs`の
  `DYNAMIC_CLASS_PREFIXES`へ登録する（漏れると配信物だけ静かに崩れる）
- 配信サイズの計測はBrotliで行う（Cloudflareがテキストへ既定で適用する方式）。
  gzipは参考値に留める。PNGなど圧縮済みバイナリは生バイト数がそのまま転送量
- SVGスプライトはビルドが`scripts/optimize-sprite.mjs`で最適化する。
  アイコンを増やしたら実寸での見え方を確かめる
- `public/`のJS同士で複製している関数・定数は
  `test/browserJsSync.test.ts`が一致を強制する。片方だけ直さない
- エラー処理: 利用者向けは固定の日本語文、詳細は`console.error`のみ。
  上流障害は`UpstreamError`→502、検証エラー→400。補助取得
  （降水確率・zipcloud）は失敗しても本体応答を巻き込まない
- プライバシー: GPS座標は取得直後に小数2桁（約1km）へ丸め、保存も
  URL反映もしない。URLに現れる座標は常に小数2桁。サーバー側も
  `parseLatLonParams`（`src/api/http.ts`）で同じ桁へ丸める
- ワークフローの外部アクションはコミットSHAで固定する
  （`uses: actions/checkout@<sha> # v7`。`# vN`はDependabotが追従）
- PRごとに`preview.yml`がプレビュー版を上げてURLをコメントする
  （`wrangler versions upload`。本番は差し替えない。フォークと
  DependabotのPRはSecretsが渡らないため動かない）
- `public/app.js`の世代ガード（`requestSeq`・`searchSeq`・
  `cityChangeTimer`・`manualTabSeq`）による「最後の明示操作が勝つ」
  制御を壊さない
- 画面ラベルの注記（「（共有・…）」など）はURL・共有リンクへ書き戻さず、
  注記なしの名前を`loadForecast`の`urlName`で渡す（書き戻すと共有の
  往復ごとに名前が伸びて壊れる）
- イベント予報の定義`public/events.json`は運営者が編集するデータ
  ファイル。開催地は郵便番号で指定し`/api/geocode`で座標へ解決する。
  形式は`test/events.test.ts`がCIで検証する（書き方は`docs/events.md`）
- 判定表示は色だけに依存させず記号+文字を併記する（CUD配色。
  詳細は`docs/accessibility.md`）

## コマンド

- 開発: `npm run dev`（`?demo=1`で上流なしのデモ表示）
- テスト: `npm test`／単一ファイルは`npx vitest run test/<file>.test.ts`
- E2E: `npm run test:e2e`（Playwright。`wrangler dev`は自動起動）
- lint: `npm run lint`（ESLint + tsc）
- カバレッジ: `npm run test:coverage`
