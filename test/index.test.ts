// Workerエントリポイント（ルーティングと最終防衛線）のテスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as forecastApi from '../src/api/forecast';
import * as geocodeApi from '../src/api/geocode';
import worker, { type Env } from '../src/index';

// spyモードで実体を残したままモック化し、500系のテストでのみ失敗を注入する
vi.mock('../src/api/forecast', { spy: true });
vi.mock('../src/api/geocode', { spy: true });

/** ASSETSバインディングをスタブした環境を作る */
function createEnv(): Env {
  return {
    ASSETS: { fetch: vi.fn(async () => new Response('asset')) },
  } as unknown as Env;
}

const ctx = {} as ExecutionContext;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Workerルーティング', () => {
  it('/api/forecast はhandleForecastに委譲する', async () => {
    const response = await worker.fetch(
      new Request('https://example.com/api/forecast?demo=1'),
      createEnv(),
      ctx,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { model: string };
    expect(body.model).toBe('demo');
  });

  it('/api/geocode はhandleGeocodeに委譲する', async () => {
    vi.mocked(geocodeApi.handleGeocode).mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    const response = await worker.fetch(
      new Request('https://example.com/api/geocode?q=松山'),
      createEnv(),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(vi.mocked(geocodeApi.handleGeocode)).toHaveBeenCalledOnce();
  });

  it('handleGeocodeの予期しない例外もCORSヘッダー付きのJSON 500に変換する', async () => {
    vi.mocked(geocodeApi.handleGeocode).mockRejectedValueOnce(new TypeError('boom'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await worker.fetch(
      new Request('https://example.com/api/geocode?q=test'),
      createEnv(),
      ctx,
    );
    expect(response.status).toBe(500);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(consoleError).toHaveBeenCalled();
  });

  it('APIルートはGET以外のメソッドに405を返す（全エンドポイント共通の契約）', async () => {
    for (const path of ['/api/forecast?lat=35&lon=139', '/api/geocode?q=松山']) {
      const response = await worker.fetch(
        new Request(`https://example.com${path}`, { method: 'POST' }),
        createEnv(),
        ctx,
      );
      expect(response.status).toBe(405);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      // RFC 9110 §15.5.6: 405には対応メソッドを示すAllowヘッダーが必須
      expect(response.headers.get('Allow')).toBe('GET');
    }
  });

  it('APIルートはOPTIONSプリフライトに204とCORSヘッダーを返す', async () => {
    for (const path of ['/api/forecast', '/api/geocode']) {
      const response = await worker.fetch(
        new Request(`https://example.com${path}`, { method: 'OPTIONS' }),
        createEnv(),
        ctx,
      );
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    }
  });

  it('ハンドラが投げたUpstreamErrorは502へ変換し、運用検知のためログに残す', async () => {
    // 上流500→UpstreamErrorはハンドラを素通りし、ルーターの最終防衛線が502にする
    vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status: 500 })));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    for (const path of ['/api/forecast?lat=35.68&lon=139.68', '/api/geocode?q=松山']) {
      const response = await worker.fetch(
        new Request(`https://example.com${path}`),
        createEnv(),
        ctx,
      );
      expect(response.status).toBe(502);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(consoleError).toHaveBeenCalledWith(
      '上流エラー:',
      expect.stringContaining('lat=35.68'),
      expect.any(String),
    );
    expect(consoleError).toHaveBeenCalledWith(
      '上流エラー:',
      expect.stringContaining('q='),
      expect.any(String),
    );
    vi.unstubAllGlobals();
  });

  it('存在しない/api/*パスはCORSヘッダー付きのJSON 404を返す', async () => {
    const response = await worker.fetch(
      new Request('https://example.com/api/unknown'),
      createEnv(),
      ctx,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('存在しない');
  });

  it('handleForecastの予期しない例外はCORSヘッダー付きのJSON 500に変換する', async () => {
    vi.mocked(forecastApi.handleForecast).mockRejectedValueOnce(new Error('boom'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await worker.fetch(
      new Request('https://example.com/api/forecast?demo=1'),
      createEnv(),
      ctx,
    );
    expect(response.status).toBe(500);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('サーバー内部');
    // ログ行単体で再現条件が分かるよう、リクエストの文脈（パス+クエリ）を含めている
    expect(consoleError).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('demo=1'),
      expect.any(Error),
    );
  });

  it('HTML以外のアセットはそのまま静的アセットへ委譲する', async () => {
    const env = createEnv();
    const response = await worker.fetch(new Request('https://example.com/app.js'), env, ctx);
    expect(await response.text()).toBe('asset');
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    // nonceを差し込まないためCSPも付けない（_headers側が担当する）
    expect(response.headers.get('Content-Security-Policy')).toBeNull();
  });
});

describe('HTMLページへのnonce注入', () => {
  // HTMLRewriterはWorkersランタイム専用のAPIでNode上には無い。
  // ここでは差し込みの判断（どのタグに付けるか）を検証するための最小スタブを使い、
  // 実際の書き換え結果はwrangler dev+ブラウザで確認している
  class HTMLRewriterStub {
    private handlers: { selector: string; element: (el: unknown) => void }[] = [];
    /** 呼び出し側が付けた属性の記録（テストから参照する） */
    static applied: { selector: string; type: string | null; nonce: string | null }[] = [];

    on(selector: string, handler: { element: (el: unknown) => void }): this {
      this.handlers.push({ selector, element: handler.element });
      return this;
    }

    transform(response: Response): Response {
      // 実物のHTMLに含まれるタグを模したもの（script2つ・style1つ）
      const tags = [
        { selector: 'script', attrs: { type: null } as Record<string, string | null> },
        { selector: 'script', attrs: { type: 'application/ld+json' } as Record<string, string | null> },
        { selector: 'style', attrs: {} as Record<string, string | null> },
      ];
      for (const tag of tags) {
        for (const handler of this.handlers) {
          if (handler.selector !== tag.selector) {
            continue;
          }
          handler.element({
            getAttribute: (name: string) => tag.attrs[name] ?? null,
            setAttribute: (name: string, value: string) => {
              tag.attrs[name] = value;
            },
          });
        }
        HTMLRewriterStub.applied.push({
          selector: tag.selector,
          type: tag.attrs.type ?? null,
          nonce: tag.attrs.nonce ?? null,
        });
      }
      return response;
    }
  }

  beforeEach(() => {
    HTMLRewriterStub.applied = [];
    vi.stubGlobal('HTMLRewriter', HTMLRewriterStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('HTMLパスはnonce付きのCSPで返る', async () => {
    const env = createEnv();
    const response = await worker.fetch(new Request('https://example.com/'), env, ctx);
    const csp = response.headers.get('Content-Security-Policy')!;
    const nonce = csp.match(/'nonce-([^']+)'/)![1]!;

    expect(csp).toContain(`script-src 'nonce-${nonce}'`);
    // nonceが漏れて共有キャッシュに載らないようにする
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('実行されるscriptとstyleにnonceを付け、JSON-LDには付けない', async () => {
    await worker.fetch(new Request('https://example.com/about'), createEnv(), ctx);
    const applied = HTMLRewriterStub.applied;

    expect(applied.find((t) => t.selector === 'script' && t.type === null)!.nonce).toBeTruthy();
    expect(applied.find((t) => t.selector === 'style')!.nonce).toBeTruthy();
    // JSON-LDは実行されないデータブロックのため対象外
    expect(
      applied.find((t) => t.selector === 'script' && t.type === 'application/ld+json')!.nonce,
    ).toBeNull();
  });

  it('リクエストごとに異なるnonceを使う（固定値だと注入で突破される）', async () => {
    const env = createEnv();
    const first = await worker.fetch(new Request('https://example.com/'), env, ctx);
    const second = await worker.fetch(new Request('https://example.com/'), env, ctx);
    const nonceOf = (r: Response): string =>
      r.headers.get('Content-Security-Policy')!.match(/'nonce-([^']+)'/)![1]!;

    expect(nonceOf(first)).not.toBe(nonceOf(second));
  });

  it('アセット側のステータス（404ページなど）を引き継ぐ', async () => {
    const env = {
      ASSETS: { fetch: vi.fn(async () => new Response('not found', { status: 404 })) },
    } as unknown as Env;
    const response = await worker.fetch(new Request('https://example.com/404.html'), env, ctx);
    expect(response.status).toBe(404);
  });
});
