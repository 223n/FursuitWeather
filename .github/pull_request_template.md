<!-- UI文言・コメント・コミットメッセージ・ドキュメントは日本語で書きます（CLAUDE.md） -->

## 概要

<!-- 何を・なぜ変えるのかを1〜3行で -->

## 変更内容

-

## 関連issue

<!-- 例：Fixes #123（なければ「なし」） -->

## 確認事項

- [ ] `npm test` が通る
- [ ] `npm run lint` が通る（ESLint + `tsc --noEmit`）
- [ ] `npm run test:coverage` が通る（`src/`はstatements・lines・functions 100%）
- [ ] UIに触れた場合、E2E（`npm run test:e2e`）が通る
- [ ] 文言・しきい値の複製箇所を両側そろえた（htmlSync同期テスト。`src/constants/`とHTML、`docs/`、`public/llms.txt`など）
- [ ] 安全情報のUIに触れた場合、色だけに依存しない表示（記号+文字の併記）とCUD配色を守った（`docs/accessibility.md`）
- [ ] `npm run build` を実行した場合、未コミットの`public/`編集がない状態で実行し、検証後に`git checkout -- public/`で復元した

## 動作確認

<!-- `npm run dev`（http://localhost:8787、?demo=1で上流なしのデモ表示）での確認内容やスクリーンショットなど -->
