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
  caption）と`src/constants.ts`
- 地点セレクト（index.html）と`app.js`のCITIES配列
- 実測WBGTツール（`public/wbgt-tool.js`）の判定表・しきい値
- ドキュメント（`docs/api.md`・`docs/logic.md`）と`llms.txt`の数値記述
- フッターのバージョン表記と`package.json`の`version`
- API先読み（preload）のURLと初回リクエスト

カバレッジは次のコマンドで計測できます（対象は`src/`）。

```bash
npm run test:coverage
```

ステートメント・行・関数は100%を維持しています。このしきい値は
`vitest.config.ts`のcoverage設定に定義され、CIでも強制されます。
未カバーの分岐は、番兵値（Infinity帯・スコア上限）により到達しない
防御フォールバックのみです。
`public/app.js`・`public/wbgt-tool.js`はブラウザ実行のためカバレッジ
対象外ですが、定数同期は`htmlSync.test.ts`で機械検証し、実挙動は
E2Eテスト（`e2e/`配下）が実ブラウザで検証します。

```bash
npm run test:e2e   # Playwright（APIはモック。wrangler devを自動起動）
```

E2EテストはCI（`ci.yml`のe2eジョブ）でも実行されます。
axe-core監査とCLS測定はリリース時の手動確認です（手順は
[アクセシビリティ設計](accessibility.md)の検証方法を参照）。

## ビルド

デプロイ時に次の最適化を行います（CI・デプロイの両ワークフローで自動実行）。

```bash
npm run build   # minify（app.js・style.cssの圧縮）+ 各HTMLへのCSSインライン化
```

`public/`のファイルを直接圧縮・書き換えするため、ローカルで実行した
場合は`git checkout`で戻してください。

HTMLページを追加する場合は、`<link rel="stylesheet" href="/style.css">`
のタグを完全一致で含める必要があります。ビルドは`public/`直下の全HTMLを
CSSインライン化の対象にし、このタグがないページがあるとビルドを
失敗させます（`scripts/inline-css.mjs`の安全確認）。

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

各ワークフローは`permissions`で必要最小限の権限を宣言しています。

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
APIレスポンスのヘッダーは`src/api/forecast.ts`の`json()`で設定します。

CSPは`default-src 'none'`を基点に必要な取得先だけを明示する構成のため、
外部CDN・Webフォント・外部画像などを追加する場合は`_headers`と`src/csp.ts`の
両方を更新する必要があります。デプロイ時にCSSがHTMLへインライン化されるため、
`style-src`ではそのCSSをアセット側はハッシュで、HTMLページ側はnonceで
許可しています。

## 依存関係の更新

`.github/dependabot.yml`により、npmパッケージとGitHub Actionsの更新PRが
毎週月曜の朝（日本時間）に自動作成されます。マイナー・パッチ更新は
1つのPRにまとめられます。CIのテストが通ることを確認してマージして
ください。

## 開発時の注意

- 表示文言のラベルや係数を変える場合は、`src/constants.ts`を起点にする
  （ラベル・しきい値の単一情報源）
- 静的HTML・フロントJSに文言やしきい値を複製している箇所
  （注意事項・判定凡例・地点セレクト・aboutのしきい値表・
  実測WBGTツールの判定表）は同期コメントとテストを目印にする
- 色を扱う場合は[アクセシビリティ設計](accessibility.md)の
  カラーパレットとコントラスト基準に従う
