// HTMLページへ配信するContent-Security-Policyの組み立てと、HTMLへのnonce差し込み
//
// 静的アセット（JS・CSS・画像）のCSPはpublic/_headersが担う。
// HTMLだけはWorkerが処理し、リクエストごとに異なるnonceをscript・styleタグと
// CSPへ同時に差し込む。nonceは毎回変える必要がある（HTMLに書かれた値は
// 攻撃者からも読めるため、固定値だと同じnonceを付けたタグを注入されて突破される）。

import type { OgSummary } from './ogp';
import { FORECAST_PRELOAD_PREFIX, forecastPreloadHref, type PreloadQuery } from './preload';

/** WorkerがHTMLとして処理するパス。ここに載せたパスはwrangler.jsoncの
 * run_worker_firstにも含めること（載っていないとWorkerが起動せず、
 * nonceの無い_headers側のCSPで配信される） */
export const HTML_PATHS: readonly string[] = [
  '/',
  '/index.html',
  '/about',
  '/about.html',
  '/display',
  '/display.html',
  '/emergency',
  '/emergency.html',
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
 * Trusted Typesのポリシー名はpublic/app.js・public/display.jsのcreatePolicyと一致させること
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

/**
 * HTMLへリクエストごとのnonceを差し込んで返す
 *
 * script・styleタグとCSPへ同じnonceを入れることで、ホスト許可リストに頼らず
 * 「このページが載せたスクリプトだけ」を実行できる。JSON-LDは実行されない
 * データブロックのためnonceを付けない（付けても無害だが、実行対象と
 * 紛らわしいので明示的に除外する）。
 * nonceは毎回変わるため、共有キャッシュに載らないようno-storeを付ける
 *
 * @param og 指定時はOGP・Xカードのタイトル・説明メタタグを差し替える
 *   （リンクカードへの当日判定表示。src/ogp.tsのogSummaryForが組み立てる。
 *   setAttributeは属性値をエスケープするため、文言に判定ラベル等を含めても安全）
 */
export function withNonce(
  asset: Response,
  nonce: string,
  og?: OgSummary,
  preload?: PreloadQuery,
): Response {
  let rewriter = new HTMLRewriter()
    .on('script', {
      element(element): void {
        if (element.getAttribute('type') !== 'application/ld+json') {
          element.setAttribute('nonce', nonce);
        }
      },
    })
    .on('style', {
      element(element): void {
        element.setAttribute('nonce', nonce);
      },
    });

  if (og) {
    const { title, description } = og;
    // HTMLRewriterはカンマ区切りセレクタに対応しないため、タグごとに個別登録する
    // （セレクタと差し込む値の対応表に畳み、同形ハンドラの複製を避ける）
    const metaTargets: ReadonlyArray<readonly [string, string]> = [
      ['meta[property="og:title"]', title],
      ['meta[property="og:description"]', description],
      ['meta[name="twitter:title"]', title],
      ['meta[name="twitter:description"]', description],
    ];
    for (const [selector, content] of metaTargets) {
      rewriter = rewriter.on(selector, {
        element(element): void {
          element.setAttribute('content', content);
        },
      });
    }
  }

  // API先読みのhrefを、このリクエストで実際に取得されるURLへ合わせる
  // （合わせられないときはリンクごと外す。詳細はsrc/preload.ts）
  if (preload !== undefined) {
    rewriter = rewriter.on('link[rel="preload"]', {
      element(element): void {
        const href = element.getAttribute('href');
        if (href === null || !href.startsWith(FORECAST_PRELOAD_PREFIX)) {
          return;
        }
        if (preload === null) {
          element.remove();
          return;
        }
        element.setAttribute('href', forecastPreloadHref(href, preload));
      },
    });
  }

  const rewritten = rewriter.transform(asset);

  const headers = new Headers(rewritten.headers);
  headers.set('Content-Security-Policy', buildHtmlCsp(nonce));
  headers.set('Cache-Control', 'no-store');
  return new Response(rewritten.body, {
    status: rewritten.status,
    statusText: rewritten.statusText,
    headers,
  });
}
