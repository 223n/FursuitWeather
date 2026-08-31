// public/配下のブラウザJS同士の同期テスト
//
// app.js・display.js・wbgt-tool.jsは、それぞれ別のページで単独で動く素のJS
// （バンドラを持たないIIFE）のため、共通の小さな部品を意図的に複製している。
// 複製そのものは配信構成上の選択だが、放っておくと片方だけ直されて静かにずれる。
// 実際にdisplay.jsでは、app.jsが「単一情報源。個別のstartsWith複製は使わない」と
// 明記している低温判定が、生のstartsWith('cold')として2か所に散っていた。
//
// そこでhtmlSyncと同じ方針を取り、「複製してよいが、ずれたらCIが落ちる」形にする。
// 対象を増やすときはSHARED_*へ名前を足すだけでよい。
//
// 比較はコメントを除いたコードのみで行う（同じ実装に、ファイルごとの事情を
// 説明する別々のコメントを付けられるようにするため）

import { describe, expect, it } from 'vitest';
import appJs from '../public/app.js?raw';
import displayJs from '../public/display.js?raw';
import wbgtToolJs from '../public/wbgt-tool.js?raw';

/**
 * app.jsとdisplay.jsで実装が一致していなければならない関数
 * どちらのページでも意味が同じでなければならないものだけを載せる
 */
const SHARED_FUNCTIONS = [
  // 判定バッジの低温側の判別（暑熱と取り違えると安全側の表示が壊れる）
  'isColdLevel',
  // SVGスプライトからアイコン要素を作る
  'faIcon',
  // 記号設定（テキストと{icon}の混在配列）から表示要素群を作る
  'renderSymbolParts',
  // WMO天気コード→アイコン名（対応表がずれると別の天気を示す）
  'weatherIconName',
  'weatherWithLabel',
  // 読み上げの誤読対策（読み仮名の差し替え）
  'yomiOf',
  'yomiText',
  // 読み上げ専用・視覚のみのテキスト要素
  'srOnlySpan',
  'hiddenSpan',
  // 時刻文字列から時の数値を取り出す
  'hourNumberOf',
] as const;

/** app.jsとdisplay.jsで値が一致していなければならない定数 */
const SHARED_CONSTANTS = [
  // 判定段階ごとの記号（色に依存しない判別の要）
  'GRADE_SYMBOLS',
  // 日本時間への補正（ずれると別の時刻の判定を出す）
  'JST_OFFSET_MS',
  // 読み上げの読み仮名パターン
  'YOMI_PATTERN',
  // 取得する予報日数
  'FORECAST_DAYS',
] as const;

/** コメントを除き、空白を1つに詰めて比較用に正規化する */
function normalize(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 波かっこの対応を取って本文を切り出す
 * 文字列・テンプレートリテラル・コメントの中のかっこは数えない
 */
function blockAt(source: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipQuoted(source, i);
    } else if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 1;
    } else if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex, i + 1);
      }
    }
  }
  throw new Error('波かっこが閉じていません');
}

/** 引用符・バッククォートで始まる文字列を読み飛ばし、閉じ位置を返す */
function skipQuoted(source: string, openIndex: number): number {
  const quote = source[openIndex];
  for (let i = openIndex + 1; i < source.length; i += 1) {
    if (source[i] === '\\') {
      i += 1;
    } else if (source[i] === quote) {
      return i;
    }
  }
  return source.length;
}

/** 名前付き関数の本文（引数リストを含む）を取り出す */
function functionCode(source: string, name: string): string {
  const head = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  expect(head, `${name} の定義が見つかりません`).not.toBeNull();
  const start = (head as RegExpExecArray).index;
  const brace = source.indexOf('{', start);
  return normalize(source.slice(start, brace) + blockAt(source, brace));
}

/** const宣言の値（末尾のセミコロンまで）を取り出す */
function constantCode(source: string, name: string): string {
  const head = new RegExp(`const\\s+${name}\\s*=`).exec(source);
  expect(head, `${name} の定義が見つかりません`).not.toBeNull();
  const start = (head as RegExpExecArray).index + (head as RegExpExecArray)[0].length;
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipQuoted(source, i);
    } else if (ch === '{' || ch === '[' || ch === '(') {
      depth += 1;
    } else if (ch === '}' || ch === ']' || ch === ')') {
      depth -= 1;
    } else if (ch === ';' && depth === 0) {
      return normalize(source.slice(start, i));
    }
  }
  throw new Error(`${name} の宣言が終わっていません`);
}

describe('ブラウザJSの共通部品の同期', () => {
  it.each(SHARED_FUNCTIONS)('app.jsとdisplay.jsの %s は同じ実装', (name) => {
    expect(functionCode(displayJs, name)).toBe(functionCode(appJs, name));
  });

  it.each(SHARED_CONSTANTS)('app.jsとdisplay.jsの %s は同じ値', (name) => {
    expect(constantCode(displayJs, name)).toBe(constantCode(appJs, name));
  });

  it('app.jsとwbgt-tool.jsのGRADE_SYMBOLSは同じ値', () => {
    expect(constantCode(wbgtToolJs, 'GRADE_SYMBOLS')).toBe(constantCode(appJs, 'GRADE_SYMBOLS'));
  });

  it('低温判定の生のstartsWithはisColdLevelの中だけにある', () => {
    // 「単一情報源へ寄せる」という約束を、複製が再発しても気付ける形にする
    for (const [label, source] of [
      ['app.js', appJs],
      ['display.js', displayJs],
    ] as const) {
      const occurrences = [...source.matchAll(/startsWith\('cold'\)/g)];
      expect(occurrences, `${label} のstartsWith('cold')`).toHaveLength(1);
      expect(functionCode(source, 'isColdLevel')).toContain("startsWith('cold')");
    }
  });
});

describe('冷房要否バッジの同期（app.js ↔ wbgt-tool.js）', () => {
  // wbgt-tool.jsは固定ラベルを持つため定数全体は一致しない。
  // ラベル以外（配色gradeと記号symbol）が一致することを項目ごとに見る
  const appBadges = constantCode(appJs, 'COOLING_BADGES');
  const toolBadges = constantCode(wbgtToolJs, 'COOLING_BADGES');

  it.each(['required', 'recommended'] as const)('%s のgradeとsymbolが一致する', (key) => {
    const appEntry = new RegExp(`${key}: \\{ ([^}]*\\}[^}]*|[^}]*) \\}`).exec(appBadges);
    expect(appEntry, `app.jsの${key}が読めません`).not.toBeNull();
    expect(toolBadges).toContain((appEntry as RegExpExecArray)[1]);
  });

  it('none の記号はapp.jsのGRADE_SYMBOLS[0]（判定なしの◎）と一致する', () => {
    // app.js側のnoneはsymbolを持たず、createBadgeがGRADE_SYMBOLS[grade]へ落ちる。
    // wbgt-tool.jsは固定で持つため、その落ち先と同じであることを確かめる
    expect(appBadges).toContain('none: { grade: 0 }');
    const zero = /^\[(\['.'\])/.exec(constantCode(appJs, 'GRADE_SYMBOLS'));
    expect(zero, 'GRADE_SYMBOLS[0]が読めません').not.toBeNull();
    expect(toolBadges).toContain(`none: { grade: 0, symbol: ${(zero as RegExpExecArray)[1]}`);
  });
});
