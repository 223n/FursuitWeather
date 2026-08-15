// Workerエントリポイント（ルーティングと最終防衛線）のテスト

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as forecastApi from '../src/api/forecast';
import worker, { type Env } from '../src/index';

// spyモードで実体を残したままモック化し、500系のテストでのみ失敗を注入する
vi.mock('../src/api/forecast', { spy: true });

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
    expect(consoleError).toHaveBeenCalled();
  });

  it('API以外のパスは静的アセットへ委譲する', async () => {
    const env = createEnv();
    const response = await worker.fetch(new Request('https://example.com/about'), env, ctx);
    expect(await response.text()).toBe('asset');
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
  });
});
