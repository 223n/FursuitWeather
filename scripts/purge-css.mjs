// ページごとに使われないCSS規則を落とす（配信サイズの削減）
//
// 全ページが共通のstyle.cssを丸ごとインライン化していたため、判定UIを持たない
// ページ（404・応急対応）や会場表示モードにも、日別カード・タブ・タイマー・
// 当日ボードといった無関係な規則が埋め込まれていた。埋め込みはページ本体の
// バイト数に直結するため、そのページで名前が現れない規則だけを落とす。
//
// 判定の規則（意図的に「残す側へ倒す」）:
// - セレクタにクラス名・IDが1つも無い規則（body・table th・:rootなど）は常に残す
// - クラス名・IDのいずれかがページのテキストに現れたら残す。照合はトークン単位では
//   なく単純な部分一致にしてある。`.card`が`card-title`という別の語に引っかかって
//   残ることはあっても、使っているのに落ちることは起きにくくするため
// - JSが組み立てるクラス名（`grade-${n}`など）は文字列として現れないため、
//   DYNAMIC_CLASS_PREFIXESで接頭辞ごと残す。ここへの登録漏れは
//   test/cssPurge.test.tsが検出する（ブラウザJSを走査して照合する）
// - @media・@container・@supportsは中身を再帰処理し、空になったら丸ごと落とす
// - @font-face・@keyframesはセレクタを持たないため常に残す

import { existsSync, readFileSync } from 'node:fs';

/**
 * JSが実行時に組み立てるクラス名の接頭辞
 *
 * ページのHTML・JSに文字列として現れないため、purgeの照合では拾えない。
 * `public/*.js`のテンプレートリテラルから機械的に導ける形にしてあり、
 * 新しい動的クラスが増えたのに登録し忘れると
 * test/cssPurge.test.tsの「動的クラスの接頭辞はすべて登録されている」が落ちる
 */
export const DYNAMIC_CLASS_PREFIXES = Object.freeze([
  // createBadge: `badge grade-${summary.grade}` （判定バッジの段階別配色）
  'grade-',
  // weatherWithLabel: faIcon(iconName, `weather-${iconName}`) （天気アイコンの色）
  'weather-',
  // 会場表示モードの全国グリッド: `display-national-grid display-grid-cols-${cols}`
  'display-grid-cols-',
  // 会場表示モードの焼き付き防止: `display-body display-shift-${pixelShiftIndex}`
  'display-shift-',
]);

/**
 * CSSをトップレベルの規則へ切り分ける
 *
 * 文字列リテラル（content: "}" など）とコメントの中の波かっこを数えないよう、
 * 引用符とコメントを読み飛ばす。ブロックを持たないat規則（@charset・@import）は
 * セミコロンで1つの規則として切り出す
 */
function splitRules(css) {
  const rules = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      i = skipString(css, i);
    } else if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 1;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        rules.push(css.slice(start, i + 1));
        start = i + 1;
      }
    } else if (ch === ';' && depth === 0) {
      rules.push(css.slice(start, i + 1));
      start = i + 1;
    }
  }
  const rest = css.slice(start);
  if (rest.trim() !== '') {
    rules.push(rest);
  }
  return rules;
}

/** 引用符で始まる文字列を読み飛ばし、閉じ引用符の位置を返す */
function skipString(text, openIndex) {
  const quote = text[openIndex];
  for (let i = openIndex + 1; i < text.length; i += 1) {
    if (text[i] === '\\') {
      i += 1;
    } else if (text[i] === quote) {
      return i;
    }
  }
  return text.length;
}

/**
 * セレクタリストをトップレベルのカンマで分ける
 *
 * `:is(.a, .b)`や`[data-x="a,b"]`の中のカンマで切らないよう、
 * かっこの深さと引用符を見る
 */
function splitSelectorList(selectorList) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selectorList.length; i += 1) {
    const ch = selectorList[i];
    if (ch === '"' || ch === "'") {
      i = skipString(selectorList, i);
    } else if (ch === '(' || ch === '[') {
      depth += 1;
    } else if (ch === ')' || ch === ']') {
      depth -= 1;
    } else if (ch === ',' && depth === 0) {
      parts.push(selectorList.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(selectorList.slice(start));
  return parts.filter((part) => part.trim() !== '');
}

/** セレクタに現れるクラス名・ID名を集める */
export function selectorNames(selector) {
  return [...selector.matchAll(/[.#](-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]);
}

/** その名前をページが使っている可能性があるか（部分一致・動的接頭辞） */
function nameKept(name, haystack, prefixes) {
  return prefixes.some((prefix) => name.startsWith(prefix)) || haystack.includes(name);
}

/** そのセレクタを残すか（クラス名・IDを持たないセレクタは常に残す） */
function selectorKept(selector, haystack, prefixes) {
  const names = selectorNames(selector);
  return names.length === 0 || names.some((name) => nameKept(name, haystack, prefixes));
}

/** 中身を再帰処理するat規則（条件付きグループ規則） */
const NESTED_AT_RULE = /^@(?:media|supports|container|layer|scope)\b/i;

/**
 * ページで使われない規則を落としたCSSを返す
 *
 * @param css 対象のCSS（minify済み・未minifyのどちらでもよい）
 * @param haystack そのページのHTMLと、読み込むローカルJSを連結したテキスト
 * @param prefixes 実行時に組み立てられるクラス名の接頭辞
 */
export function purgeCss(css, haystack, prefixes = DYNAMIC_CLASS_PREFIXES) {
  let kept = '';
  for (const rule of splitRules(css)) {
    const braceIndex = rule.indexOf('{');
    if (braceIndex === -1) {
      // ブロックを持たないat規則（@charset・@import）はそのまま残す
      kept += rule;
      continue;
    }
    const head = rule.slice(0, braceIndex);
    const body = rule.slice(braceIndex + 1, rule.lastIndexOf('}'));
    if (head.trim().startsWith('@')) {
      if (NESTED_AT_RULE.test(head.trim())) {
        const inner = purgeCss(body, haystack, prefixes);
        if (inner.trim() !== '') {
          kept += `${head}{${inner}}`;
        }
        continue;
      }
      // @font-face・@keyframesなどセレクタを持たないat規則は判定できないため残す
      kept += rule;
      continue;
    }
    const selectors = splitSelectorList(head).filter((selector) =>
      selectorKept(selector, haystack, prefixes),
    );
    if (selectors.length > 0) {
      kept += `${selectors.join(',')}{${body}}`;
    }
  }
  return kept;
}

/** ページが読み込むローカルJSのsrc（外部URLは対象外） */
const LOCAL_SCRIPT_SRC = /<script[^>]*\ssrc="(\/[\w.-]+\.js)"/g;

/**
 * purgeの照合に使うテキストを組み立てる
 *
 * そのページのHTMLと、ページが読み込むローカルJSを連結する。JSの一覧は
 * HTMLのscriptタグから引くため、ページとスクリプトの対応をここへ書き写さずに済む
 * （書き写すと、スクリプトを増やしたときに更新漏れで規則が黙って落ちる）。
 * HTMLはコメントを含んだまま渡す前提。コメント内でしか触れられていないクラスも
 * 残す側へ倒すため（コメント除去はインライン化の後段が行う）
 */
export function purgeHaystack(html) {
  const scripts = [...html.matchAll(LOCAL_SCRIPT_SRC)]
    .map((match) => `public${match[1]}`)
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file, 'utf8'));
  return [html, ...scripts].join('\n');
}
