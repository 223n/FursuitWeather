// Markdownを求めるクライアント（AIエージェントなど）への、ページのMarkdown版の配信
//
// 同じURLで、Acceptヘッダーがtext/markdownを求めるときだけMarkdown版を返し、
// ブラウザには従来どおりHTMLを返す（コンテンツネゴシエーション）。
// Markdown版はpublic/の手書きのファイル（HTMLのUI部品を除いた本文）で、
// HTMLとの内容の同期はtest/markdownPages.test.tsが検証する。

/** HTMLページのパスと、そのMarkdown版（public/の静的ファイル）の対応。
 * 404.htmlは存在しないパス全般に返るページのため対象外にする */
const MARKDOWN_PAGES: ReadonlyMap<string, string> = new Map([
  ['/', '/index.md'],
  ['/index.html', '/index.md'],
  ['/about', '/about.md'],
  ['/about.html', '/about.md'],
  ['/display', '/display.md'],
  ['/display.html', '/display.md'],
  ['/emergency', '/emergency.md'],
  ['/emergency.html', '/emergency.md'],
]);

/** そのページのMarkdown版のパス（無ければundefined） */
export function markdownPathFor(pathname: string): string | undefined {
  return MARKDOWN_PAGES.get(pathname);
}

/** Acceptヘッダーの1要素から、メディアタイプとq値を取り出す */
function parseMediaRange(part: string): { type: string; q: number } {
  const [type = '', ...params] = part.split(';').map((s) => s.trim().toLowerCase());
  const qParam = params.find((p) => p.startsWith('q='));
  const q = qParam === undefined ? 1 : Number(qParam.slice(2));
  return { type, q: Number.isFinite(q) ? q : 0 };
}

/**
 * AcceptヘッダーがHTMLよりMarkdownを優先しているか。
 * text/markdownが明示され、そのq値が0より大きく、かつtext/html以上のときだけtrue。
 * ブラウザはtext/markdownを送らないため、通常の閲覧は常にHTMLのまま。
 * ワイルドカード（*\/*・text/*）はどちらの優先にも数えない
 */
export function prefersMarkdown(accept: string | null): boolean {
  if (accept === null) {
    return false;
  }
  let markdown = 0;
  let html = 0;
  for (const part of accept.split(',')) {
    const { type, q } = parseMediaRange(part);
    if (type === 'text/markdown') {
      markdown = Math.max(markdown, q);
    } else if (type === 'text/html') {
      html = Math.max(html, q);
    }
  }
  return markdown > 0 && markdown >= html;
}

/**
 * Markdown版の応答を組み立てる。Markdown版の取得に失敗したときはnullを返し、
 * 呼び出し側はHTMLの配信へ戻る（Markdown版の欠落でページ自体を壊さない）
 */
export async function markdownResponse(
  assets: Fetcher,
  requestUrl: string,
  markdownPath: string,
): Promise<Response | null> {
  const asset = await assets.fetch(new URL(markdownPath, requestUrl));
  if (!asset.ok) {
    return null;
  }
  const headers = new Headers(asset.headers);
  headers.set('Content-Type', 'text/markdown; charset=utf-8');
  // 同じURLでHTMLとMarkdownを出し分けるため、キャッシュにAcceptで分けさせる
  headers.append('Vary', 'Accept');
  return new Response(asset.body, { status: 200, headers });
}

/** HTML版の応答に付ける、Markdown版の場所を示すLinkヘッダーの値 */
export function markdownAlternateLink(markdownPath: string): string {
  return `<${markdownPath}>; rel="alternate"; type="text/markdown"`;
}
