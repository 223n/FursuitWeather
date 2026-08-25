// vitest（Vite）の「?raw」インポートでファイル内容を文字列として読み込むための型定義
// （tsconfigはWorkers専用のためnode:fsの型を持ち込まず、こちらを使う）
declare module '*?raw' {
  const content: string;
  export default content;
}

// CSSだけはvitestが専用パイプラインで処理するため「?raw」でも空文字列になり、
// htmlSync.test.tsのstyle.css読み込みに限りnode:fsを使う。tsconfigのtypesは
// workers-typesに限定しているため、@types/nodeは入れず使う関数だけを宣言する
declare module 'node:fs' {
  export function readFileSync(path: URL | string, encoding: 'utf8'): string;
}

// import.meta.url（fsで読むときの相対パスの基準）。ES2022のlibにはプロパティ
// 定義がないためここで補完する
interface ImportMeta {
  readonly url: string;
}
