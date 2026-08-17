// HTMLページへ配信するContent-Security-Policyの組み立て
//
// 静的アセット（JS・CSS・画像）のCSPはpublic/_headersが担う。
// HTMLだけはWorkerが処理し、リクエストごとに異なるnonceをscript・styleタグと
// CSPへ同時に差し込む。nonceは毎回変える必要がある（HTMLに書かれた値は
// 攻撃者からも読めるため、固定値だと同じnonceを付けたタグを注入されて突破される）。

/** WorkerがHTMLとして処理するパス。ここに載せたパスはwrangler.jsoncの
 * run_worker_firstにも含めること（載っていないとWorkerが起動せず、
 * nonceの無い_headers側のCSPで配信される） */
export const HTML_PATHS: readonly string[] = [
  '/',
  '/index.html',
  '/about',
  '/about.html',
  '/404.html',
];

/** そのパスをWorkerがHTMLとして処理するか */
export function isHtmlPath(pathname: string): boolean {
  return HTML_PATHS.includes(pathname);
}

/**
 * HTMLページ向けのCSPを組み立てる
 *
 * script-srcは新しいブラウザから順に効くよう並べている。前の段が効く環境では
 * 後ろの段は無視されるため、全体としては「解釈できる中で最も厳しい規則」が働く。
 * 1. nonce + `'strict-dynamic'`（CSP3）: nonce付きスクリプトと、それが読み込む
 *    スクリプトだけを信頼する。外部スクリプト（アクセス解析）もHTML内のタグに
 *    nonceが付くことで読み込まれる。この段が効くとき、以降はすべて無視される
 * 2. `https:` `http:`（nonceは解釈するが`'strict-dynamic'`を解釈しない環境）:
 *    スキーム指定として働き、httpsで配信されるスクリプトはすべて通る。1より
 *    緩いが、nonce付きスクリプトが動的に読み込むスクリプトが黙ってブロック
 *    されるのを防ぐ後方互換。この段では`'unsafe-inline'`はnonceがあるため無視され、
 *    `http:`の取得は`upgrade-insecure-requests`でhttpsへ格上げされる
 * 3. `'unsafe-inline'`（nonceも解釈しない古い環境）: nonceによる無効化が
 *    効かないため、2のスキーム指定と同時に効く。最後の後方互換
 *
 * Trusted Typesのポリシー名はpublic/app.jsのcreatePolicyと一致させること
 */
export function buildHtmlCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' https: http: 'unsafe-inline'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self'",
    "connect-src 'self' https://cloudflareinsights.com",
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "require-trusted-types-for 'script'",
    'trusted-types fursuitweather-sw',
    'upgrade-insecure-requests',
  ].join('; ');
}
