// リンクカード（OGP）用の動的サマリーのテスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOgSummary, isPreviewBot, ogLocationLabel, ogSummaryFor } from '../src/ogp';
import { todayInJst } from '../src/logic/time';
import type { DayForecast } from '../src/types';

/** buildOgSummary用のDayForecastを組み立てる（判定ロジックには依存させない） */
function dayForecast(overrides: Partial<DayForecast> = {}): DayForecast {
  return {
    date: '2026-08-25',
    temperatureMin: 24,
    temperatureMax: 33,
    weatherCode: 1,
    weatherLabel: '晴れ',
    sunrise: '05:10',
    sunset: '18:20',
    outdoorWorst: { level: 'danger', label: '危険', grade: 4 },
    outdoorBest: { level: 'caution', label: '注意', grade: 1 },
    recommendedHours: ['09:00', '10:00'],
    coolingRequired: true,
    maxWbgt: 31.2,
    maxWindSpeed: 4,
    laundry: {
      score: 80,
      level: 'veryGood',
      label: 'よく乾く',
      fursuitDryingHours: 24,
      moldWarning: false,
      advice: '',
    },
    staticElectricity: { level: 'low', label: '低', advice: null },
    airQuality: null,
    ...overrides,
  };
}

/** ogSummaryFor用のリクエストを作る（既定はクローラーUA＋東京付近の座標） */
function botRequest(
  path = '/?lat=35.68&lon=139.68',
  userAgent: string | null = 'Twitterbot/1.0',
): Request {
  const headers = new Headers();
  if (userAgent !== null) {
    headers.set('user-agent', userAgent);
  }
  return new Request(`https://example.com${path}`, { headers });
}

/** Open-Meteoレスポンスのモックを作る（対象日の24時間分） */
function openMeteoBody(date: string): unknown {
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

/** 指定日のデータを返すfetchモックを作る */
function fetchReturning(date: string): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(openMeteoBody(date)), { status: 200 })) as typeof fetch;
}

beforeEach(() => {
  // 失敗経路はconsole.errorへログするため、テスト出力を汚さないよう差し替える
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isPreviewBot', () => {
  it.each([
    'Twitterbot/1.0',
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    'facebookexternalhit/1.1',
    'SummalyBot/5.0.2',
    'Bluesky Cardyb/1.1',
    'http.rb/5.1.1 (Mastodon/4.2.1; +https://mstdn.example/)',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  ])('リンクプレビュー用クローラーのUAを判定する: %s', (userAgent) => {
    expect(isPreviewBot(userAgent)).toBe(true);
  });

  it('通常ブラウザのUAはクローラー扱いしない', () => {
    expect(
      isPreviewBot('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36'),
    ).toBe(false);
  });

  it('UAヘッダーなしはクローラー扱いしない', () => {
    expect(isPreviewBot(null)).toBe(false);
  });
});

describe('ogLocationLabel', () => {
  it('主要都市の近く（距離二乗1以内）は「都市名付近」にする', () => {
    expect(ogLocationLabel(35.68, 139.68)).toBe('東京付近');
    expect(ogLocationLabel(34.7, 135.5)).toBe('大阪付近');
  });

  it('最寄り都市が複数候補から正しく選ばれる（南端は那覇）', () => {
    expect(ogLocationLabel(26.21, 127.68)).toBe('那覇付近');
  });

  it('主要都市から遠い座標は座標表記にする', () => {
    expect(ogLocationLabel(30, 150)).toBe('緯度30.00・経度150.00');
  });
});

describe('buildOgSummary', () => {
  it('タイトルへ地点・日付・最も厳しい判定を入れる', () => {
    const summary = buildOgSummary(dayForecast(), '東京付近');
    expect(summary.title).toBe('東京付近 8/25の着ぐるみ判定: 危険');
  });

  it('説明文へ天気・最高気温・判定・活動しやすい時間帯の有無・鮮度の注意を入れる', () => {
    const summary = buildOgSummary(dayForecast(), '東京付近');
    expect(summary.description).toContain('8/25の東京付近は晴れ・最高33℃');
    expect(summary.description).toContain('「危険」');
    expect(summary.description).toContain('活動しやすい時間帯があります');
    expect(summary.description).toContain('最新の判定はリンク先で確認してください');
  });

  it('活動しやすい時間帯がない日は「ありません」にする', () => {
    const summary = buildOgSummary(dayForecast({ recommendedHours: [] }), '東京付近');
    expect(summary.description).toContain('活動しやすい時間帯はありません');
  });
});

describe('ogSummaryFor', () => {
  it('トップページ×クローラーUA×有効座標のとき当日サマリーを返す', async () => {
    const today = todayInJst(new Date());
    const summary = await ogSummaryFor(botRequest(), fetchReturning(today));
    expect(summary).not.toBeNull();
    expect(summary!.title).toContain('東京付近');
    expect(summary!.title).toContain('の着ぐるみ判定: ');
    expect(summary!.description).toContain('最新の判定はリンク先で確認してください');
  });

  it('/index.htmlも対象パスとして扱う', async () => {
    const today = todayInJst(new Date());
    const summary = await ogSummaryFor(
      botRequest('/index.html?lat=35.68&lon=139.68'),
      fetchReturning(today),
    );
    expect(summary).not.toBeNull();
  });

  it('トップページ以外のHTMLパスは対象外（上流も呼ばない）', async () => {
    const fetchMock = vi.fn();
    const summary = await ogSummaryFor(
      botRequest('/about?lat=35.68&lon=139.68'),
      fetchMock as unknown as typeof fetch,
    );
    expect(summary).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('通常ブラウザのUAは対象外（上流も呼ばない）', async () => {
    const fetchMock = vi.fn();
    const summary = await ogSummaryFor(
      botRequest('/?lat=35.68&lon=139.68', 'Mozilla/5.0 Chrome/126.0.0.0'),
      fetchMock as unknown as typeof fetch,
    );
    expect(summary).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['/', '座標なし'],
    ['/?lat=35.68', '経度なし'],
    ['/?lat=abc&lon=139.68', '緯度が非数値'],
    ['/?lat=91&lon=139.68', '緯度が範囲外'],
    ['/?lat=35.68&lon=181', '経度が範囲外'],
    ['/?lat=-91&lon=139.68', '緯度が下限未満'],
    ['/?lat=%20&lon=139.68', '緯度が空白のみ'],
  ])('座標が欠落・不正なとき（%s: %s）は対象外', async (path) => {
    const fetchMock = vi.fn();
    const summary = await ogSummaryFor(botRequest(path), fetchMock as unknown as typeof fetch);
    expect(summary).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('demo=1は上流を呼ばずデモデータでサマリーを返す（死活確認用）', async () => {
    const fetchMock = vi.fn();
    const summary = await ogSummaryFor(
      botRequest('/?demo=1&lat=35.68&lon=139.68'),
      fetchMock as unknown as typeof fetch,
    );
    expect(summary).not.toBeNull();
    expect(summary!.title).toContain('東京付近');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('上流データに当日分がないときはnull（静的タグへ退避しログを残す）', async () => {
    const summary = await ogSummaryFor(botRequest(), fetchReturning('2000-01-01'));
    expect(summary).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('対象日の気象データがありません'),
      expect.any(String),
      expect.any(String),
    );
  });

  it('上流の取得失敗はnull（HTML配信を巻き込まずログを残す）', async () => {
    const failingFetch = (async () => {
      throw new TypeError('network down');
    }) as typeof fetch;
    const summary = await ogSummaryFor(botRequest(), failingFetch);
    expect(summary).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      'OGPサマリーの取得に失敗:',
      expect.stringContaining('lat=35.68'),
      expect.anything(),
    );
  });
});
