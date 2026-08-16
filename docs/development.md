# 開発ガイド

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

テストは`test/`配下にあります。静的HTML（注意事項・判定凡例）と
`src/constants.ts`の同期は`test/htmlSync.test.ts`が機械検証します。
凡例の文言を変える場合はこのテストも合わせて更新してください。

## ビルド

デプロイ時に次の最適化を行います（CIでは自動実行）。

```bash
npm run minify              # app.js・style.cssをesbuildで圧縮
node scripts/inline-css.mjs # 各HTMLへCSSをインライン化
```

`public/`のファイルを直接圧縮・書き換えするため、ローカルで実行した
場合は`git checkout`で戻してください。

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

ワークフローは`.github/workflows/`にあります。

| ワークフロー | 内容 |
|--------------|------|
| `ci.yml` | lintとテスト（pushとPRで実行） |
| `deploy.yml` | テスト→minify→CSSインライン化→wrangler deploy |

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
HSTS）。APIレスポンスのヘッダーは`src/api/forecast.ts`の`json()`で
設定します。

CSPは自己配信のみを許可する構成（`default-src 'self'`）のため、
外部CDN・Webフォント・外部画像などを追加する場合は`_headers`の更新が
必要です。デプロイ時にCSSがHTMLへインライン化されるため、`style-src`には
`'unsafe-inline'`を含めています。

## 依存関係の更新

`.github/dependabot.yml`により、npmパッケージとGitHub Actionsの更新PRが
毎週月曜の朝（日本時間）に自動作成されます。マイナー・パッチ更新は
1つのPRにまとめられます。CIのテストが通ることを確認してマージして
ください。

## 開発時の注意

- 表示文言のラベルや係数を変える場合は、`src/constants.ts`を起点にする
  （ラベル・しきい値の単一情報源）
- 静的HTMLに文言を複製している箇所（注意事項・判定凡例・地点セレクト）は
  同期コメントとテストを目印にする
- 色を扱う場合は[アクセシビリティ設計](accessibility.md)の
  カラーパレットとコントラスト基準に従う
