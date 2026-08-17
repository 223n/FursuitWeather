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
 * - `'strict-dynamic'`: nonce付きスクリプトが読み込むスクリプトも信頼する。
 *   これがあるとホスト許可リストは無視されるため、外部スクリプト
 *   （アクセス解析）もHTML内のタグにnonceが付くことで読み込まれる
 * - `'unsafe-inline'`: nonceを解釈できない古いブラウザ向けの後方互換。
 *   nonce対応ブラウザでは無視される
 * - Trusted Typesのポリシー名はpublic/app.jsのcreatePolicyと一致させること
 */
export function buildHtmlCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline'`,
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
