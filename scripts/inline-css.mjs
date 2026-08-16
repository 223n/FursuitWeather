// デプロイ時にHTMLページのCSSをインライン化するスクリプト
// 外部CSSはレンダリングをブロックするため（PageSpeed指摘: 推定300ms）、
// minify後のstyle.cssを各ページの<style>として埋め込み、リクエストを1つ削減する。
// style.css自体も配信は残す（開発時の参照とキャッシュ用）
import { readFileSync, writeFileSync } from 'node:fs';

const LINK_TAG = '<link rel="stylesheet" href="/style.css">';
const PAGES = ['public/index.html', 'public/about.html', 'public/404.html'];

const css = readFileSync('public/style.css', 'utf8');

for (const page of PAGES) {
  const html = readFileSync(page, 'utf8');
  const replaced = html.replace(LINK_TAG, `<style>${css}</style>`);
  if (replaced === html) {
    throw new Error(`${page}に${LINK_TAG}が見つかりません`);
  }
  writeFileSync(page, replaced);
  console.log(`${page}: CSSをインライン化しました（${(css.length / 1024).toFixed(1)}KB）`);
}
