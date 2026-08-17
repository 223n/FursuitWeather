// public/_headers（配信時のセキュリティヘッダー）の契約テスト
//
// ヘッダーは静的ファイルのため実装から検証されず、弱めても気付けない。
// 緩和が事故で入り込まないよう、要点をCIで機械検証する。
// Trusted Typesのポリシー名など、app.jsと結合する値の同期も見る。

import { describe, expect, it } from 'vitest';
import appJs from '../public/app.js?raw';
import headers from '../public/_headers?raw';

/** _headersからディレクティブ名で値を取り出す */
function headerValue(name: string): string {
  const match = headers.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, 'mi'));
  expect(match, `${name}ヘッダーが_headersにありません`).not.toBeNull();
  return match![1]!.trim();
}

/** CSPから指定ディレクティブの値を取り出す */
function cspDirective(name: string): string {
  const csp = headerValue('Content-Security-Policy');
  const match = csp.match(new RegExp(`(?:^|;)\\s*${name}\\s+([^;]+)`));
  expect(match, `CSPに${name}がありません`).not.toBeNull();
  return match![1]!.trim();
}

describe('Content-Security-Policy', () => {
  it('未指定の取得先を既定で拒否する（default-src none）', () => {
    expect(cspDirective('default-src')).toBe("'none'");
  });

  it('スクリプトは自オリジンのみで、インライン実行を許さない', () => {
    const scriptSrc = cspDirective('script-src');
    expect(scriptSrc).toBe("'self'");
    // 'unsafe-inline'はnonce/hashが無い状態では本当に有効化されてしまうため、
    // script-srcには決して入れない（後方互換の併記が許されるのはstyle-src側のみ）
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain('unsafe-eval');
  });

  it('インラインCSSはビルドが埋めるハッシュで許可する', () => {
    const styleSrc = cspDirective('style-src');
    // ビルド（scripts/inline-css.mjs）がCSSのsha256へ置き換えるプレースホルダー
    expect(styleSrc).toContain('__INLINE_STYLE_HASH__');
    // ハッシュを解釈できない古いブラウザ向けの後方互換（新しいブラウザでは無視される）
    expect(styleSrc).toContain("'unsafe-inline'");
  });

  it('DOM型XSS対策としてTrusted Typesを必須にする', () => {
    expect(cspDirective('require-trusted-types-for')).toBe("'script'");
    // 許可するポリシー名はapp.jsが作るものと一致していること
    // （ずれるとService Workerの登録が失敗する）
    const policy = cspDirective('trusted-types');
    expect(appJs).toContain(`createPolicy('${policy}'`);
  });

  it('埋め込み・プラグイン・base書き換えを禁止する', () => {
    expect(cspDirective('frame-ancestors')).toBe("'none'");
    expect(cspDirective('object-src')).toBe("'none'");
    expect(cspDirective('base-uri')).toBe("'none'");
    expect(cspDirective('form-action')).toBe("'none'");
  });

  it('マニフェストとService Workerの取得先を明示する（default-src noneのため）', () => {
    expect(cspDirective('manifest-src')).toBe("'self'");
    expect(cspDirective('worker-src')).toBe("'self'");
  });
});

describe('その他のセキュリティヘッダー', () => {
  it('HSTSは1年以上・サブドメイン込み', () => {
    const hsts = headerValue('Strict-Transport-Security');
    const maxAge = Number(hsts.match(/max-age=(\d+)/)![1]);
    expect(maxAge).toBeGreaterThanOrEqual(31536000);
    expect(hsts).toContain('includeSubDomains');
  });

  it('COOPでオリジンを分離する', () => {
    expect(headerValue('Cross-Origin-Opener-Policy')).toBe('same-origin');
  });

  it('MIMEスニッフィングを禁止し、リファラを絞る', () => {
    expect(headerValue('X-Content-Type-Options')).toBe('nosniff');
    expect(headerValue('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('位置情報は自サイトのみ、カメラ・マイク・決済は禁止', () => {
    const policy = headerValue('Permissions-Policy');
    expect(policy).toContain('geolocation=(self)');
    expect(policy).toContain('camera=()');
    expect(policy).toContain('microphone=()');
  });
});

describe('Trusted Typesと衝突するDOMシンクを使っていない', () => {
  // require-trusted-types-forの下では、これらへ文字列を渡すと実行時エラーになる
  it.each(['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write'])(
    '%s を使っていない',
    (sink) => {
      expect(appJs).not.toContain(sink);
    },
  );
});
