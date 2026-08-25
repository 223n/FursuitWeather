// /api/forecast ハンドラーのテスト
// 上流APIはグローバルfetchのモックで差し替える

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleForecast } from '../src/api/forecast';
import { UPSTREAM_CACHE_TTL_SECONDS } from '../src/constants';
import {
  buildAirQualityUrl,
  buildForecastUrl,
  buildProbabilityUrl,
  fetchWeather,
  parseWeatherResponse,
} from '../src/weather/openMeteo';
import { UpstreamError } from '../src/weather/upstream';
import { todayInJst } from '../src/logic/time';

// spyモード: 実装はそのままに、個別テストでfetchWeatherの失敗を注入できるようにする
vi.mock('../src/weather/openMeteo', { spy: true });

/** モックの気象データの対象日（実行時の日本時間の当日。
 * handleForecastが過去分を分離する（past_days対応）ため、固定日付だと
 * 実行日によっては全時間が「過去」に分類されてしまう。
 * JST 0時またぎの実行でのフレークを避けるため、テストごとに取り直す */
let MOCK_DATE = todayInJst(new Date());

/** Open-Meteoレスポンスのモックを作る */
function openMeteoBody(): unknown {
  const time: string[] = [];
  const values: number[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    time.push(`${MOCK_DATE}T${String(hour).padStart(2, '0')}:00`);
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

/** 標準予報API（降水確率）レスポンスのモックを作る */
function probabilityBody(): unknown {
  const time: string[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    time.push(`${MOCK_DATE}T${String(hour).padStart(2, '0')}:00`);
  }
  return {
    hourly: {
      time,
      precipitation_probability: time.map(() => 30),
    },
  };
}

/** URLに応じてJMAモデルAPIと標準予報API（降水確率）を出し分けるfetch実装を作る */
function routeUpstream(
  probabilityResponse: () => Response | Promise<Response>,
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    if (String(input).includes('/v1/forecast')) {
      return probabilityResponse();
    }
    return new Response(JSON.stringify(openMeteoBody()), { status: 200 });
  }) as typeof fetch;
}

beforeEach(() => {
  MOCK_DATE = todayInJst(new Date());
  // 上流エラー経路はconsole.errorへログするため、テスト出力を汚さないよう差し替える
  // （ログ内容のアサーションにも使う）
  vi.spyOn(console, 'error').mockImplementation(() => {});
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
    // 急な暑さ（暑熱順化前）の判定用に直近の実績も同じ応答で受け取る
    expect(upstreamUrl).toContain('past_days=7');

    // 意図的に追加した防御（エッジキャッシュ・タイムアウト）が黙って消えないよう固定する
    const init = fetchMock.mock.calls[0]![1] as RequestInit & { cf?: unknown };
    // 成功応答だけをキャッシュする（上流のエラーをキャッシュすると、復旧後も
    // 古い失敗が返り続けて障害が長引く。実際に525で発生した）
    expect(init.cf).toEqual({
      cacheTtlByStatus: {
        '200-299': UPSTREAM_CACHE_TTL_SECONDS,
        '400-499': 0,
        '500-599': 0,
      },
      cacheEverything: true,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
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

  it('past_daysで届いた過去分は予報（hours/days）に出さず、急な暑さの判定にだけ使う', async () => {
    // 直近7日の最高23℃に対して当日30℃（+7℃）→ suddenHeatが付く
    const body = openMeteoBody() as {
      hourly: { time: string[]; [key: string]: unknown[] };
    };
    for (let day = 7; day >= 1; day -= 1) {
      const past = new Date(new Date(`${MOCK_DATE}T00:00:00Z`).getTime() - day * 86400000)
        .toISOString()
        .slice(0, 10);
      // 比較対象の日として数えられる最少時間数（minSamplesPerDay=12）を満たす
      for (let hour = 18; hour >= 7; hour -= 1) {
        body.hourly.time.unshift(`${past}T${String(hour).padStart(2, '0')}:00`);
        body.hourly['temperature_2m']!.unshift(23);
        body.hourly['relative_humidity_2m']!.unshift(65);
        body.hourly['apparent_temperature']!.unshift(25);
        body.hourly['precipitation']!.unshift(0);
        body.hourly['weather_code']!.unshift(1);
        body.hourly['shortwave_radiation']!.unshift(400);
        body.hourly['wind_speed_10m']!.unshift(2);
      }
    }
    (body.hourly['temperature_2m'] as number[]).fill(
      30,
      body.hourly.time.findIndex((t) => t.startsWith(MOCK_DATE)),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );

    const response = await handleForecast(
      new Request('https://example.com/api/forecast?lat=35.68&lon=139.68'),
    );
    const forecast = (await response.json()) as {
      hours: { time: string }[];
      days: { date: string; maxWindSpeed: number }[];
      suddenHeat: unknown;
    };
    // 過去分は画面向けの予報に混ざらない
    expect(forecast.hours).toHaveLength(24);
    expect(forecast.hours.every((h) => h.time.startsWith(MOCK_DATE))).toBe(true);
    expect(forecast.days).toHaveLength(1);
    expect(forecast.days[0]!.date).toBe(MOCK_DATE);
    // 日別サマリーへ最大風速が載る（当日は全時間2m/s）
    expect(forecast.days[0]!.maxWindSpeed).toBe(2);
    expect(forecast.suddenHeat).toEqual({
      date: MOCK_DATE,
      recentAverageMax: 23,
      targetMax: 30,
    });
  });

  it('全時間が過去の応答（日付またぎのキャッシュヒット）は空の200を返さず上流エラーにする', async () => {
    // JST 0時またぎでエッジキャッシュ（30分）に前日の応答が残る窓では、
    // 過去分の分離後にhoursが空になる。空予報を200+キャッシュ可で返すと
    // 空画面が残るため、UpstreamError（502・no-store）へ倒す
    const body = openMeteoBody() as { hourly: { time: string[] } };
    const yesterday = new Date(new Date(`${MOCK_DATE}T00:00:00Z`).getTime() - 86400000)
      .toISOString()
      .slice(0, 10);
    body.hourly.time = body.hourly.time.map((time) => time.replace(MOCK_DATE, yesterday));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );

    await expect(
      handleForecast(new Request('https://example.com/api/forecast?lat=35.68&lon=139.68')),
    ).rejects.toThrow(UpstreamError);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '予報データが日付またぎで全て過去に分類されました:',
      MOCK_DATE,
      24,
    );
  });

  it('dailyの日の出・日の入りが日別サマリーへ載る（無い日はnull）', async () => {
    const body = openMeteoBody() as Record<string, unknown>;
    body['daily'] = {
      time: [MOCK_DATE],
      sunrise: [`${MOCK_DATE}T05:03`],
      sunset: [`${MOCK_DATE}T18:24`],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );

    const response = await handleForecast(
      new Request('https://example.com/api/forecast?lat=35.68&lon=139.68'),
    );
    const forecast = (await response.json()) as {
      days: { sunrise: string | null; sunset: string | null }[];
    };
    expect(forecast.days[0]).toMatchObject({ sunrise: '05:03', sunset: '18:24' });
  });

  it('過去分がない応答ではsuddenHeatはnull（欠測時は黙って抑制）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(openMeteoBody()), { status: 200 })),
    );

    const response = await handleForecast(
      new Request('https://example.com/api/forecast?lat=35.68&lon=139.68'),
    );
    const forecast = (await response.json()) as { suddenHeat: unknown };
    expect(forecast.suddenHeat).toBeNull();
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

  it('上流APIへの接続自体が失敗（タイムアウト・ネットワーク断）した場合はUpstreamErrorを投げる', async () => {
    // AbortSignal.timeoutによる打ち切りもfetchのrejectとしてこの経路に入る。
    // 502への変換はルーター（test/index.test.tsで検証）が担う
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('The operation was aborted');
      }),
    );

    await expect(
      handleForecast(new Request('https://example.com/api/forecast?lat=35.68&lon=139.68')),
    ).rejects.toThrow('気象データの取得に失敗');
  });

  it('UpstreamError以外の予期しない例外もそのまま伝播させる', async () => {
    // ロジック層のバグなどはここで握りつぶさず、index.tsの最終防衛線（500+ログ）に任せる
    vi.mocked(fetchWeather).mockRejectedValueOnce(new TypeError('boom'));

    await expect(
      handleForecast(new Request('https://example.com/api/forecast?lat=35.68&lon=139.68')),
    ).rejects.toThrow('boom');
  });

  it('上流APIのエラーはUpstreamErrorを投げ、失敗理由をログに残す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status: 500 })));

    await expect(
      handleForecast(new Request('https://example.com/api/forecast?lat=35.68&lon=139.68')),
    ).rejects.toThrow('気象データ');
    // 上流の失敗理由（レスポンス本文）もログに残る
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '気象データAPIエラー:',
      expect.stringContaining('latitude='),
      500,
      'error',
    );
  });

  it('上流APIが非JSONを返した場合はUpstreamErrorを投げ、本文サンプルをログに残す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>maintenance</html>', { status: 200 })),
    );

    await expect(
      handleForecast(new Request('https://example.com/api/forecast?lat=35.68&lon=139.68')),
    ).rejects.toThrow('解析できませんでした');
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '気象データAPIレスポンスの解析に失敗:',
      expect.stringContaining('latitude='),
      '<html>maintenance</html>',
    );
  });

  it('上流APIのレスポンスに必要な配列が欠けている場合はUpstreamErrorを投げ、本文サンプルをログに残す', async () => {
    const broken = openMeteoBody() as { hourly: Record<string, unknown> };
    delete broken.hourly['temperature_2m'];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(broken), { status: 200 })),
    );

    await expect(
      handleForecast(new Request('https://example.com/api/forecast?lat=35.68&lon=139.68')),
    ).rejects.toThrow('レスポンス形式が想定と異なります');
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '気象データAPIレスポンスの形式異常:',
      expect.stringContaining('latitude='),
      expect.stringContaining('"latitude":35.7'),
    );
  });

  it('上流APIのレスポンスに位置情報（latitude）が欠けている場合はUpstreamErrorを投げる', async () => {
    const broken = openMeteoBody() as Record<string, unknown>;
    delete broken['latitude'];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(broken), { status: 200 })),
    );

    await expect(
      handleForecast(new Request('https://example.com/api/forecast?lat=35.68&lon=139.68')),
    ).rejects.toThrow(UpstreamError);
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
    expect(forecast.hours.some((h) => h.time === `${MOCK_DATE}T12:00`)).toBe(false);
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
    expect(result.hours.some((h) => h.time === `${MOCK_DATE}T03:00`)).toBe(false);
  });

  it('時刻が文字列でない時間は破棄する', () => {
    const body = openMeteoBody() as { hourly: { time: unknown[] } };
    body.hourly.time[4] = 4;
    const result = parseWeatherResponse(body);
    expect(result.hours).toHaveLength(23);
  });

  it('降水確率はJMAレスポンスの解析段階では常にnull（後段で標準予報APIから合流する）', () => {
    const parsed = parseWeatherResponse(openMeteoBody());
    expect(parsed.hours.every((h) => h.precipitationProbability === null)).toBe(true);
  });

  it('dailyブロックから日の出・日の入りを日付ごとに取り出す', () => {
    const body = openMeteoBody() as Record<string, unknown>;
    body['daily'] = {
      time: [MOCK_DATE],
      sunrise: [`${MOCK_DATE}T05:03`],
      sunset: [`${MOCK_DATE}T18:24`],
    };
    const result = parseWeatherResponse(body);
    expect(result.sunTimes.get(MOCK_DATE)).toEqual({ sunrise: '05:03', sunset: '18:24' });
  });

  it('dailyが無い・形式異常でも本体は成功し、日の出・日の入りは空になる（ベストエフォート）', () => {
    // daily無し
    expect(parseWeatherResponse(openMeteoBody()).sunTimes.size).toBe(0);
    // 形式異常（配列でない・時刻形式でない要素）
    const broken = openMeteoBody() as Record<string, unknown>;
    broken['daily'] = { time: [MOCK_DATE, 42], sunrise: 'x', sunset: [`${MOCK_DATE}T18:24`] };
    expect(parseWeatherResponse(broken).sunTimes.size).toBe(0);
    const partial = openMeteoBody() as Record<string, unknown>;
    partial['daily'] = { time: [MOCK_DATE], sunrise: [1765864800], sunset: [`${MOCK_DATE}T18:24`] };
    expect(parseWeatherResponse(partial).sunTimes.get(MOCK_DATE)).toEqual({
      sunrise: null,
      sunset: '18:24',
    });
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
  it('降水確率を標準予報APIから取得し、時刻で突き合わせて合流させる', async () => {
    const fetchImpl = routeUpstream(
      () => new Response(JSON.stringify(probabilityBody()), { status: 200 }),
    );
    const result = await fetchWeather(35.68, 139.68, 1, fetchImpl);
    expect(result.hours).toHaveLength(24);
    expect(result.hours.every((h) => h.precipitationProbability === 30)).toBe(true);
  });

  it('降水確率の取得に失敗しても予報本体は成功する（確率はnull）', async () => {
    const fetchImpl = routeUpstream(() => new Response('error', { status: 500 }));
    const result = await fetchWeather(35.68, 139.68, 1, fetchImpl);
    expect(result.hours).toHaveLength(24);
    expect(result.hours.every((h) => h.precipitationProbability === null)).toBe(true);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '降水確率APIエラー:',
      expect.stringContaining('/v1/forecast'),
      500,
      'error',
    );
  });

  it('降水確率レスポンスの形式異常・時刻不一致・非数値はnullとして扱う', async () => {
    // 形式異常（hourly欠落）
    const brokenShape = routeUpstream(
      () => new Response(JSON.stringify({ message: 'ok' }), { status: 200 }),
    );
    const shapeResult = await fetchWeather(35.68, 139.68, 1, brokenShape);
    expect(shapeResult.hours.every((h) => h.precipitationProbability === null)).toBe(true);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '降水確率APIレスポンスの形式異常:',
      expect.stringContaining('/v1/forecast'),
      // 一次証拠として本文先頭がログに残る（予報本体の形式異常ログと同形式）
      expect.stringContaining('"message"'),
    );

    // 時刻の不一致（別日）と要素の非数値は該当時間のみnull
    const body = probabilityBody() as {
      hourly: { time: string[]; precipitation_probability: unknown[] };
    };
    body.hourly.time[0] = '2030-01-01T00:00';
    body.hourly.precipitation_probability[1] = '50';
    const mismatched = routeUpstream(
      () => new Response(JSON.stringify(body), { status: 200 }),
    );
    const result = await fetchWeather(35.68, 139.68, 1, mismatched);
    expect(result.hours[0]!.precipitationProbability).toBeNull();
    expect(result.hours[1]!.precipitationProbability).toBeNull();
    expect(result.hours[2]!.precipitationProbability).toBe(30);
  });

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
    // 補助取得（降水確率）の失敗は本体と件名を分けてログし、障害の切り分けに使う
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '降水確率の取得に失敗:',
      expect.stringContaining('/v1/forecast'),
      expect.anything(),
    );
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
    await expect(fetchWeather(35.68, 139.68, 1, brokenBody)).rejects.toThrow(
      '気象データの提供元で障害が発生しています',
    );
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

  it('上流の5xxは一度だけ取り直し、2回目が成功すれば利用者にはエラーを見せない', async () => {
    // 実測: Open-Meteo自身のCDNがオリジンへ到達できず、数百ミリ秒だけHTTP 525を
    // 返す瞬断が起きた。1回の取り直しでこの手の瞬断は吸収できる
    let jmaCalls = 0;
    const jmaInits: (RequestInit & { cf?: unknown })[] = [];
    const flaky = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/v1/forecast')) {
        return new Response(JSON.stringify(probabilityBody()), { status: 200 });
      }
      if (String(input).includes('/v1/air-quality')) {
        return new Response(JSON.stringify({ hourly: { time: [] } }), { status: 200 });
      }
      jmaCalls += 1;
      jmaInits.push(init as RequestInit & { cf?: unknown });
      return jmaCalls === 1
        ? new Response('error code: 525', { status: 525 })
        : new Response(JSON.stringify(openMeteoBody()), { status: 200 });
    }) as typeof fetch;

    const result = await fetchWeather(35.68, 139.68, 1, flaky);
    expect(jmaCalls).toBe(2);
    expect(result.hours).toHaveLength(24);
    // 取り直しも同じ条件（エッジキャッシュ・UA・タイムアウト）で投げる
    expect(jmaInits[0]!.cf).toBeDefined();
    expect(jmaInits[1]!.cf).toEqual(jmaInits[0]!.cf);
    expect(jmaInits[1]!.headers).toEqual(jmaInits[0]!.headers);
    expect(jmaInits[1]!.signal).toBeInstanceOf(AbortSignal);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '上流の一時エラー（取り直します）:',
      expect.stringContaining('/v1/jma'),
      525,
      'error code: 525',
    );
  });

  it('取り直しても5xxのままなら上流エラーとして失敗させる', async () => {
    let jmaCalls = 0;
    const alwaysDown = (async (input: RequestInfo | URL) => {
      if (String(input).includes('/v1/jma')) {
        jmaCalls += 1;
      }
      return new Response('error code: 525', { status: 525 });
    }) as typeof fetch;

    await expect(fetchWeather(35.68, 139.68, 1, alwaysDown)).rejects.toThrow(
      '気象データの提供元で障害が発生しています',
    );
    expect(jmaCalls).toBe(2);
  });

  it('4xxは取り直さない（同じ結果になるうえ、待ち時間が延びるだけのため）', async () => {
    let calls = 0;
    const badRequest = (async () => {
      calls += 1;
      return new Response('bad request', { status: 400 });
    }) as typeof fetch;

    await expect(fetchWeather(35.68, 139.68, 1, badRequest)).rejects.toThrow(
      '気象データを取得できませんでした',
    );
    // 予報本体・降水確率・大気質で1回ずつ。取り直しは発生しない
    expect(calls).toBe(3);
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
    // 日の出・日の入り（補助情報）も同じ応答で受け取る
    expect(url.searchParams.get('daily')).toBe('sunrise,sunset');
  });

  it('日付固定の取得（/api/national用）にはpast_days・dailyを付けない', () => {
    const url = new URL(buildForecastUrl(35.6785, 139.6823, 4, '2026-08-15'));
    expect(url.searchParams.get('start_date')).toBe('2026-08-15');
    expect(url.searchParams.get('end_date')).toBe('2026-08-15');
    expect(url.searchParams.get('past_days')).toBeNull();
    expect(url.searchParams.get('daily')).toBeNull();
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

describe('buildProbabilityUrl', () => {
  it('降水確率は標準予報APIから取得するURLになる', () => {
    // 気象庁モデルAPIは降水確率を提供しないため、標準予報APIを指すことを固定する
    const url = new URL(buildProbabilityUrl(35.6785, 139.6823, 4));
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(url.searchParams.get('hourly')).toBe('precipitation_probability');
    expect(url.searchParams.get('timezone')).toBe('Asia/Tokyo');
    expect(url.searchParams.get('forecast_days')).toBe('4');
  });
});

describe('buildAirQualityUrl', () => {
  it('大気質はAir Quality APIからPM2.5・黄砂を取得するURLになる', () => {
    const url = new URL(buildAirQualityUrl(35.6785, 139.6823, 4));
    expect(url.origin + url.pathname).toBe(
      'https://air-quality-api.open-meteo.com/v1/air-quality',
    );
    expect(url.searchParams.get('hourly')).toBe('pm2_5,dust');
    expect(url.searchParams.get('timezone')).toBe('Asia/Tokyo');
    expect(url.searchParams.get('forecast_days')).toBe('4');
  });
});

describe('fetchWeather（大気質の合流）', () => {
  /** Air Quality APIレスポンスのモックを作る */
  function airQualityBody(): unknown {
    const time: string[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      time.push(`${MOCK_DATE}T${String(hour).padStart(2, '0')}:00`);
    }
    return {
      hourly: {
        time,
        pm2_5: time.map(() => 40),
        dust: time.map(() => 120),
      },
    };
  }

  /** JMAモデル・標準予報・Air Quality APIの3系統を出し分けるfetch実装を作る */
  function routeWithAirQuality(
    airQualityResponse: () => Response | Promise<Response>,
  ): typeof fetch {
    return (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v1/air-quality')) {
        return airQualityResponse();
      }
      if (url.includes('/v1/forecast')) {
        return new Response(JSON.stringify(probabilityBody()), { status: 200 });
      }
      return new Response(JSON.stringify(openMeteoBody()), { status: 200 });
    }) as typeof fetch;
  }

  it('大気質を日付ごとの生値へ変換して合流させる', async () => {
    const fetchImpl = routeWithAirQuality(
      () => new Response(JSON.stringify(airQualityBody()), { status: 200 }),
    );
    const result = await fetchWeather(35.68, 139.68, 1, fetchImpl);
    const values = result.airQuality.get(MOCK_DATE);
    expect(values).toBeDefined();
    expect(values!.pm25).toHaveLength(24);
    expect(values!.dust).toHaveLength(24);
  });

  it('大気質の取得に失敗しても予報本体は成功する（Mapは空）', async () => {
    const fetchImpl = routeWithAirQuality(() => new Response('error', { status: 500 }));
    const result = await fetchWeather(35.68, 139.68, 1, fetchImpl);
    expect(result.hours).toHaveLength(24);
    expect(result.airQuality.size).toBe(0);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '大気質APIエラー:',
      expect.stringContaining('/v1/air-quality'),
      500,
      'error',
    );
  });

  it('レスポンスの形式異常（time欠落）は空のMapとして扱い、本文先頭をログに残す', async () => {
    const fetchImpl = routeWithAirQuality(
      () => new Response(JSON.stringify({ message: 'ok' }), { status: 200 }),
    );
    const result = await fetchWeather(35.68, 139.68, 1, fetchImpl);
    expect(result.airQuality.size).toBe(0);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '大気質APIレスポンスの形式異常:',
      expect.stringContaining('/v1/air-quality'),
      expect.stringContaining('"message"'),
    );
  });

  it('接続失敗は空のMapに落とし、原因をログに残す', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).includes('/v1/air-quality')) {
        throw new Error('接続拒否');
      }
      if (String(input).includes('/v1/forecast')) {
        return new Response(JSON.stringify(probabilityBody()), { status: 200 });
      }
      return new Response(JSON.stringify(openMeteoBody()), { status: 200 });
    }) as typeof fetch;
    const result = await fetchWeather(35.68, 139.68, 1, fetchImpl);
    expect(result.airQuality.size).toBe(0);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '大気質の取得に失敗:',
      expect.stringContaining('/v1/air-quality'),
      expect.anything(),
    );
  });

  it('不正な時刻・非数値の要素は捨て、値の配列が欠けていても日付の器は作る', async () => {
    const body = airQualityBody() as {
      hourly: { time: string[]; pm2_5: unknown[]; dust?: unknown };
    };
    body.hourly.time[0] = 'bad-time';
    body.hourly.pm2_5[1] = '40';
    delete body.hourly.dust;
    const fetchImpl = routeWithAirQuality(
      () => new Response(JSON.stringify(body), { status: 200 }),
    );
    const result = await fetchWeather(35.68, 139.68, 1, fetchImpl);
    const values = result.airQuality.get(MOCK_DATE);
    expect(values).toBeDefined();
    // 24時間のうちtime不正1件を除き、さらに非数値1件を捨てた22件
    expect(values!.pm25).toHaveLength(22);
    expect(values!.dust).toHaveLength(0);
  });

  it('handleForecastの応答で日別サマリーにairQualityが載る', async () => {
    vi.stubGlobal(
      'fetch',
      routeWithAirQuality(
        () => new Response(JSON.stringify(airQualityBody()), { status: 200 }),
      ),
    );
    const response = await handleForecast(
      new Request('https://example.com/api/forecast?lat=35.68&lon=139.68&days=1'),
    );
    expect(response.status).toBe(200);
    const forecast = (await response.json()) as {
      days: { airQuality: { level: string; pm25Mean: number; dustMax: number } | null }[];
    };
    // PM2.5平均40（35以上）・黄砂最大120（100以上）→「中」
    expect(forecast.days[0]!.airQuality).not.toBeNull();
    expect(forecast.days[0]!.airQuality!.level).toBe('medium');
    expect(forecast.days[0]!.airQuality!.pm25Mean).toBe(40);
    expect(forecast.days[0]!.airQuality!.dustMax).toBe(120);
  });
});
