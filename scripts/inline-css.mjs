// デプロイ時にHTMLページのCSSをインライン化するスクリプト
// 外部CSSはレンダリングをブロックするため（PageSpeed指摘: 推定300ms）、
// minify後のCSSを各ページの<style>として埋め込み、リクエストを削減する。
// CSS自体も配信は残す（開発時の参照とキャッシュ用）
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

// public/直下の全HTMLを自動対象にする（ページ追加時の列挙漏れを防ぐ）。
// 全ページが共通のstyle.cssを読み、会場表示モードだけ専用のdisplay.cssを
// 追加で読む（通常ページの配信サイズへ専用CSSを混ぜないための分離）。
// リンクタグが1つでも見つからないページはビルド失敗になる
const COMMON_TAG = '<link rel="stylesheet" href="/style.css">';
const DISPLAY_TAG = '<link rel="stylesheet" href="/display.css">';
const CSS_SOURCES = {
  [COMMON_TAG]: readFileSync('public/style.css', 'utf8'),
  [DISPLAY_TAG]: readFileSync('public/display.css', 'utf8'),
};

const PAGES = readdirSync('public')
  .filter((file) => file.endsWith('.html'))
  .map((file) => `public/${file}`)
  .sort();

for (const page of PAGES) {
  const tags = page === 'public/display.html' ? [COMMON_TAG, DISPLAY_TAG] : [COMMON_TAG];
  let html = readFileSync(page, 'utf8');
  for (const tag of tags) {
    const css = CSS_SOURCES[tag];
    // 置換値は関数で渡す: 文字列で渡すとCSS中の $' や $& などが
    // String.replaceの置換パターンとして解釈され、HTMLを静かに破壊するため
    const replaced = html.replace(tag, () => `<style>${css}</style>`);
    if (replaced === html) {
      throw new Error(`${page}に${tag}が見つかりません`);
    }
    html = replaced;
  }
  writeFileSync(page, html);
  console.log(`${page}: CSSをインライン化しました（${tags.length}ファイル）`);
}

// インライン化した<style>をCSPのハッシュで許可する。
// style-srcに'unsafe-inline'を残さずに済ませるため、埋め込んだCSSそのものから
// sha256を計算して_headersのプレースホルダーへ差し込む。
// （'unsafe-inline'も併記してあるが、ハッシュを解釈できるブラウザでは無視される。
//   古いブラウザ向けの後方互換用）
const HEADERS_FILE = 'public/_headers';
const PLACEHOLDER = '__INLINE_STYLE_HASH__';
const hashes = Object.values(CSS_SOURCES)
  .map((css) => `'sha256-${createHash('sha256').update(css, 'utf8').digest('base64')}'`)
  .join(' ');
const headers = readFileSync(HEADERS_FILE, 'utf8');
if (!headers.includes(PLACEHOLDER)) {
  throw new Error(`${HEADERS_FILE}に${PLACEHOLDER}が見つかりません`);
}
writeFileSync(HEADERS_FILE, headers.replaceAll(PLACEHOLDER, hashes));
console.log(`${HEADERS_FILE}: インラインCSSのハッシュを設定しました（${hashes}）`);
