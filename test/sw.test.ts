// Service Worker（public/sw.js）のオフライン時の応答のテスト
//
// E2EはserviceWorkers: 'block'でSWを遮断しているため、sw.jsの挙動はブラウザでは
// 自動検証されない。ここではsw.jsの本体をそのまま読み込み、self・caches・fetchを
// 差し替えて、fetchイベントへの応答（オンライン時の保存・オフライン時の退避）を検証する

import { describe, expect, it } from 'vitest';
import swJs from '../public/sw.js?raw';

const ORIGIN = 'https://example.com';

/** sw.jsが参照するRequestの形（Nodeのfetch実装ではmode: navigateのRequestを作れないため） */
interface FakeRequest {
  url: string;
  method: string;
  mode: string;
}

type FetchListener = (event: {
  request: FakeRequest;
  respondWith(response: Promise<Response>): void;
}) => void;

/** キャッシュのキー（文字列のパス・Requestのどちらでも絶対URLへ正規化する） */
function cacheKey(key: string | FakeRequest): string {
  return typeof key === 'string' ? new URL(key, ORIGIN).href : key.url;
}

/**
 * sw.jsを読み込み、fetchイベントのリスナーと保存領域を返す
 * @param network ネットワーク取得の差し替え（オフラインを模すときは例外を投げる）
 * @param saved 事前に保存しておくページ（パス→本文）
 */
function loadServiceWorker(
  network: (request: FakeRequest) => Promise<Response>,
  saved: Record<string, string> = {},
): { fetchListener: FetchListener; store: Map<string, Response> } {
  const store = new Map<string, Response>(
    Object.entries(saved).map(([path, body]) => [cacheKey(path), new Response(body)]),
  );
  const cache = {
    match: async (key: string | FakeRequest): Promise<Response | undefined> =>
      store.get(cacheKey(key))?.clone(),
    put: async (key: string | FakeRequest, response: Response): Promise<void> => {
      store.set(cacheKey(key), response);
    },
    keys: async (): Promise<{ url: string }[]> => [...store.keys()].map((url) => ({ url })),
    delete: async (key: string | FakeRequest): Promise<boolean> => store.delete(cacheKey(key)),
  };
  const listeners = new Map<string, FetchListener>();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: FetchListener): void => {
      listeners.set(type, listener);
    },
  };
  const caches = { open: async (): Promise<typeof cache> => cache };
  new Function('self', 'caches', 'fetch', swJs)(self, caches, network);
  return { fetchListener: listeners.get('fetch')!, store };
}

/** fetchイベントを発火し、respondWithに渡された応答を返す（素通しならnull） */
async function dispatch(listener: FetchListener, request: FakeRequest): Promise<Response | null> {
  let responded: Promise<Response> | null = null;
  listener({
    request,
    respondWith: (response): void => {
      responded = response;
    },
  });
  return responded;
}

const navigate = (path: string): FakeRequest => ({
  url: `${ORIGIN}${path}`,
  method: 'GET',
  mode: 'navigate',
});
const subresource = (path: string): FakeRequest => ({
  url: `${ORIGIN}${path}`,
  method: 'GET',
  mode: 'no-cors',
});
const offline = async (): Promise<Response> => {
  throw new TypeError('Failed to fetch');
};

describe('オンライン時', () => {
  it('ネットワークの応答を返し、ページはクエリを除いた正規のパスで保存する', async () => {
    const { fetchListener, store } = loadServiceWorker(async () => new Response('最新'));
    const response = await dispatch(fetchListener, navigate('/index.html?lat=35.68&lon=139.68'));

    expect(await response!.text()).toBe('最新');
    expect(store.has(`${ORIGIN}/`)).toBe(true);
  });
});

describe('オフライン時のページ移動', () => {
  it('保存済みのページを返す', async () => {
    const { fetchListener } = loadServiceWorker(offline, { '/': '保存済みのトップ' });
    const response = await dispatch(fetchListener, navigate('/?lat=35.68&lon=139.68'));
    expect(await response!.text()).toBe('保存済みのトップ');
  });

  it.each([
    ['/index.html', '/'],
    ['/about.html', '/about'],
    ['/emergency.html', '/emergency'],
  ])('別名の%sでも、正規のパス%sの保存分を返す', async (alias, canonical) => {
    const { fetchListener } = loadServiceWorker(offline, { [canonical]: `保存済み${canonical}` });
    const response = await dispatch(fetchListener, navigate(alias));
    expect(await response!.text()).toBe(`保存済み${canonical}`);
  });

  it('保存済みのページが無いときは、緊急時の導線を残した簡易ページを返す', async () => {
    const { fetchListener } = loadServiceWorker(offline);
    const response = await dispatch(fetchListener, navigate('/unknown'));
    const html = await response!.text();

    expect(response!.status).toBe(503);
    expect(response!.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(response!.headers.get('Cache-Control')).toBe('no-store');
    expect(response!.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(html).toContain('<html lang="ja">');
    expect(html).toContain('119番');
    expect(html).toContain('href="/emergency"');
  });
});

describe('オフライン時のサブリソース', () => {
  it('保存分が無い画像・JSは従来どおりネットワークエラーにする（簡易ページで代用しない）', async () => {
    const { fetchListener } = loadServiceWorker(offline);
    const response = await dispatch(fetchListener, subresource('/icon-192.png'));
    expect(response!.type).toBe('error');
  });
});

describe('簡易オフラインページのリンク先', () => {
  it('リンク先はすべて事前保存（SHELL_URLS）の対象で、オフラインでも開ける', () => {
    const offlineHtml = swJs.match(/const OFFLINE_HTML = `([^`]+)`/)![1]!;
    const shellUrls = swJs.match(/const SHELL_URLS = \[([^\]]+)\]/)![1]!;
    const links = [...offlineHtml.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);

    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(shellUrls, link).toContain(`'${link}'`);
    }
  });
});
