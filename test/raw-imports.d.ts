// vitest（Vite）の「?raw」インポートでファイル内容を文字列として読み込むための型定義
// （tsconfigはWorkers専用のためnode:fsの型を持ち込まず、こちらを使う）
declare module '*?raw' {
  const content: string;
  export default content;
}
