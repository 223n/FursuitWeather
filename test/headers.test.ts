// public/_headers（配信時のセキュリティヘッダー）の契約テスト
//
// ヘッダーは静的ファイルのため実装から検証されず、弱めても気付けない。
// 緩和が事故で入り込まないよう、要点をCIで機械検証する。
// Trusted Typesのポリシー名など、app.jsと結合する値の同期も見る。

import { describe, expect, it } from 'vitest';
import appJs from '../public/app.js?raw';
import displayJs from '../public/display.js?raw';
import headers from '../public/_headers?raw';
import html from '../public/index.html?raw';
import aboutHtml from '../public/about.html?raw';
import notFoundHtml from '../public/404.html?raw';
import emergencyHtml from '../public/emergency.html?raw';
import displayHtml from '../public/display.html?raw';

/** 外部スクリプトを載せる配信ページ（増やしたらここへ足す） */
const PAGES_WITH_EXTERNAL_SCRIPT = [
  ['index.html', html],
  ['about.html', aboutHtml],
  ['404.html', notFoundHtml],
  ['emergency.html', emergencyHtml],
  ['display.html', displayHtml],
] as const;

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

  it('スクリプトは自オリジンとアクセス解析のみで、インライン実行を許さない', () => {
    const scriptSrc = cspDirective('script-src');
    // 許可するのは自オリジンと、明示的に選んだ配信元だけ。
    // ワイルドカードや任意ホストが紛れ込んでいないことを確認する
    expect(scriptSrc.split(/\s+/).sort()).toEqual(
      ["'self'", 'https://static.cloudflareinsights.com'].sort(),
    );
    // 'unsafe-inline'はnonce/hashが無い状態では本当に有効化されてしまうため、
    // script-srcには決して入れない（後方互換の併記が許されるのはstyle-src側のみ）
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain('unsafe-eval');
    expect(scriptSrc).not.toContain('*');
  });

  it('通信先は自オリジンとアクセス解析の送信先のみ', () => {
    const connectSrc = cspDirective('connect-src');
    expect(connectSrc.split(/\s+/).sort()).toEqual(
      ["'self'", 'https://cloudflareinsights.com'].sort(),
    );
  });

  it('読み込む外部スクリプトはCSPで許可した配信元と一致する', () => {
    // HTMLのsrcとCSPの許可元がずれると、計測タグが黙ってブロックされる。
    // srcの引用符はシングル・ダブルの両方を拾う。ダブルだけを見ていると、
    // Cloudflareのダッシュボードが配るシングルクォートのタグを貼ったときに
    // そのページが検査対象から静かに外れ、テストは通ったままガードだけ失われる
    const scriptSrc = cspDirective('script-src');
    for (const [name, page] of PAGES_WITH_EXTERNAL_SCRIPT) {
      for (const src of page.matchAll(/<script[^>]*\ssrc=["'](https?:\/\/[^"']+)["']/g)) {
        const origin = new URL(src[1]!).origin;
        expect(scriptSrc, `${name}の${origin}がCSPで許可されていません`).toContain(origin);
      }
    }
  });

  it('計測タグのトークンは全ページで同一', () => {
    // トークンは配信ページごとに複製している。1ページだけ直し忘れると
    // 計測が2つのサイトへ分かれ、どちらの数字も実態とずれる
    // （画面にもCIにも出ないため、気付くのは解析画面を見たときになる）
    const tokens = PAGES_WITH_EXTERNAL_SCRIPT.map(([name, page]) => {
      const match = page.match(/data-cf-beacon='\{"token": "([0-9a-f]{32})"\}'/);
      expect(match, `${name}に計測タグのトークンがありません`).not.toBeNull();
      return match![1]!;
    });
    expect(new Set(tokens).size, `ページごとのトークン: ${tokens.join(' / ')}`).toBe(1);
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
    expect(displayJs).toContain(`createPolicy('${policy}'`);
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

  it('画面スリープ防止（Wake Lock）は自サイトのみ許可する', () => {
    // 会場表示モード（display.js）がモニターのスリープを防ぐために使う
    expect(headerValue('Permissions-Policy')).toContain('screen-wake-lock=(self)');
  });
});

describe('Trusted Typesと衝突するDOMシンクを使っていない', () => {
  // require-trusted-types-forの下では、これらへ文字列を渡すと実行時エラーになる
  it.each(['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write'])(
    '%s を使っていない',
    (sink) => {
      expect(appJs).not.toContain(sink);
      expect(displayJs).not.toContain(sink);
    },
  );
});
