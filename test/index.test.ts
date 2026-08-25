// Workerエントリポイント（ルーティングと最終防衛線）のテスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as forecastApi from '../src/api/forecast';
import * as geocodeApi from '../src/api/geocode';
import worker, { type Env } from '../src/index';
import { todayInJst } from '../src/logic/time';

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

  it('/api/national はhandleNationalに委譲する', async () => {
    const response = await worker.fetch(
      new Request('https://example.com/api/national?demo=1'),
      createEnv(),
      ctx,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { model: string; cities: unknown[] };
    expect(body.model).toBe('demo');
    expect(body.cities.length).toBeGreaterThan(0);
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
    for (const path of ['/api/forecast?lat=35&lon=139', '/api/geocode?q=松山', '/api/national']) {
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
    for (const path of ['/api/forecast', '/api/geocode', '/api/national']) {
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
    static applied: {
      selector: string;
      type: string | null;
      nonce: string | null;
      content: string | null;
    }[] = [];

    on(selector: string, handler: { element: (el: unknown) => void }): this {
      this.handlers.push({ selector, element: handler.element });
      return this;
    }

    transform(response: Response): Response {
      // 実物のHTMLに含まれるタグを模したもの（script2つ・style1つ・OGメタ4つ）
      const tags = [
        { selector: 'script', attrs: { type: null } as Record<string, string | null> },
        { selector: 'script', attrs: { type: 'application/ld+json' } as Record<string, string | null> },
        { selector: 'style', attrs: {} as Record<string, string | null> },
        {
          selector: 'meta[property="og:title"]',
          attrs: { content: '静的タイトル' } as Record<string, string | null>,
        },
        {
          selector: 'meta[property="og:description"]',
          attrs: { content: '静的説明' } as Record<string, string | null>,
        },
        {
          selector: 'meta[name="twitter:title"]',
          attrs: { content: '静的タイトル' } as Record<string, string | null>,
        },
        {
          selector: 'meta[name="twitter:description"]',
          attrs: { content: '静的説明' } as Record<string, string | null>,
        },
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
          content: tag.attrs.content ?? null,
        });
      }
      return response;
    }
  }

  /** OGサマリー取得（ogSummaryFor）が呼ぶ上流（Open-Meteo）のモックを作る */
  function ogUpstreamBody(): unknown {
    const date = todayInJst(new Date());
    const time: string[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      time.push(`${date}T${String(hour).padStart(2, '0')}:00`);
    }
    return {
      latitude: 35.7,
      longitude: 139.7,
      timezone: 'Asia/Tokyo',
      hourly: {
        time,
        temperature_2m: time.map(() => 28),
        relative_humidity_2m: time.map(() => 65),
        apparent_temperature: time.map(() => 31),
        precipitation: time.map(() => 0),
        weather_code: time.map(() => 1),
        shortwave_radiation: time.map(() => 400),
        wind_speed_10m: time.map(() => 2),
      },
    };
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

  it('クローラーUA+共有座標のトップページはOGタグへ当日判定を差し込む', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(ogUpstreamBody()), { status: 200 })),
    );
    const response = await worker.fetch(
      new Request('https://example.com/?lat=35.68&lon=139.68', {
        headers: { 'user-agent': 'Twitterbot/1.0' },
      }),
      createEnv(),
      ctx,
    );
    // OGサマリーが失敗してもHTML配信は続く契約のため、まず配信自体を確認する
    expect(response.status).toBe(200);

    const contentOf = (selector: string): string | null =>
      HTMLRewriterStub.applied.find((t) => t.selector === selector)!.content;
    expect(contentOf('meta[property="og:title"]')).toContain('東京付近');
    expect(contentOf('meta[property="og:title"]')).toContain('の着ぐるみ判定: ');
    expect(contentOf('meta[property="og:description"]')).toContain(
      '最新の判定はリンク先で確認してください',
    );
    // Xカード側も同じ文言に差し替わる
    expect(contentOf('meta[name="twitter:title"]')).toBe(contentOf('meta[property="og:title"]'));
    expect(contentOf('meta[name="twitter:description"]')).toBe(
      contentOf('meta[property="og:description"]'),
    );
  });

  it('通常閲覧では静的OGタグのまま返し、上流も呼ばない', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await worker.fetch(
      new Request('https://example.com/?lat=35.68&lon=139.68'),
      createEnv(),
      ctx,
    );
    expect(
      HTMLRewriterStub.applied.find((t) => t.selector === 'meta[property="og:title"]')!.content,
    ).toBe('静的タイトル');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('アセット側のステータス（404ページなど）を引き継ぐ', async () => {
    const env = {
      ASSETS: { fetch: vi.fn(async () => new Response('not found', { status: 404 })) },
    } as unknown as Env;
    const response = await worker.fetch(new Request('https://example.com/404.html'), env, ctx);
    expect(response.status).toBe(404);
  });
});
