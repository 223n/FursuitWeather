// デプロイ時にHTMLページのCSSをインライン化するスクリプト
// 外部CSSはレンダリングをブロックするため（PageSpeed指摘: 推定300ms）、
// minify後のstyle.cssを各ページの<style>として埋め込み、リクエストを1つ削減する。
// style.css自体も配信は残す（開発時の参照とキャッシュ用）
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const LINK_TAG = '<link rel="stylesheet" href="/style.css">';
// public/直下の全HTMLを自動対象にする（ページ追加時の列挙漏れを防ぐ）。
// リンクタグのないページはビルド失敗になるため、対象外にしたいページが
// 生じた時点で明示的な除外リストを導入する
const PAGES = readdirSync('public')
  .filter((file) => file.endsWith('.html'))
  .map((file) => `public/${file}`)
  .sort();

const css = readFileSync('public/style.css', 'utf8');

for (const page of PAGES) {
  const html = readFileSync(page, 'utf8');
  // 置換値は関数で渡す: 文字列で渡すとCSS中の $' や $& などが
  // String.replaceの置換パターンとして解釈され、HTMLを静かに破壊するため
  const replaced = html.replace(LINK_TAG, () => `<style>${css}</style>`);
  if (replaced === html) {
    throw new Error(`${page}に${LINK_TAG}が見つかりません`);
  }
  writeFileSync(page, replaced);
  console.log(`${page}: CSSをインライン化しました（${(css.length / 1024).toFixed(1)}KB）`);
}
