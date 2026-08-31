# 開発ガイド

開発フローの全体像は次のとおりです。

1. 作業ブランチを作成して変更し、PRを作成する（CIとCodeQLが自動実行）
1. mainへマージすると本番へ自動デプロイされる
1. リリースを切るときはバージョンを更新し、タグ作成でGitHubリリースを
   自動作成する（[リリース手順](release.md)）

## 必要環境

- Node.js 22以上
- npm

## セットアップ

```bash
npm install
npm run dev
```

`http://localhost:8787` で動作確認できます。
気象APIに接続できない環境では `http://localhost:8787/?demo=1` で
デモデータの表示を確認できます。

## テスト・lint

```bash
npm test        # vitest
npm run lint    # ESLint + tsc（typecheck）
```

テストは`test/`配下にあります。文言・しきい値の複製箇所は
`test/htmlSync.test.ts`が機械検証します。検証対象は次のとおりで、
これらを編集するときはテストも合わせて更新してください。

- 静的HTML（注意事項・判定凡例・about.htmlのしきい値表・テーブルの
  caption）と`src/constants/`
- 地点セレクト（index.html）と`app.js`のCITIES配列
- 実測WBGTツール（`public/wbgt-tool.js`）の判定表・しきい値
- ドキュメント（`docs/api.md`・`docs/logic.md`）と`llms.txt`の数値記述
- フッターのバージョン表記・`display.html`のバージョンコメントと
  `package.json`の`version`
- `src/constants/`のNATIONAL_CITIESと`app.js`のCITIES配列（名前・座標・順序）
- 会場表示モード（`public/display.js`）の複製部品（GRADE_SYMBOLS・
  天気コード→アイコンの対応・警戒しきい値・既定地点）と`app.js`・
  `src/constants/`、および`docs/display.md`の数値記述（表示秒数・
  更新間隔・鮮度しきい値・深夜リロード時刻）
- API先読み（preload）のURLと初回リクエスト

カバレッジは次のコマンドで計測できます（対象は`src/`）。

```bash
npm run test:coverage
```

ステートメント・行・関数は100%を維持しています。このしきい値は
`vitest.config.ts`のcoverage設定に定義され、CIでも強制されます。
分岐（branches）はしきい値の対象外です（既定引数などツール上の
部分分岐が含まれるため）。
`public/app.js`・`public/prefs.js`・`public/wbgt-tool.js`・
`public/display.js`はブラウザ実行のためカバレッジ対象外ですが、
定数同期は`htmlSync.test.ts`で機械検証し、実挙動はE2Eテスト
（`e2e/`配下。会場表示モードは`e2e/display.spec.mjs`）が実ブラウザで
検証します。

`public/sw.js`だけはこの二重の網から外れます。E2Eは
`serviceWorkers: 'block'`でService Workerを遮断するため
（モックしたAPI応答がSWのキャッシュに素通しされるのを防ぐ設定）、
自動検証はオフラインシェルの対象パスがHTML_PATHSと一致するかを見る
`csp.test.ts`だけです。SWの挙動を変えたときは手動で確認してください。

```bash
npm run test:e2e   # Playwright（APIはモック。wrangler devを自動起動）
```

E2EテストはCI（`ci.yml`のe2eジョブ）でも実行されます。
axe-core監査とCLS測定はリリース時の手動確認です（手順は
[アクセシビリティ設計](accessibility.md)の検証方法を参照）。

## ビルド

デプロイ時に次の最適化を行います（CI・デプロイの両ワークフローで自動実行）。

```bash
npm run build   # minify（JS5本（app.js・prefs.js・wbgt-tool.js・display.js・sw.js）とstyle.css・display.cssの圧縮）+ 各HTMLへのCSSインライン化（display.htmlは2ファイル分）+ SVGスプライトの最適化
```

インライン化するCSSは、**そのページで使わない規則を落として**から埋め込みます
（`scripts/purge-css.mjs`）。全ページが共通の`style.css`を丸ごと埋め込んでいた
ため、判定UIを持たないページにも日別カード・タブ・タイマーといった無関係な
規則が入っていました（404ページでは配信サイズの79%）。

残すかどうかは「残す側へ倒す」判断で決めます。

| 条件 | 扱い |
|---|---|
| セレクタにクラス名・IDが無い（`body`・`table th`・`:root`） | 常に残す |
| クラス名・IDのいずれかがページのHTML・JSに現れる | 残す（照合は部分一致） |
| `DYNAMIC_CLASS_PREFIXES`の接頭辞で始まる | 残す |
| `@media`・`@container`・`@supports` | 中身を再帰処理し、空になれば落とす |
| `@font-face`・`@keyframes` | セレクタを持たないため常に残す |

JSが実行時に組み立てるクラス名（`` `badge grade-${summary.grade}` `` など）は
HTML・JSに文字列として現れないため、`scripts/purge-css.mjs`の
`DYNAMIC_CLASS_PREFIXES`へ接頭辞を登録します。**ここが唯一の「配信物だけ
静かに崩れる」経路**（E2Eは`wrangler dev`がソースを配信するためビルド後の
HTMLを検証できません）なので、`test/cssPurge.test.ts`がブラウザJSを走査して
未登録の接頭辞を検出します。

### 計測はBrotliで行う

配信サイズの評価はBrotliで行います。Cloudflareがテキストへ既定で適用する方式で、
利用者が実際に受け取るのはこれだからです。gzipは参考値に留めます。
PNGなど既に圧縮済みのバイナリはCloudflareの圧縮対象外なので、生バイト数が
そのまま転送量になります。

配信物の実測（Brotli）:

| ページ | 導入前 | 導入後 | 削減 |
|---|---|---|---|
| index.html | 17,794 | 17,486 | -1.7% |
| about.html | 18,987 | 16,805 | -11.5% |
| display.html | 11,778 | 9,534 | -19.1% |
| emergency.html | 9,369 | 6,992 | -25.4% |
| 404.html | 6,331 | 3,704 | -41.5% |
| 配信物10ファイル合計 | 96,834 | 87,096 | **-10.1%** |

`public/`のファイルを直接圧縮・書き換えするため、ローカルで実行した
場合は`git checkout`で戻してください。

HTMLページを追加する場合は、`<link rel="stylesheet" href="/style.css">`
のタグを完全一致で含める必要があります。ビルドは`public/`直下の全HTMLを
CSSインライン化の対象にし、このタグがないページがあるとビルドを
失敗させます（`scripts/inline-css.mjs`の安全確認）。

### SVGスプライトの最適化

アイコンはFont Awesomeのパスを自前配信のスプライト（HTML内の`<symbol>`）として
持っています。ビルドの最後に`scripts/optimize-sprite.mjs`がsvgoを掛けます。

`floatPrecision`は**1**にします。svgoの円弧化の許容誤差は`0.1^floatPrecision`に
連動するため、桁を1つ下げたところで初めて曲線→円弧のコマンド併合が起きます。

| floatPrecision | 配信物のBrotli削減 |
|---|---|
| 3 | -114バイト |
| 2 | -206バイト |
| **1** | **-2,681バイト** |

座標を丸めるため描画は厳密には同一になりません。**アイコンを増やしたときは
実寸での見え方を確かめてください**。導入時はChromiumで32シンボル×5サイズ
（16/24/48/96/200px）を1枚ずつ描いて全画素比較し、実寸24px（`.fa-icon`の
大きさ）での塗りの反転画素が最悪でも26/2304（1.1%、輪郭のアンチエイリアス
1画素分）であること、6倍に拡大しても判別できないことを確認しています。

最適化の前後で次が変わるとビルドが止まります。CIは全PRで`npm run build`を
流すため、svgoの更新で黙って壊れた場合はマージ前に落ちます。

- シンボルのid（`use`要素の参照先。1つ欠けるとアイコンが消える）
- viewBoxの数（欠けると拡大縮小が効かなくなる）
- pathの数
- `class="icon-sprite"`と`aria-hidden="true"`（欠けるとアイコン定義が画面に並ぶ）

### PNGの再圧縮

`public/*.png`はoxipng（`-o max --strip safe`）で1回だけ再圧縮済みです
（9本で314,389→173,351バイト、-44%）。ビルド段には入れていません。
差し替えたときは同じコマンドを手で流し、画素が変わっていないことを
確かめてください（IDATをzlib展開してPNGフィルタを解いた生画素の一致で見ます）。

なお`npm run deploy`（手動デプロイ）はビルドを経由しません。緊急時は
非最適化のまま配信されますが、動作に支障はありません（最適化配信は
次のGitHub Actionsデプロイで戻ります）。

## デプロイ

### 手動デプロイ

```bash
npx wrangler login
npm run deploy
```

### GitHub Actionsからのデプロイ

1. Cloudflareダッシュボードで「Edit Cloudflare Workers」テンプレートの
   APIトークンを作成する
1. リポジトリのSecretsに `CLOUDFLARE_API_TOKEN` と
   `CLOUDFLARE_ACCOUNT_ID` を設定する
1. mainブランチへのpushで自動デプロイされる（Actionsタブの `Deploy`
   ワークフローから手動実行も可能）

### CI/CDワークフロー

ワークフローは`.github/workflows/`にあります。

| ワークフロー | 内容 |
|--------------|------|
| `ci.yml` | lint→テスト→ビルド検証（PRと、mainへのpushで実行） |
| `deploy.yml` | lint→テスト→ビルド→wrangler deploy（mainのみ。並走時は最後のpushが勝つ） |
| `release.yml` | GitHubリリースの自動作成（`v*`タグのpushまたは手動実行。詳細は[リリース手順](release.md)） |
| `preview.yml` | PRごとのプレビュー版を上げ、URLをPRへコメント（下記） |

各ワークフローは`permissions`で必要最小限の権限を宣言しています。

### PRプレビュー

`preview.yml`はPRごとに`wrangler versions upload`で新しいバージョンを上げ、
プレビューURLをPRへコメントします。**アクティブなデプロイ（本番）は
差し替えません。** 本番へ出るのはmainへのマージで走る`deploy.yml`だけ、という
関係は変わりません。

URLは2種類できます。

| 種類 | 形式 | 性質 |
|------|------|------|
| ブランチ単位 | `<別名>-fursuit-weather.<サブドメイン>.workers.dev` | PRへpushしても変わらない（`--preview-alias`） |
| コミット単位 | `<バージョン接頭辞>-fursuit-weather.<サブドメイン>.workers.dev` | その版だけを指す |

別名はブランチ名を小文字化し、英数字以外をハイフンへ潰して作ります
（`claude/link-icons-20260831` → `claude-link-icons-20260831`）。
サブドメインのラベルは63文字までのため、別名は40文字で切ります。

コメントは`<!-- pr-preview -->`の印で既存のものを探して書き換えます。
pushのたびにコメントが増えることはありません。

**フォークからのPRとDependabotのPRでは動きません。** どちらもSecretsが
渡らないためです。`pull_request_target`にすればフォークでも動かせますが、
PRのheadのコードをSecrets付きで実行することになり、公開リポジトリでは
乗っ取りの経路になるため採っていません。

プレビューURLの有効・無効は`wrangler.jsonc`の`preview_urls`で明示しています。
既定値はwranglerの版で揺れる（`workers_dev`に追従する版と、falseに倒す版がある）
ため、暗黙に頼らず書いています。ダッシュボード側で切り替えても、次に
wranglerでデプロイした時点でこの値に戻る点に注意してください。

プレビューURLは公開されます。各ページのcanonicalタグがカスタムドメインを
指しているため、重複コンテンツの扱いは`workers.dev`と同じ考え方です。

このほか、リポジトリの設定として次が有効です。

- **ブランチ保護**: mainへは直接pushできず、PRを経由します。
  マージにはCIとCodeQLの結果が必要です
- **CodeQL（コードスキャン）**: GitHubのデフォルトセットアップで
  運用しているため、ワークフローファイルはリポジトリにありません
  （設定はGitHubのSecurity設定画面にあります）。PRごとに自動で
  解析され、完了までマージがブロックされます
- **Secret scanning + Push protection**: 秘密情報の誤コミットを
  検出・ブロックします

### カスタムドメイン

`wrangler.jsonc` の `routes` でカスタムドメイン
（`fursuit-weather.223n.tech`）を設定しています。デプロイ時に
223n.techゾーンへDNSレコードとTLS証明書が自動作成されます。
前提条件は次のとおりです。

- 223n.techゾーンがデプロイ先と同じCloudflareアカウントにあること
- APIトークンにゾーン権限（「Edit Cloudflare Workers」テンプレートの
  「Workers Routes: 編集」）があること。最小権限トークンを使っている
  場合は「Zone > Workers Routes > 編集」（対象: 223n.tech）の追加が必要

### workers.devサブドメイン

`wrangler.jsonc`の`workers_dev: true`により、
`fursuit-weather.223n.workers.dev`も有効です。223n.techゾーンの設定
（セキュリティ機能など）を経由しない検証用URLとして使えます。
重複コンテンツ対策は各ページのcanonicalタグ（カスタムドメイン指定）で
担保しています。

## セキュリティヘッダー

静的アセットのレスポンスヘッダーは`public/_headers`で設定しています
（CSP・X-Content-Type-Options・Referrer-Policy・Permissions-Policy・
HSTS）。HTMLページのCSPだけは`src/csp.ts`が組み立て、Workerが
リクエストごとのnonce付きで付与します（`docs/architecture.md`を参照）。
APIレスポンスのヘッダーは`src/api/http.ts`の`json()`で設定します（CORS・キャッシュ・nosniffを含む全`/api/*`共通の単一情報源）。

CSPは`default-src 'none'`を基点に必要な取得先だけを明示する構成のため、
外部CDN・Webフォント・外部画像などを追加する場合は`_headers`と`src/csp.ts`の
両方を更新する必要があります。デプロイ時にCSSがHTMLへインライン化されるため、
`style-src`ではそのCSSをアセット側はハッシュで、HTMLページ側はnonceで
許可しています。

## リポジトリ側で有効にしておく設定

コードでは持てず、GitHubのリポジトリ設定でしか変えられない項目です。

### 秘密スキャンとプッシュ保護

**現状: 有効。** 2026-08-30にアカウント全体の既定としても適用済みです。

`deploy.yml`は`CLOUDFLARE_API_TOKEN`と`CLOUDFLARE_ACCOUNT_ID`をSecretsから
使うため、これらを誤ってコミットする事故が最も痛いところです。
効くのはプッシュ保護（Push protection）で、混入する前にpushを拒否します。
公開リポジトリなら無償で使えます。

紛らわしい3つを区別します。

| 機能 | 誰が気づくか | タイミング | 切り替え |
|------|------------|-----------|---------|
| パートナーアラート | 秘密の発行元（Cloudflare等） | 混入**後** | 公開リポジトリでは常時有効。変更不可 |
| 秘密スキャンのアラート | 自分（Securityタブ） | 混入**後** | 設定で切り替え |
| **プッシュ保護** | 自分（pushが拒否される） | **混入する前** | 設定で切り替え |

設定画面にある「GitHub will always send alerts to partners for detected secrets
in public repositories」は1つ目の説明文で、有効化した結果ではありません
（公開リポジトリでは常に有効なため、"always"と書かれています）。

なお、GitHubのAPIは`Repository does not have GitHub Advanced Security enabled.`
を返しますが、これは**有償のGitHub Advanced Security製品**が無いという意味です。
公開リポジトリの秘密スキャンとプッシュ保護はGHASとは別枠の無償機能のため、
**この応答から有効・無効は判断できません**（実際、この応答が返る状態でも
プッシュ保護は有効でした）。状態はリポジトリまたはアカウントの
Code security設定で直接確認してください。

gitleaks等をCIへ足す案は採りません。プッシュ保護と違い混入した後にしか気づけず、
外部アクションを1つ増やす代償（サプライチェーン）に見合わないためです。

### Code scanning AI findings（`github-advanced-security`チェック）

このチェックはGitHub側の不具合で失敗し続けています
（`CAPIError: 400 The requested model is not supported.`）。
GitHub自身のエージェントが選んだモデルをCopilot APIが拒否しており、
リポジトリ内の設定ファイルでは直せません（実体のない動的ワークフローのため）。

必須チェックではないので機能自体に実害はありませんが、恒久的な赤は
CIを見ない習慣を作ります。設定で無効化して構いません。
**CodeQLは別機能なので、無効化しても静的解析は残ります。**

## 上流APIが取れないとき

まず**workers.devとカスタムドメインを比べます**。同じWorker・同じ上流URLで
環境だけが違うため、1回でコード側の可能性を排除できます。

```bash
curl -s "https://fursuit-weather.223n.workers.dev/api/forecast?lat=35.68&lon=139.68&days=3"
curl -s "https://fursuit-weather.223n.tech/api/forecast?lat=35.68&lon=139.68&days=3"
```

workers.devだけ成功するなら、原因は223n.techゾーンのCloudflare設定です
（過去にSSL/TLSの「配信元の接続」のポスト量子暗号化で全滅した実績があります。
詳細は`docs/architecture.md`の「Worker外向きfetchの525」）。

## 依存関係の更新

`.github/dependabot.yml`により、npmパッケージとGitHub Actionsの更新PRが
毎週月曜の朝（日本時間）に自動作成されます。マイナー・パッチ更新は
1つのPRにまとめられます。CIのテストが通ることを確認してマージして
ください。

## 開発時の注意

- 表示文言のラベルや係数を変える場合は、`src/constants/`を起点にする
  （ラベル・しきい値の単一情報源）
- 静的HTML・フロントJSに文言やしきい値を複製している箇所
  （注意事項・判定凡例・地点セレクト・aboutのしきい値表・
  実測WBGTツールの判定表）は同期コメントとテストを目印にする
- 色を扱う場合は[アクセシビリティ設計](accessibility.md)の
  カラーパレットとコントラスト基準に従う
