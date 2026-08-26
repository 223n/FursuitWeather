# リリース手順

バージョニングの方針と、GitHubリリースの作成手順です。

## バージョニング方針

[セマンティックバージョニング](https://semver.org/lang/ja/)に従います。

- patch（`v1.0.0` → `v1.0.1`）: 不具合修正・文言や見た目の調整
- minor（`v1.0.0` → `v1.1.0`）: 後方互換の機能追加・改善
- major（`v1.0.0` → `v2.0.0`）: 予報ロジックや公開APIの互換性が変わる変更

## 手順

1. バージョン表記を更新する

   ```bash
   npm version X.Y.Z --no-git-tag-version
   ```

   - 上のコマンドで`package.json`と`package-lock.json`が同時に
     更新されます（手で編集するとlock側が取り残されるため非推奨）
   - フッターのバージョン表記（`index.html`・`about.html`・`404.html`・`emergency.html`）と
     `display.html`のバージョンコメントも更新します
     （`package.json`との不一致はhtmlSyncテストがCIで検出）
   - 公開ページの内容を変えたときは`public/sitemap.xml`の`lastmod`も
     その日付へ更新します（登録漏れ・noindexページの混入は
     `test/sitemap.test.ts`がCIで検出しますが、日付の鮮度は検出しません）
2. PRを作成してmainへマージする（マージで本番デプロイが走る）
3. リリースを作成する。方法は2つあります
   - **Actionsタブから**: mainを対象に`Release`ワークフローを手動実行
     （Run workflow）します。この1回の実行の中で、package.jsonの
     バージョンでタグを作成し、続けてGitHubリリースまで作成します
   - **ローカルから**: mainのマージコミットへタグを付けてプッシュすると、
     タグpushで`release.yml`が起動してGitHubリリースを作成します

     ```bash
     git fetch origin main
     git tag vX.Y.Z origin/main
     git push origin vX.Y.Z
     ```

   リリースノートは、どちらの方法でも前回リリース以降のマージ済みPRから
   自動生成されます。

## 補足

- 本番デプロイはmainへのマージ時（`deploy.yml`）に行われます。
  タグ・リリースはデプロイとは独立した「どの時点が何だったか」の記録です
- タグpushで起動した場合、タグとpackage.jsonのバージョンが一致しないと
  リリースを作成せず失敗します（付け間違いの検出）。手動実行は
  package.jsonのバージョンを起点にタグを作るため、不一致は発生しません
- 手動実行はmain以外のブランチを選ばないでください（選んだrefの
  先頭コミットへタグが付きます）
- 途中で失敗した場合は`Release`ワークフローの手動実行をやり直せば
  復旧できます（作成済みのタグはスキップして続きから進みます）。
  リリース作成まで成功した後の再実行は「既に存在する」で失敗しますが、
  これは正常です

## 年次確認（毎年4月・環境省アラート提供開始時）

環境省の熱中症警戒アラート発表状況CSV（`/api/alert`が突合に使用。
例年おおむね4月下旬〜10月下旬提供）は、**年度で様式が変わることがあります**。
提供開始の時期に次を確認してください。

1. 当日のCSV（`https://www.wbgt.env.go.jp/alert/dl/{年}/alert_{当日}_05.csv`）を
   開き、`test/fixtures/alert-sample.csv`と様式（メタ情報行・
   `府県予報区`ヘッダー行・`都道府県コード`/`TargetDate1フラグ`列・
   FlagExplanationのフラグ体系）が同じかを見比べる
2. 様式が変わっていたら`src/logic/alert.ts`の解析を更新し、フィクスチャを
   新様式で差し替える（変わっていなければ何もしなくてよい）
3. 動作は`/api/alert?demo=1`（固定の発表例）と、発表のある日の実座標で確認できる

様式が変わって解析に失敗しても画面は黙って非表示になるだけで壊れませんが、
Workerのログに「アラート発表状況の解析失敗」が出続けます（Cloudflareの
observabilityログで検知できます）。
