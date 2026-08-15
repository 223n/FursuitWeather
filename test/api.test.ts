// /api/forecast ハンドラーのテスト
// 上流APIはグローバルfetchのモックで差し替える

import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleForecast } from '../src/api/forecast';
import { buildForecastUrl } from '../src/weather/openMeteo';

/** Open-Meteoレスポンスのモックを作る */
function openMeteoBody(): unknown {
  const time: string[] = [];
  const values: number[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    time.push(`2026-08-15T${String(hour).padStart(2, '0')}:00`);
    values.push(hour);
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('handleForecast', () => {
  it('正常系: 緯度経度を指定すると予報JSONを返す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(openMeteoBody()), { status: 200 })),
    );

    const response = await handleForecast(
      new Request('https://example.com/api/forecast?lat=35.68&lon=139.68'),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('max-age');

    const body = (await response.json()) as { hours: unknown[]; days: unknown[] };
    expect(body.hours).toHaveLength(24);
    expect(body.days).toHaveLength(1);
  });

  it('lat/lonがない場合は400を返す', async () => {
    const response = await handleForecast(new Request('https://example.com/api/forecast'));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('lat');
  });

  it('範囲外の緯度は400を返す', async () => {
    const response = await handleForecast(
      new Request('https://example.com/api/forecast?lat=99&lon=139'),
    );
    expect(response.status).toBe(400);
  });

  it('daysが範囲外の場合は400を返す', async () => {
    const response = await handleForecast(
      new Request('https://example.com/api/forecast?lat=35&lon=139&days=99'),
    );
    expect(response.status).toBe(400);
  });

  it('daysが非数値の場合もサイレントに既定値へ落とさず400を返す', async () => {
    const response = await handleForecast(
      new Request('https://example.com/api/forecast?lat=35&lon=139&days=abc'),
    );
    expect(response.status).toBe(400);
  });

  it('GET以外のメソッドは405を返す', async () => {
    const response = await handleForecast(
      new Request('https://example.com/api/forecast?lat=35&lon=139', { method: 'POST' }),
    );
    expect(response.status).toBe(405);
  });

  it('OPTIONSプリフライトには204とCORSヘッダーを返す', async () => {
    const response = await handleForecast(
      new Request('https://example.com/api/forecast', { method: 'OPTIONS' }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('上流APIのエラーは502として返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status: 500 })));

    const response = await handleForecast(
      new Request('https://example.com/api/forecast?lat=35.68&lon=139.68'),
    );
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('気象データ');
  });

  it('上流APIが非JSONを返した場合は502を返す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>maintenance</html>', { status: 200 })),
    );

    const response = await handleForecast(
      new Request('https://example.com/api/forecast?lat=35.68&lon=139.68'),
    );
    expect(response.status).toBe(502);
  });

  it('上流APIのレスポンスに必要な配列が欠けている場合は502を返す', async () => {
    const broken = openMeteoBody() as { hourly: Record<string, unknown> };
    delete broken.hourly['temperature_2m'];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(broken), { status: 200 })),
    );

    const response = await handleForecast(
      new Request('https://example.com/api/forecast?lat=35.68&lon=139.68'),
    );
    expect(response.status).toBe(502);
  });

  it('日射量が欠測の時間は結果から除外される（0補完で危険側に誤らない）', async () => {
    const body = openMeteoBody() as {
      hourly: { shortwave_radiation: (number | null)[] };
    };
    body.hourly.shortwave_radiation[12] = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );

    const response = await handleForecast(
      new Request('https://example.com/api/forecast?lat=35.68&lon=139.68'),
    );
    expect(response.status).toBe(200);
    const forecast = (await response.json()) as { hours: { time: string }[] };
    expect(forecast.hours).toHaveLength(23);
    expect(forecast.hours.some((h) => h.time === '2026-08-15T12:00')).toBe(false);
  });

  it('demo=1は上流APIを呼ばずにデモ予報を返す', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleForecast(
      new Request('https://example.com/api/forecast?demo=1'),
    );
    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();

    const body = (await response.json()) as { model: string; days: unknown[] };
    expect(body.model).toBe('demo');
    expect(body.days).toHaveLength(2);
  });
});

describe('buildForecastUrl', () => {
  it('必要なパラメータをすべて含む', () => {
    const url = new URL(buildForecastUrl(35.6785, 139.6823, 4));
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/jma');
    expect(url.searchParams.get('latitude')).toBe('35.6785');
    expect(url.searchParams.get('longitude')).toBe('139.6823');
    expect(url.searchParams.get('timezone')).toBe('Asia/Tokyo');
    expect(url.searchParams.get('wind_speed_unit')).toBe('ms');
    expect(url.searchParams.get('forecast_days')).toBe('4');
    expect(url.searchParams.get('hourly')).toContain('temperature_2m');
    expect(url.searchParams.get('hourly')).toContain('shortwave_radiation');
  });
});
