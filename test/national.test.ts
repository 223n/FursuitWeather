// /api/national ハンドラーのテスト
// 上流APIはグローバルfetchのモックで差し替える

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleNational } from '../src/api/national';
import { NATIONAL_CITIES } from '../src/constants';
import type { NationalResponse } from '../src/types';
import { UpstreamError } from '../src/weather/upstream';

/** Open-Meteoレスポンスのモックを作る（当日24時間分） */
function openMeteoBody(latitude: number, longitude: number): unknown {
  const time: string[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    time.push(`2026-08-15T${String(hour).padStart(2, '0')}:00`);
  }
  return {
    latitude,
    longitude,
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

/** リクエストURLの緯度から都市を逆引きし、都市ごとの応答を出し分けるfetch実装を作る */
function nationalUpstreamMock(
  failCityNames: readonly string[] = [],
): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const latitude = Number(url.searchParams.get('latitude'));
    const city = NATIONAL_CITIES.find((c) => Math.abs(c.lat - latitude) < 0.001);
    if (!city || failCityNames.includes(city.name)) {
      return new Response('error', { status: 400 });
    }
    return new Response(JSON.stringify(openMeteoBody(city.lat, city.lon)), { status: 200 });
  });
}

beforeEach(() => {
  // 失敗経路はconsole.errorへログするため、テスト出力を汚さないよう差し替える
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('handleNational', () => {
  it('正常系: 全都市のサマリーをキャッシュ可能なJSONで返す', async () => {
    const fetchMock = nationalUpstreamMock();
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleNational(new Request('https://example.com/api/national'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('max-age');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const body = (await response.json()) as NationalResponse;
    expect(body.cities).toHaveLength(NATIONAL_CITIES.length);
    expect(body.model).toContain('jma_seamless');
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.attribution.weatherData).toContain('Open-Meteo');

    // 都市名・座標・当日サマリーの配線を先頭都市で検証する
    const first = body.cities[0]!;
    expect(first.name).toBe(NATIONAL_CITIES[0]!.name);
    expect(first.latitude).toBe(NATIONAL_CITIES[0]!.lat);
    expect(first.longitude).toBe(NATIONAL_CITIES[0]!.lon);
    expect(first.temperatureMax).toBe(28);
    expect(first.temperatureMin).toBe(28);
    expect(first.weatherLabel).toBe('晴れ');
    expect(first.outdoorWorst.label).toBeTruthy();
    expect(first.outdoorWorst.grade).toBeGreaterThanOrEqual(0);

    // 全国は降水確率を使わないため、標準予報API（補完）を呼ばないこと
    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(calledUrls).toHaveLength(NATIONAL_CITIES.length);
    for (const url of calledUrls) {
      expect(url).toContain('/v1/jma');
      expect(url).toContain('forecast_days=1');
    }
  });

  it('一部の都市が失敗しても、残りの都市で応答する（ベストエフォート）', async () => {
    vi.stubGlobal('fetch', nationalUpstreamMock(['仙台']));

    const response = await handleNational(new Request('https://example.com/api/national'));
    expect(response.status).toBe(200);

    const body = (await response.json()) as NationalResponse;
    expect(body.cities).toHaveLength(NATIONAL_CITIES.length - 1);
    expect(body.cities.map((city) => city.name)).not.toContain('仙台');
    // 失敗の詳細はログにのみ残す（利用者向け応答には含めない）
    expect(console.error).toHaveBeenCalledWith('全国天気の取得に失敗:', '仙台', expect.anything());
  });

  it('全都市が失敗したときはUpstreamErrorを投げる（ルーターが502へ変換する）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('error', { status: 400 })),
    );

    await expect(
      handleNational(new Request('https://example.com/api/national')),
    ).rejects.toThrow(UpstreamError);
  });

  it('demo=1のときは上流を呼ばず、デモデータで全都市を返す', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleNational(
      new Request('https://example.com/api/national?demo=1'),
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as NationalResponse;
    expect(body.model).toBe('demo');
    expect(body.cities).toHaveLength(NATIONAL_CITIES.length);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
