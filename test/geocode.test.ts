// /api/geocode ハンドラーとジオコーディングクライアントのテスト
// 上流APIはグローバルfetchのモックで差し替える

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleGeocode } from '../src/api/geocode';
import { GEOCODING_CACHE_TTL_SECONDS, GEOCODING_MAX_RESULTS } from '../src/constants';
import {
  buildGeocodingUrl,
  fetchGeocoding,
  parseGeocodingResponse,
} from '../src/weather/geocoding';
import { UpstreamError } from '../src/weather/openMeteo';

// spyモード: 実装はそのままに、個別テストでfetchGeocodingの失敗を注入できるようにする
vi.mock('../src/weather/geocoding', { spy: true });

/** ジオコーディングAPIレスポンスのモックを作る */
function geocodingBody(): unknown {
  return {
    results: [
      { name: '松山', admin1: '愛媛県', latitude: 33.8392, longitude: 132.7658, country_code: 'JP' },
      // 国外の候補は除外される
      { name: 'Matsuyama', admin1: 'Texas', latitude: 30.0, longitude: -97.0, country_code: 'US' },
      { name: '松山町', admin1: '宮城県', latitude: 38.5, longitude: 141.05, country_code: 'JP' },
    ],
  };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('handleGeocode', () => {
  it('正常系: 日本国内の候補のみを返す', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(geocodingBody()), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleGeocode(new Request('https://example.com/api/geocode?q=松山'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Cache-Control')).toContain('max-age');

    const body = (await response.json()) as {
      results: { name: string; admin1: string; latitude: number; longitude: number }[];
    };
    expect(body.results).toEqual([
      { name: '松山', admin1: '愛媛県', latitude: 33.8392, longitude: 132.7658 },
      { name: '松山町', admin1: '宮城県', latitude: 38.5, longitude: 141.05 },
    ]);

    // 上流URLへの配線と、長期エッジキャッシュの設定を固定する
    const upstreamUrl = String(fetchMock.mock.calls[0]![0]);
    expect(upstreamUrl).toContain('geocoding-api.open-meteo.com');
    expect(upstreamUrl).toContain(`name=${encodeURIComponent('松山')}`);
    const init = fetchMock.mock.calls[0]![1] as RequestInit & { cf?: { cacheTtl?: number } };
    expect(init.cf?.cacheTtl).toBe(GEOCODING_CACHE_TTL_SECONDS);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('qがない場合は400を返す', async () => {
    const response = await handleGeocode(new Request('https://example.com/api/geocode'));
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('q');
  });

  it('qが空白のみの場合も400を返す', async () => {
    const response = await handleGeocode(
      new Request('https://example.com/api/geocode?q=%20%20'),
    );
    expect(response.status).toBe(400);
  });

  it('qが長すぎる場合は400を返す', async () => {
    const query = 'あ'.repeat(101);
    const response = await handleGeocode(
      new Request(`https://example.com/api/geocode?q=${encodeURIComponent(query)}`),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('100文字以内');
  });

  it('GET以外のメソッドは405を返す', async () => {
    const response = await handleGeocode(
      new Request('https://example.com/api/geocode?q=松山', { method: 'POST' }),
    );
    expect(response.status).toBe(405);
  });

  it('OPTIONSプリフライトには204とCORSヘッダーを返す（/api/forecastと同じ契約）', async () => {
    const response = await handleGeocode(
      new Request('https://example.com/api/geocode', { method: 'OPTIONS' }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('上流APIのエラーは502として返し、運用検知のためログに残す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status: 500 })));

    const response = await handleGeocode(new Request('https://example.com/api/geocode?q=松山'));
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('地点検索');
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '地点検索の上流エラー:',
      expect.stringContaining('q='),
      expect.any(String),
    );
  });

  it('UpstreamError以外の予期しない例外は502に変換せず伝播させる', async () => {
    // ロジック層のバグなどはここで握りつぶさず、index.tsの最終防衛線（500+ログ）に任せる
    vi.mocked(fetchGeocoding).mockRejectedValueOnce(new TypeError('boom'));
    await expect(
      handleGeocode(new Request('https://example.com/api/geocode?q=松山')),
    ).rejects.toThrow('boom');
  });
});

describe('fetchGeocoding（郵便番号）', () => {
  /** zipcloudとジオコーディングをURLで出し分けるfetch実装を作る */
  function routePostal(options: {
    zipcloud: () => Response;
    search: (url: string) => Response;
  }): { impl: typeof fetch; calls: string[] } {
    const calls: string[] = [];
    const impl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('zipcloud')) {
        return options.zipcloud();
      }
      return options.search(url);
    }) as typeof fetch;
    return { impl, calls };
  }

  const cityHit = JSON.stringify({
    results: [
      { name: '蒲郡', admin1: '愛知県', latitude: 34.8262, longitude: 137.2196, country_code: 'JP' },
    ],
  });

  it('郵便番号はzipcloudで市区町村名へ変換してから地名検索する（全角・ハイフンなしも可）', async () => {
    const { impl, calls } = routePostal({
      zipcloud: () =>
        new Response(JSON.stringify({ status: 200, results: [{ address2: '蒲郡市' }] }), {
          status: 200,
        }),
      search: () => new Response(cityHit, { status: 200 }),
    });

    const results = await fetchGeocoding('４４３−００４１', impl);
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe('蒲郡');
    expect(calls[0]).toContain('zipcode=4430041');
    expect(calls[1]).toContain(`name=${encodeURIComponent('蒲郡市')}`);
  });

  it('zipcloudで住所が引けない場合はハイフン有無の両形式で直接検索する', async () => {
    const { impl, calls } = routePostal({
      zipcloud: () =>
        new Response(JSON.stringify({ status: 200, results: null }), { status: 200 }),
      // ハイフン付きは0件、ハイフンなしでヒットするケース
      search: (url) =>
        url.includes('4430041') && !url.includes('443-0041')
          ? new Response(cityHit, { status: 200 })
          : new Response(JSON.stringify({}), { status: 200 }),
    });

    const results = await fetchGeocoding('443-0041', impl);
    expect(results).toHaveLength(1);
    expect(calls[1]).toContain(encodeURIComponent('443-0041'));
    expect(calls[2]).toContain('name=4430041');
  });

  it('zipcloudのエラー・変換後の0件でも直接検索へフォールバックする', async () => {
    const { impl, calls } = routePostal({
      zipcloud: () => new Response('error', { status: 500 }),
      search: () => new Response(JSON.stringify({}), { status: 200 }),
    });

    const results = await fetchGeocoding('4430041', impl);
    expect(results).toEqual([]);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '郵便番号APIエラー:',
      expect.stringContaining('zipcode='),
      500,
    );
    // zipcloud→ハイフン付き→ハイフンなしの順で試している
    expect(calls).toHaveLength(3);
  });

  it('zipcloudへの接続失敗でも検索全体は継続する', async () => {
    const { impl } = routePostal({
      zipcloud: () => {
        throw new Error('down');
      },
      search: () => new Response(cityHit, { status: 200 }),
    });

    const results = await fetchGeocoding('443-0041', impl);
    expect(results).toHaveLength(1);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '郵便番号の変換に失敗:',
      expect.stringContaining('zipcode='),
      expect.any(Error),
    );
  });

  it('市区町村名の検索が0件なら郵便番号の直接検索も試す', async () => {
    const { impl, calls } = routePostal({
      zipcloud: () =>
        new Response(JSON.stringify({ status: 200, results: [{ address2: '蒲郡市' }] }), {
          status: 200,
        }),
      search: (url) =>
        url.includes('443-0041')
          ? new Response(cityHit, { status: 200 })
          : new Response(JSON.stringify({}), { status: 200 }),
    });

    const results = await fetchGeocoding('443-0041', impl);
    expect(results).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });
});

describe('fetchGeocoding', () => {
  it('接続失敗は固定の日本語文のUpstreamErrorにする', async () => {
    const reject = (() => Promise.reject(new Error('down'))) as unknown as typeof fetch;
    await expect(fetchGeocoding('松山', reject)).rejects.toThrow(
      '地点検索に失敗しました。時間をおいて再度お試しください',
    );
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '地点検索の取得に失敗:',
      expect.stringContaining('name='),
      expect.any(Error),
    );
  });

  it('非JSON応答は解析エラーのUpstreamErrorにする', async () => {
    const htmlResponse = (async () =>
      new Response('<html>maintenance</html>', { status: 200 })) as unknown as typeof fetch;
    await expect(fetchGeocoding('松山', htmlResponse)).rejects.toThrow(
      '地点検索APIのレスポンスを解析できませんでした',
    );
  });

  it('上流エラー本文が読めなくてもHTTPステータスのUpstreamErrorを返す', async () => {
    const brokenBody = (async () =>
      ({
        ok: false,
        status: 503,
        text: () => Promise.reject(new Error('読み取り失敗')),
      }) as unknown as Response) as unknown as typeof fetch;
    await expect(fetchGeocoding('松山', brokenBody)).rejects.toThrow('HTTP 503');
  });

  it('上流HTTPエラーはステータス入りのUpstreamErrorにする', async () => {
    const errorResponse = (async () =>
      new Response('too many requests', { status: 429 })) as unknown as typeof fetch;
    await expect(fetchGeocoding('松山', errorResponse)).rejects.toThrow('HTTP 429');
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '地点検索APIエラー:',
      expect.stringContaining('name='),
      429,
      'too many requests',
    );
  });
});

describe('buildGeocodingUrl', () => {
  it('検索語と日本語設定を含むURLを組み立てる', () => {
    const url = new URL(buildGeocodingUrl('790-0067'));
    expect(url.origin + url.pathname).toBe('https://geocoding-api.open-meteo.com/v1/search');
    expect(url.searchParams.get('name')).toBe('790-0067');
    expect(url.searchParams.get('language')).toBe('ja');
    expect(url.searchParams.get('format')).toBe('json');
    // JPフィルタ後にも候補が残るよう、上限の2倍を要求する
    expect(url.searchParams.get('count')).toBe(String(GEOCODING_MAX_RESULTS * 2));
  });
});

describe('parseGeocodingResponse', () => {
  it('オブジェクトでないレスポンスはUpstreamErrorを投げる', () => {
    expect(() => parseGeocodingResponse('broken')).toThrow(UpstreamError);
    expect(() => parseGeocodingResponse(null)).toThrow(UpstreamError);
  });

  it('resultsフィールドがない（該当なし）場合は空配列を返す', () => {
    expect(parseGeocodingResponse({})).toEqual([]);
  });

  it('resultsが配列でない場合はUpstreamErrorを投げる', () => {
    expect(() => parseGeocodingResponse({ results: 'broken' })).toThrow(UpstreamError);
  });

  it('name欠落・座標が非数値・国外の候補は除外する', () => {
    const results = parseGeocodingResponse({
      results: [
        { name: '', admin1: '', latitude: 35, longitude: 139, country_code: 'JP' },
        { name: '座標なし', latitude: 'x', longitude: 139, country_code: 'JP' },
        { name: 'Paris', latitude: 48.85, longitude: 2.35, country_code: 'FR' },
        { name: '高松', latitude: 34.34, longitude: 134.05, country_code: 'JP' },
        'broken',
      ],
    });
    expect(results).toEqual([{ name: '高松', admin1: '', latitude: 34.34, longitude: 134.05 }]);
  });

  it('候補は最大件数で打ち切る', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      name: `地点${i}`,
      admin1: '東京都',
      latitude: 35 + i * 0.01,
      longitude: 139,
      country_code: 'JP',
    }));
    const results = parseGeocodingResponse({ results: many });
    expect(results).toHaveLength(GEOCODING_MAX_RESULTS);
  });
});
