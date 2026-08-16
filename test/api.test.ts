// /api/forecast ハンドラーのテスト
// 上流APIはグローバルfetchのモックで差し替える

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleForecast } from '../src/api/forecast';
import { UPSTREAM_CACHE_TTL_SECONDS } from '../src/constants';
import {
  buildForecastUrl,
  fetchWeather,
  parseWeatherResponse,
  resetOptionalFieldsRejected,
  UpstreamError,
} from '../src/weather/openMeteo';

// spyモード: 実装はそのままに、個別テストでfetchWeatherの失敗を注入できるようにする
vi.mock('../src/weather/openMeteo', { spy: true });

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
      precipitation_probability: time.map(() => 30),
    },
  };
}

beforeEach(() => {
  // 上流エラー経路はconsole.errorへログするため、テスト出力を汚さないよう差し替える
  // （ログ内容のアサーションにも使う）
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // 任意フィールド拒否の記憶（モジュール可変状態）をテスト間で持ち越さない
  resetOptionalFieldsRejected();
});

afterEach(() => {
  vi.unstubAllGlobals();
  // spyモックのOnceキュー・呼び出し履歴をテストごとに破棄し、順序依存を防ぐ
  vi.resetAllMocks();
  // フェイクタイマーを使うテストからの偽装漏れを防ぐ
  vi.useRealTimers();
});

describe('handleForecast', () => {
  it('正常系: 緯度経度を指定すると予報JSONを返す', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(openMeteoBody()), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleForecast(
      new Request('https://example.com/api/forecast?lat=35.68&lon=139.68'),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('max-age');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');

    const body = (await response.json()) as { hours: unknown[]; days: unknown[] };
    expect(body.hours).toHaveLength(24);
    expect(body.days).toHaveLength(1);

    // ハンドラー→上流URLの配線（lat/lonの取り違え・既定daysの伝播）を検証する
    const upstreamUrl = String(fetchMock.mock.calls[0]![0]);
    expect(upstreamUrl).toContain('latitude=35.6800');
    expect(upstreamUrl).toContain('longitude=139.6800');
    expect(upstreamUrl).toContain('forecast_days=4');

    // 意図的に追加した防御（エッジキャッシュ・タイムアウト）が黙って消えないよう固定する
    const init = fetchMock.mock.calls[0]![1] as RequestInit & { cf?: unknown };
    expect(init.cf).toEqual({ cacheTtl: UPSTREAM_CACHE_TTL_SECONDS, cacheEverything: true });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('上流が400を返した場合は任意フィールドなしで一度だけ再試行する', async () => {
    // 降水確率フィールドを上流モデルが受け付けないケースへの防御
    const fetchMock = vi
      .fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(JSON.stringify(openMeteoBody()), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response('{"error":true,"reason":"Cannot initialize"}', { status: 400 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleForecast(
      new Request('https://example.com/api/forecast?lat=35.68&lon=139.68'),
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('precipitation_probability');
    expect(String(fetchMock.mock.calls[1]![0])).not.toContain('precipitation_probability');
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      expect.stringContaining('再試行'),
      expect.stringContaining('latitude='),
      expect.stringContaining('Cannot initialize'),
    );
  });

  it('daysを明示指定すると上流URLへそのまま伝わる', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(openMeteoBody()), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleForecast(
      new Request('https://example.com/api/forecast?lat=35.68&lon=139.68&days=2'),
    );
    expect(response.status).toBe(200);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('forecast_days=2');
  });

  it('lat/lonがない場合は400を返す', async () => {
    const response = await handleForecast(new Request('https://example.com/api/forecast'));
    expect(response.status).toBe(400);
    // エラーがブラウザにキャッシュされて復旧後も残り続けないこと（jsonErrorの契約）
    expect(response.headers.get('Cache-Control')).toBe('no-store');
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
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('気象データの取得に失敗');
  });

  it('UpstreamError以外の予期しない例外は502に変換せず伝播させる', async () => {
    // ロジック層のバグなどはここで握りつぶさず、index.tsの最終防衛線（500+ログ）に任せる
    vi.mocked(fetchWeather).mockRejectedValueOnce(new TypeError('boom'));

    await expect(
      handleForecast(new Request('https://example.com/api/forecast?lat=35.68&lon=139.68')),
    ).rejects.toThrow('boom');
  });

  it('上流APIのエラーは502として返し、運用検知のためログに残す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status: 500 })));

    const response = await handleForecast(
      new Request('https://example.com/api/forecast?lat=35.68&lon=139.68'),
    );
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('気象データ');
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '上流エラー:',
      expect.stringContaining('lat=35.68'),
      expect.any(String),
    );
    // 上流の失敗理由（レスポンス本文）もログに残る
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '気象データAPIエラー:',
      expect.stringContaining('latitude='),
      500,
      'error',
    );
  });

  it('上流APIが非JSONを返した場合は502を返し、本文サンプルをログに残す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>maintenance</html>', { status: 200 })),
    );

    const response = await handleForecast(
      new Request('https://example.com/api/forecast?lat=35.68&lon=139.68'),
    );
    expect(response.status).toBe(502);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '気象データAPIレスポンスの解析に失敗:',
      expect.stringContaining('latitude='),
      '<html>maintenance</html>',
    );
  });

  it('上流APIのレスポンスに必要な配列が欠けている場合は502を返し、本文サンプルをログに残す', async () => {
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
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '気象データAPIレスポンスの形式異常:',
      expect.stringContaining('latitude='),
      expect.stringContaining('"latitude":35.7'),
    );
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

  it('demo=1の初日は日本時間の今日になる（UTCとJSTの日付が食い違う時刻でも）', async () => {
    // UTC 20:00 = JST翌日05:00。UTC日付への簡略化やオフセット符号の退行を検出する
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T20:00:00Z'));

    const response = await handleForecast(
      new Request('https://example.com/api/forecast?demo=1'),
    );
    const body = (await response.json()) as { days: { date: string }[]; generatedAt: string };
    expect(body.days[0]!.date).toBe('2026-08-16');
    expect(body.generatedAt).toBe('2026-08-15T20:00:00.000Z');
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

  it('降水確率は任意フィールドとして扱う（提供時は値、欠落・非数値はnull）', () => {
    const withProbability = parseWeatherResponse(openMeteoBody());
    expect(withProbability.hours[0]!.precipitationProbability).toBe(30);

    const withoutField = openMeteoBody() as { hourly: Record<string, unknown> };
    delete withoutField.hourly['precipitation_probability'];
    const parsed = parseWeatherResponse(withoutField);
    expect(parsed.hours).toHaveLength(24);
    expect(parsed.hours[0]!.precipitationProbability).toBeNull();

    const broken = openMeteoBody() as { hourly: { precipitation_probability: unknown[] } };
    broken.hourly.precipitation_probability[2] = '50';
    expect(parseWeatherResponse(broken).hours[2]!.precipitationProbability).toBeNull();
  });

  it('時刻が文書契約の形式（YYYY-MM-DDTHH:mm）でない時間は破棄する', () => {
    // 形式不正が防御を通過すると、日付・時刻の位置切り出し（hourOf/dateOf）が
    // 化けたUIとして現れるため、上流境界で破棄する
    const body = openMeteoBody() as { hourly: { time: unknown[] } };
    body.hourly.time[4] = '1765864800';
    const result = parseWeatherResponse(body);
    expect(result.hours).toHaveLength(23);
  });
});

describe('fetchWeather', () => {
  it('接続失敗の原因はログにのみ残し、利用者向けには固定の日本語文を返す', async () => {
    const rejectWithString = (() => Promise.reject('接続拒否')) as unknown as typeof fetch;
    await expect(fetchWeather(35.68, 139.68, 1, rejectWithString)).rejects.toThrow(
      '気象データの取得に失敗しました。時間をおいて再度お試しください',
    );
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '気象データの取得に失敗:',
      expect.stringContaining('latitude=35.6800'),
      '接続拒否',
    );
  });

  it('400での拒否を記憶し、以後のリクエストは最初からフォールバックURLを使う', async () => {
    // 恒常的な400のとき毎回2往復になるとエッジキャッシュの無料枠保護が無効化されるため、
    // 拒否をアイソレート単位で記憶して1回目以降は必須フィールドのみで取得する
    const fetchMock = vi
      .fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(JSON.stringify(openMeteoBody()), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('bad request', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    await handleForecast(new Request('https://example.com/api/forecast?lat=35.68&lon=139.68'));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await handleForecast(new Request('https://example.com/api/forecast?lat=35.68&lon=139.68'));
    // 2回目のリクエストは再試行なしの1回で、任意フィールドを含まないURLになる
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2]![0])).not.toContain('precipitation_probability');
  });

  it('拒否記憶後の400は再試行せずそのまま502になる', async () => {
    const fetchMock = vi.fn(async () => new Response('bad request', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    // 1回目: 400→再試行（これも400）→502
    const first = await handleForecast(
      new Request('https://example.com/api/forecast?lat=35.68&lon=139.68'),
    );
    expect(first.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // 2回目: 記憶済みのため再試行せず1回で502
    const second = await handleForecast(
      new Request('https://example.com/api/forecast?lat=35.68&lon=139.68'),
    );
    expect(second.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('400応答の本文が読めなくても任意フィールドなしの再試行は行われる', async () => {
    const responses: Response[] = [
      {
        ok: false,
        status: 400,
        text: () => Promise.reject(new Error('切断')),
      } as unknown as Response,
      new Response(JSON.stringify(openMeteoBody()), { status: 200 }),
    ];
    const fetchImpl = (async () => responses.shift()!) as unknown as typeof fetch;
    const result = await fetchWeather(35.68, 139.68, 1, fetchImpl);
    expect(result.hours).toHaveLength(24);
  });

  it('200応答の本文読み取りに失敗した場合は解析失敗として扱い、原因をログに残す', async () => {
    const brokenText = (async () =>
      ({
        ok: true,
        status: 200,
        text: () => Promise.reject(new Error('切断')),
      }) as unknown as Response) as unknown as typeof fetch;
    await expect(fetchWeather(35.68, 139.68, 1, brokenText)).rejects.toThrow(
      '気象データAPIのレスポンスを解析できませんでした',
    );
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '気象データAPIレスポンスの読み取りに失敗:',
      expect.stringContaining('latitude='),
      expect.any(Error),
    );
  });

  it('上流エラー本文の読み取りに失敗しても、HTTPステータスのUpstreamErrorを返す', async () => {
    // ボディ読み取り失敗はログ用のdetailが空になるだけで、エラー分類には影響しない
    const brokenBody = (async () =>
      ({
        ok: false,
        status: 503,
        text: () => Promise.reject(new Error('読み取り失敗')),
      }) as unknown as Response) as unknown as typeof fetch;
    await expect(fetchWeather(35.68, 139.68, 1, brokenBody)).rejects.toThrow('HTTP 503');
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '気象データAPIエラー:',
      expect.stringContaining('latitude='),
      503,
      '',
    );
  });

  it('タイムアウトはその旨が分かる日本語文にする', async () => {
    // AbortSignal.timeoutの中断はname=TimeoutErrorのエラーとしてrejectされる
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    const rejectTimeout = (() => Promise.reject(timeoutError)) as unknown as typeof fetch;
    await expect(fetchWeather(35.68, 139.68, 1, rejectTimeout)).rejects.toThrow(
      '気象データの取得がタイムアウトしました',
    );
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

  it('hourlyパラメータは必要フィールド+任意フィールドと完全一致する（timeを含めない）', () => {
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
        'precipitation_probability',
      ].join(','),
    );
  });

  it('withOptionalFields=falseでは任意フィールドを含まないURLになる（400時の再試行用）', () => {
    const url = new URL(buildForecastUrl(35.6785, 139.6823, 4, false));
    expect(url.searchParams.get('hourly')).not.toContain('precipitation_probability');
  });
});
