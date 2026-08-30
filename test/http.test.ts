// src/api/http.ts の共通契約のうち、ログへ出す値の丸めを検証する
//
// url.searchをそのままログへ出すと、丸める前の座標が運用ログへ残る。
// /api/*はCORSが*で誰でも呼べるため任意精度の座標を送れてしまい、
// 「位置情報は約1kmへ丸めます」という画面の約束と食い違う。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { logSafeSearch, upstreamErrorResponse } from '../src/api/http';
import { UpstreamError } from '../src/weather/upstream';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logSafeSearch', () => {
  it('座標を小数2桁へ丸める', () => {
    const url = new URL('https://example.com/api/forecast?lat=35.123456789&lon=139.987654321');
    expect(logSafeSearch(url)).toBe('?lat=35.12&lon=139.99');
  });

  it('座標以外のパラメータはそのまま残す（切り分けに要るため）', () => {
    const url = new URL('https://example.com/api/forecast?lat=35.6812&lon=139.7671&days=3');
    expect(logSafeSearch(url)).toBe('?lat=35.68&lon=139.77&days=3');
  });

  it('座標を含まないクエリはそのまま返す', () => {
    const url = new URL('https://example.com/api/geocode?q=蒲郡');
    expect(logSafeSearch(url)).toBe(`?q=${encodeURIComponent('蒲郡')}`);
  });

  it('クエリが無ければ空文字を返す', () => {
    expect(logSafeSearch(new URL('https://example.com/api/national'))).toBe('');
  });

  it('数値でない座標・空の座標はそのまま残す（丸めようがないため）', () => {
    const url = new URL('https://example.com/api/forecast?lat=abc&lon=');
    expect(logSafeSearch(url)).toBe('?lat=abc&lon=');
  });
});

describe('upstreamErrorResponse', () => {
  it('502のログに丸める前の座標を残さない', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const url = new URL('https://example.com/api/forecast?lat=35.123456789&lon=139.987654321');

    const response = upstreamErrorResponse(new UpstreamError('上流障害'), url);

    expect(response?.status).toBe(502);
    expect(spy).toHaveBeenCalledWith('上流エラー:', '/api/forecast?lat=35.12&lon=139.99', '上流障害');
    const logged = spy.mock.calls[0]!.join(' ');
    expect(logged).not.toContain('35.123456789');
    expect(logged).not.toContain('139.987654321');
  });

  it('上流障害でないエラーはnullを返す（500へフォールスルーする）', () => {
    const url = new URL('https://example.com/api/forecast?lat=35.68&lon=139.77');
    expect(upstreamErrorResponse(new Error('別の失敗'), url)).toBeNull();
  });
});
