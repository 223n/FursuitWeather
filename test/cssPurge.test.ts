// ページごとのCSSインライン化（scripts/purge-css.mjs）の安全網
//
// 配信HTMLへ埋め込むCSSから、そのページで使われない規則を落としている。
// 落としすぎると見た目が黙って壊れるが、E2Eはwrangler devがソースを配信するため
// ビルド後のHTMLを見られない（CLAUDE.md）。そこで、落として良い条件を
// ここで機械検証する。
//
// 検証の柱は2つ:
// 1. ページのHTML・JSに文字列として現れるクラスの規則は必ず残ること
// 2. JSが組み立てるクラス名（`grade-${n}`など）の接頭辞が、
//    DYNAMIC_CLASS_PREFIXESへ漏れなく登録されていること
//    （1では拾えない。登録漏れが唯一の「静かに壊れる」経路のため、
//    ブラウザJSを走査して未登録の接頭辞を検出する）

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DYNAMIC_CLASS_PREFIXES,
  purgeCss,
  purgeHaystack,
  selectorNames,
} from '../scripts/purge-css.mjs';

// CSSは「?raw」ではなくfsで読む（vitestはCSSを専用パイプラインで処理するため、
// ?raw指定でも空文字列になる。test/htmlSync.test.tsと同じ理由）
const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const styleCss = read('public/style.css');
const displayCss = read('public/display.css');

/** ページと、そこへ埋め込むCSS（scripts/inline-css.mjsの割り当てと同じ） */
const PAGES = [
  { file: 'public/index.html', css: [styleCss] },
  { file: 'public/about.html', css: [styleCss] },
  { file: 'public/display.html', css: [styleCss, displayCss] },
  { file: 'public/emergency.html', css: [styleCss] },
  { file: 'public/404.html', css: [styleCss] },
] as const;

/** ブラウザJS（動的クラス名の走査対象） */
const BROWSER_JS = ['public/app.js', 'public/display.js', 'public/wbgt-tool.js', 'public/prefs.js'];

/** CSSに定義されているクラス名・ID名をすべて集める */
function definedNames(css: string): Set<string> {
  const names = new Set<string>();
  for (const match of css.matchAll(/^[^{}]*\{/gm)) {
    for (const name of selectorNames(match[0])) {
      names.add(name);
    }
  }
  return names;
}

const allDefined = new Set([...definedNames(styleCss), ...definedNames(displayCss)]);

describe('動的クラス名の接頭辞の登録', () => {
  // テンプレートリテラルの `${` の直前に続く語をすべて拾う。
  // クラス名の組み立てだけを狙って構文を限定すると、別の書き方で増えたときに
  // 見逃すため、あらゆる `${` を対象にしてCSS側の定義と突き合わせる
  const tokens = new Map<string, string[]>();
  for (const file of BROWSER_JS) {
    for (const match of read(file).matchAll(/([\w-]+)\$\{/g)) {
      const token = match[1] as string;
      tokens.set(token, [...(tokens.get(token) ?? []), file]);
    }
  }

  it('走査対象のブラウザJSから、動的に組み立てる語が拾えている', () => {
    // 走査自体が空振りしていないことの確認（正規表現が壊れると検証が無言で無効になる）
    expect(tokens.size).toBeGreaterThan(3);
  });

  it('CSSのクラスに掛かる接頭辞はすべてDYNAMIC_CLASS_PREFIXESにある', () => {
    const missing: string[] = [];
    for (const [token, files] of tokens) {
      // その語で始まるクラスがCSSにあり、かつどのページのテキストにも
      // 文字列として現れない＝purgeの照合では拾えないもの
      const hidden = [...allDefined].filter(
        (name) =>
          name.startsWith(token) &&
          name !== token &&
          !PAGES.some(({ file }) => purgeHaystack(read(file)).includes(name)),
      );
      if (hidden.length === 0) {
        continue;
      }
      if (!DYNAMIC_CLASS_PREFIXES.some((prefix) => hidden[0]?.startsWith(prefix))) {
        missing.push(`${token} （${files.join(', ')} / 例: .${hidden[0]}）`);
      }
    }
    expect(missing, 'DYNAMIC_CLASS_PREFIXESへの登録が漏れています').toEqual([]);
  });

  it('登録済みの接頭辞は実際にCSSのクラスへ掛かっている', () => {
    // 使われなくなった接頭辞が残り続けると、purgeが効かない範囲が広がる
    for (const prefix of DYNAMIC_CLASS_PREFIXES) {
      const hit = [...allDefined].some((name) => name.startsWith(prefix) && name !== prefix);
      expect(hit, `${prefix} で始まるクラスがCSSにありません`).toBe(true);
    }
  });
});

describe('purgeCssはページで使われる規則を落とさない', () => {
  it.each(PAGES.map((page) => [page.file, page] as const))('%s', (_file, page) => {
    const haystack = purgeHaystack(read(page.file));
    for (const css of page.css) {
      const purged = purgeCss(css, haystack);
      const dropped = [...definedNames(css)].filter(
        (name) => haystack.includes(name) && !purged.includes(name),
      );
      expect(dropped, '使われている名前の規則が落ちています').toEqual([]);
    }
  });
});

describe('purgeCssは使われない規則を実際に落とす', () => {
  // no-op化（安全側に倒しすぎて何も落ちない）を検出する。
  // 削減が消えていることに気付けないと、この仕組み自体が意味を失う
  // 名前を選ぶときの注意: `.day-card`のように、別のページで使う名前と
  // 組み合わさった規則（`.day-card .weather-line`）を持つものは残る。
  // 1つでも残す条件に当たれば規則ごと残す（安全側）ためで、ここでは
  // どのページでも使われず完全に消える名前だけを見る
  it.each([
    ['public/404.html', 'timer-panel'],
    ['public/404.html', 'hours-table'],
    ['public/emergency.html', 'board-card'],
    ['public/emergency.html', 'search-results-box'],
    ['public/display.html', 'wear-log-section'],
    ['public/display.html', 'timer-panel'],
  ] as const)('%s から .%s の規則が落ちる', (file, name) => {
    expect(allDefined.has(name), `.${name}がCSSに定義されていません`).toBe(true);
    const purged = purgeCss(styleCss, purgeHaystack(read(file)));
    expect(purged).not.toContain(`.${name}`);
  });

  it('判定UIを持たないページでは半分以上の規則が落ちる', () => {
    const purged = purgeCss(styleCss, purgeHaystack(read('public/404.html')));
    expect(purged.length).toBeLessThan(styleCss.length / 2);
  });
});

describe('purgeCssのCSS解釈', () => {
  it('クラス名・IDを持たないセレクタは常に残す', () => {
    expect(purgeCss('body{margin:0}', '')).toBe('body{margin:0}');
    expect(purgeCss(':root{--a:1}', '')).toBe(':root{--a:1}');
  });

  it('セレクタリストは使われている側だけを残す', () => {
    expect(purgeCss('.a,.b{color:red}', '.a')).toBe('.a{color:red}');
    expect(purgeCss('.a,.b{color:red}', 'x')).toBe('');
  });

  it('@mediaは中身を再帰処理し、空になれば丸ごと落とす', () => {
    expect(purgeCss('@media (min-width:1px){.a{color:red}}', 'a')).toBe(
      '@media (min-width:1px){.a{color:red}}',
    );
    expect(purgeCss('@media (min-width:1px){.a{color:red}}', 'x')).toBe('');
  });

  it('@containerも同じ扱いにする（会場表示モードが使う）', () => {
    expect(purgeCss('@container (max-height:200px){.a{display:none}}', 'x')).toBe('');
  });

  it('@font-face・@keyframesはセレクタを持たないため残す', () => {
    expect(purgeCss('@keyframes spin{0%{opacity:0}}', '')).toBe('@keyframes spin{0%{opacity:0}}');
  });

  it('文字列の中の波かっこ・カンマで規則の境界を誤らない', () => {
    expect(purgeCss('.a::after{content:"}"}.b{color:red}', '.a')).toBe('.a::after{content:"}"}');
    expect(purgeCss('.a[data-x="p,q"]{color:red}', 'x')).toBe('');
    expect(purgeCss(':is(.a,.b) .c{color:red}', 'c')).toBe(':is(.a,.b) .c{color:red}');
  });

  it('動的クラスの接頭辞に一致する規則は、文字列に現れなくても残す', () => {
    expect(purgeCss('.grade-3{color:red}', 'なにもない')).toBe('.grade-3{color:red}');
  });
});
