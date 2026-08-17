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

  it('scriptとstyleを同じnonceで許可する', () => {
    expect(csp).toContain("script-src 'nonce-test-nonce-value'");
    expect(csp).toContain("style-src 'self' 'nonce-test-nonce-value'");
  });

  it("'strict-dynamic'でホスト許可リストに頼らない", () => {
    expect(csp).toContain("'strict-dynamic'");
    // 許可リスト方式の名残が残っていないこと（strict-dynamicで無視されるため
    // 書いてあると誤解を生む）
    expect(csp).not.toContain('static.cloudflareinsights.com');
  });

  it("古いブラウザ向けに'unsafe-inline'を併記する（nonce対応環境では無視される）", () => {
    expect(csp).toContain("'unsafe-inline'");
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
