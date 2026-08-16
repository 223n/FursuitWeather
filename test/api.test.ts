// /api/forecast ハンドラーのテスト
// 上流APIはグローバルfetchのモックで差し替える

import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleForecast } from '../src/api/forecast';
import { buildForecastUrl, parseWeatherResponse, UpstreamError } from '../src/weather/openMeteo';

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

  it('上流APIへの接続自体が失敗（タイムアウト・ネットワーク断）した場合は502を返す', async () => {
    // AbortSignal.timeoutによる打ち切りもfetchのrejectとしてこの経路に入る
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('The operation was aborted');
      }),
    );

    const response = await handleForecast(
      new Request('https://example.com/api/forecast?lat=35.68&lon=139.68'),
    );
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('気象データの取得に失敗');
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

  it('上流APIのレスポンスに位置情報（latitude）が欠けている場合は502を返す', async () => {
    const broken = openMeteoBody() as Record<string, unknown>;
    delete broken['latitude'];
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

describe('parseWeatherResponse', () => {
  it('時刻配列が空の場合は「気象データが空でした」を投げる', () => {
    const body = openMeteoBody() as { hourly: Record<string, unknown[]> };
    for (const key of Object.keys(body.hourly)) {
      body.hourly[key] = [];
    }
    expect(() => parseWeatherResponse(body)).toThrow(UpstreamError);
    expect(() => parseWeatherResponse(body)).toThrow('気象データが空でした');
  });

  it('全時間帯で必須項目が欠測の場合も「気象データが空でした」を投げる', () => {
    const body = openMeteoBody() as { hourly: { temperature_2m: (number | null)[] } };
    body.hourly.temperature_2m = body.hourly.temperature_2m.map(() => null);
    expect(() => parseWeatherResponse(body)).toThrow('気象データが空でした');
  });

  it('表示用フィールド（降水量・天気コード）の欠測は既定値で補って時間を残す', () => {
    const body = openMeteoBody() as {
      hourly: { precipitation: (number | null)[]; weather_code: (number | null)[] };
    };
    body.hourly.precipitation[5] = null;
    body.hourly.weather_code[5] = null;
    const result = parseWeatherResponse(body);
    expect(result.hours).toHaveLength(24);
    expect(result.hours[5]!.precipitation).toBe(0);
    expect(result.hours[5]!.weatherCode).toBe(-1);
  });

  it('数値であるべき要素が文字列の時間は破棄する（型主張の実行時検証）', () => {
    const body = openMeteoBody() as { hourly: { temperature_2m: unknown[] } };
    body.hourly.temperature_2m[3] = '28';
    const result = parseWeatherResponse(body);
    expect(result.hours).toHaveLength(23);
    expect(result.hours.some((h) => h.time === '2026-08-15T03:00')).toBe(false);
  });

  it('時刻が文字列でない時間は破棄する', () => {
    const body = openMeteoBody() as { hourly: { time: unknown[] } };
    body.hourly.time[4] = 4;
    const result = parseWeatherResponse(body);
    expect(result.hours).toHaveLength(23);
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
  });

  it('hourlyパラメータは必要フィールドと完全一致する（timeを含めない）', () => {
    // 検証用フィールド一覧（HOURLY_FIELDS）と取得URLの意図しない乖離を検出する。
    // 'time'はレスポンス専用で、URLに含めると上流がエラーを返すため完全一致で確認する
    const url = new URL(buildForecastUrl(35.6785, 139.6823, 4));
    expect(url.searchParams.get('hourly')).toBe(
      [
        'temperature_2m',
        'relative_humidity_2m',
        'apparent_temperature',
        'precipitation',
        'weather_code',
        'shortwave_radiation',
        'wind_speed_10m',
      ].join(','),
    );
  });
});
