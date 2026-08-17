// HTMLページ向けCSPの組み立てとパス判定のテスト

import { describe, expect, it } from 'vitest';
import headers from '../public/_headers?raw';
import wranglerConfig from '../wrangler.jsonc?raw';
import appJs from '../public/app.js?raw';
import { HTML_PATHS, buildHtmlCsp, isHtmlPath } from '../src/csp';

describe('isHtmlPath', () => {
  it.each(['/', '/index.html', '/about', '/about.html', '/404.html'])(
    '%s はHTMLとして処理する',
    (path) => {
      expect(isHtmlPath(path)).toBe(true);
    },
  );

  it.each(['/app.js', '/style.css', '/sw.js', '/events.json', '/api/forecast', '/favicon.svg'])(
    '%s はHTMLとして処理しない（アセット配信のまま）',
    (path) => {
      expect(isHtmlPath(path)).toBe(false);
    },
  );
});

describe('buildHtmlCsp', () => {
  const csp = buildHtmlCsp('test-nonce-value');

  /** CSPから指定ディレクティブの値を取り出す */
  function directive(name: string): string {
    const match = csp.match(new RegExp(`(?:^|;)\\s*${name}\\s+([^;]+)`));
    expect(match, `CSPに${name}がありません`).not.toBeNull();
    return match![1]!.trim();
  }

  it('scriptとstyleを同じnonceで許可する', () => {
    expect(csp).toContain("script-src 'nonce-test-nonce-value'");
    expect(csp).toContain("style-src 'self' 'nonce-test-nonce-value'");
  });

  it("'strict-dynamic'でホスト許可リストに頼らない", () => {
    expect(directive('script-src')).toContain("'strict-dynamic'");
    // 許可リスト方式の名残が残っていないこと（strict-dynamicで無視されるため
    // 書いてあると誤解を生む）
    expect(csp).not.toContain('static.cloudflareinsights.com');
  });

  it('古いブラウザ向けの後方互換を、効く順に併記する', () => {
    // 前の段を解釈できる環境では後ろの段は無視される。並び順自体はCSPの
    // 意味を変えないが、段階が読み取れるよう厳しい順に書いている
    expect(directive('script-src').split(/\s+/)).toEqual([
      "'nonce-test-nonce-value'", // CSP3: これと'strict-dynamic'が効く環境では以降は無視される
      "'strict-dynamic'",
      'https:', // CSP2（nonceは解釈するが'strict-dynamic'は解釈しない環境）向け
      'http:',
      "'unsafe-inline'", // CSP1（nonce非対応）向け
    ]);
  });

  it('スクリプトの緩和はスキームの併記までで、任意実行を許さない', () => {
    const scriptSrc = directive('script-src');
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    // ワイルドカードはstrict-dynamic非対応環境でも書かない
    expect(scriptSrc).not.toContain('*');
  });

  it('既定拒否・Trusted Types・埋め込み禁止は_headers側と同じ強度を保つ', () => {
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it('Trusted Typesのポリシー名がapp.jsのcreatePolicyと一致する', () => {
    const policy = csp.match(/trusted-types ([^;]+)/)![1]!.trim();
    expect(appJs).toContain(`createPolicy('${policy}'`);
  });

  it('nonceが変われば別のCSPになる', () => {
    expect(buildHtmlCsp('a')).not.toBe(buildHtmlCsp('b'));
  });
});

describe('設定の同期', () => {
  it('HTML_PATHSがwrangler.jsoncのrun_worker_firstに含まれている', () => {
    // 載っていないパスはWorkerが起動せず、nonceの無い_headers側のCSPで
    // 配信されるため、scriptタグのnonceと食い違って実行がブロックされる
    const runWorkerFirst = wranglerConfig.match(/"run_worker_first":\s*\[([^\]]+)\]/)![1]!;
    for (const path of HTML_PATHS) {
      expect(runWorkerFirst, `${path}がrun_worker_firstにありません`).toContain(`"${path}"`);
    }
  });

  it('_headers側のCSPはHTML以外のアセット用として残っている', () => {
    // 404などWorkerを通らない経路でHTMLが配信される場合の保険
    expect(headers).toContain('Content-Security-Policy:');
    expect(headers).toContain('__INLINE_STYLE_HASH__');
  });
});
