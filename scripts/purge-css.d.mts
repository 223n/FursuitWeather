// scripts/purge-css.mjs の型宣言（テストから型付きで使うため）
// 実体は素のJSで書く（ビルドスクリプトはNodeが直接実行するためTSにしない）

/** JSが実行時に組み立てるクラス名の接頭辞 */
export declare const DYNAMIC_CLASS_PREFIXES: readonly string[];

/** セレクタに現れるクラス名・ID名を集める */
export declare function selectorNames(selector: string): string[];

/** ページで使われない規則を落としたCSSを返す */
export declare function purgeCss(
  css: string,
  haystack: string,
  prefixes?: readonly string[],
): string;

/** purgeの照合に使うテキスト（ページのHTML+読み込むローカルJS）を組み立てる */
export declare function purgeHaystack(html: string): string;
