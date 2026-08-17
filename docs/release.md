# リリース手順

バージョニングの方針と、GitHubリリースの作成手順です。

## バージョニング方針

[セマンティックバージョニング](https://semver.org/lang/ja/)に従います。

- patch（`v1.0.0` → `v1.0.1`）: 不具合修正・文言や見た目の調整
- minor（`v1.0.0` → `v1.1.0`）: 後方互換の機能追加・改善
- major（`v1.0.0` → `v2.0.0`）: 予報ロジックや公開APIの互換性が変わる変更

## 手順

1. バージョン表記を更新する
   - `package.json`の`version`
   - フッターのバージョン表記（`index.html`・`about.html`・`404.html`）
   - 不一致はhtmlSyncテストがCIで検出します
2. PRを作成してmainへマージする（マージで本番デプロイが走る）
3. mainのマージコミットへタグを付けてプッシュする

   ```bash
   git fetch origin main
   git tag vX.Y.Z origin/main
   git push origin vX.Y.Z
   ```

4. `release.yml`が起動し、GitHubリリースを自動作成する
   （リリースノートは前回リリース以降のマージ済みPRから自動生成）

## 補足

- 本番デプロイはmainへのマージ時（`deploy.yml`）に行われます。
  タグ・リリースはデプロイとは独立した「どの時点が何だったか」の記録です
- タグとpackage.jsonのバージョンが一致しない場合、
  `release.yml`はリリースを作成せず失敗します（付け間違いの検出）
