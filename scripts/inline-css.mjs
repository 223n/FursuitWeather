// デプロイ時にトップページのCSSをインライン化するスクリプト
// 外部CSSはレンダリングをブロックするため（PageSpeed指摘: 推定300ms）、
// minify後のstyle.cssをindex.htmlの<style>として埋め込み、リクエストを1つ削減する。
// about.htmlなど他ページは外部CSS参照のままとする（キャッシュが効くため）
import { readFileSync, writeFileSync } from 'node:fs';

const LINK_TAG = '<link rel="stylesheet" href="/style.css">';

const css = readFileSync('public/style.css', 'utf8');
const html = readFileSync('public/index.html', 'utf8');

const replaced = html.replace(LINK_TAG, `<style>${css}</style>`);
if (replaced === html) {
  throw new Error(`index.htmlに${LINK_TAG}が見つかりません`);
}

writeFileSync('public/index.html', replaced);
console.log(`CSSをインライン化しました（${(css.length / 1024).toFixed(1)}KB）`);
