// デプロイ時にHTMLページのCSSをインライン化するスクリプト
// 外部CSSはレンダリングをブロックするため（PageSpeed指摘: 推定300ms）、
// minify後のstyle.cssを各ページの<style>として埋め込み、リクエストを1つ削減する。
// style.css自体も配信は残す（開発時の参照とキャッシュ用）
import { createHash } from 'node:crypto';
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

// インライン化した<style>をCSPのハッシュで許可する。
// style-srcに'unsafe-inline'を残さずに済ませるため、埋め込んだCSSそのものから
// sha256を計算して_headersのプレースホルダーへ差し込む。
// （'unsafe-inline'も併記してあるが、ハッシュを解釈できるブラウザでは無視される。
//   古いブラウザ向けの後方互換用）
const HEADERS_FILE = 'public/_headers';
const PLACEHOLDER = '__INLINE_STYLE_HASH__';
const hash = `'sha256-${createHash('sha256').update(css, 'utf8').digest('base64')}'`;
const headers = readFileSync(HEADERS_FILE, 'utf8');
if (!headers.includes(PLACEHOLDER)) {
  throw new Error(`${HEADERS_FILE}に${PLACEHOLDER}が見つかりません`);
}
writeFileSync(HEADERS_FILE, headers.replaceAll(PLACEHOLDER, hash));
console.log(`${HEADERS_FILE}: インラインCSSのハッシュを設定しました（${hash}）`);
