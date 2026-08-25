// 埋め込みバッジ（/api/badge.svg）のテスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleBadge } from '../src/api/badge';
import type { AssetsEnv } from '../src/api/assets';
import { badgeStatusText, buildBadgeSvg } from '../src/logic/badge';
import { todayInJst } from '../src/logic/time';
import type { LevelSummary } from '../src/types';

/** テスト用の判定サマリー */
function summary(overrides: Partial<LevelSummary> = {}): LevelSummary {
  return { level: 'severe', label: '厳重警戒', grade: 3, ...overrides };
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

/** events.jsonを配信するASSETSスタブ環境を作る */
function createEnv(body: unknown = { events: [] }, status = 200): AssetsEnv {
  return {
    ASSETS: {
      fetch: vi.fn(async () => new Response(JSON.stringify(body), { status })),
    },
  } as unknown as AssetsEnv;
}

/** URLに応じて気象・地点検索・郵便番号の上流を出し分けるfetchモックを立てる */
function stubUpstreams(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('zipcloud')) {
        return new Response(
          JSON.stringify({ results: [{ address1: '東京都', address2: '大田区', address3: '' }] }),
          { status: 200 },
        );
      }
      if (url.includes('geocoding-api')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                name: '大田区',
                admin1: '東京都',
                latitude: 35.56,
                longitude: 139.72,
                country_code: 'JP',
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(openMeteoBody(todayInJst(new Date()))), { status: 200 });
    }),
  );
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('badgeStatusText', () => {
  it.each([
    [0, 'safe', 'ほぼ安全', '◎ ほぼ安全'],
    [1, 'caution', '注意', '○ 注意'],
    [2, 'warning', '警戒', '△ 警戒'],
    [3, 'severe', '厳重警戒', '✕ 厳重警戒'],
  ] as const)('grade %iは記号+ラベルを返す', (grade, level, label, expected) => {
    expect(badgeStatusText(summary({ grade, level, label }))).toBe(expected);
  });

  it('暑熱の「危険」は着用中止を文字で明示する', () => {
    expect(badgeStatusText(summary({ grade: 4, level: 'danger', label: '危険' }))).toBe(
      '✕ 危険・着用中止',
    );
  });

  it('低温危険には着用中止の接尾辞を付けない（ラベル自体が低温危険）', () => {
    expect(badgeStatusText(summary({ grade: 4, level: 'coldDanger', label: '低温危険' }))).toBe(
      '✕ 低温危険',
    );
  });

});

describe('buildBadgeSvg', () => {
  it('gradeに応じたCUD配色（背景・文字・枠線）で描画する', () => {
    const svg = buildBadgeSvg(summary({ grade: 3, level: 'severe', label: '厳重警戒' }));
    expect(svg).toContain('#FBE3DD');
    expect(svg).toContain('#99260C');
    expect(svg).toContain('#CC3311');
  });

  it('低温側判定は青系配色+雪結晶マークで暑熱側と区別する（色+形の二重符号）', () => {
    const svg = buildBadgeSvg(summary({ grade: 1, level: 'coldCaution', label: '低温注意' }));
    // 配色はサイト本体の--level-cold-*（BADGE.cold。htmlSyncテストでも同期検証）
    expect(svg).toContain('#E1EFF8');
    expect(svg).toContain('#005180');
    expect(svg).toContain('#0072B2');
    // 暑熱側のgrade 1配色にならない
    expect(svg).not.toContain('#FCF0D8');
    // 雪結晶マーク（形の区別。stroke付きのパス）
    expect(svg).toContain('stroke-linecap="round"');
    // 暑熱側には雪結晶を描かない
    expect(
      buildBadgeSvg(summary({ grade: 1, level: 'caution', label: '注意' })),
    ).not.toContain('stroke-linecap');
  });

  it('左ラベルと判定文を含み、role=img+aria-label+titleで読み上げに対応する', () => {
    const svg = buildBadgeSvg(summary());
    expect(svg).toContain('着ぐるみ判定');
    expect(svg).toContain('✕ 厳重警戒');
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="着ぐるみ判定: ✕ 厳重警戒"');
    expect(svg).toContain('<title>着ぐるみ判定: ✕ 厳重警戒</title>');
  });

  it('ラベルのXML特殊文字をエスケープする（判定文言経由の注入を防ぐ）', () => {
    const svg = buildBadgeSvg(summary({ label: '<script>&"\'' }));
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;&amp;&quot;&apos;');
  });

  it('スクリプト実行要素を含まない', () => {
    const svg = buildBadgeSvg(summary());
    expect(svg).not.toMatch(/on[a-z]+=/);
    expect(svg).not.toContain('href');
  });
});

describe('handleBadge', () => {
  it('demo=1は上流を呼ばずデモデータのバッジを返す（表示確認用）', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await handleBadge(
      new Request('https://example.com/api/badge.svg?demo=1'),
      createEnv(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toContain('max-age');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await response.text()).toContain('着ぐるみ判定');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('city=主要都市名で当日判定のバッジを返す', async () => {
    stubUpstreams();
    const response = await handleBadge(
      new Request('https://example.com/api/badge.svg?city=東京'),
      createEnv(),
    );
    expect(response.status).toBe(200);
    const svg = await response.text();
    expect(svg).toContain('<svg');
    expect(svg).toContain('着ぐるみ判定');
  });

  it('event=登録済みイベント名は郵便番号から開催地を解決してバッジを返す', async () => {
    stubUpstreams();
    const env = createEnv({
      events: [
        {
          name: 'けもケット17',
          place: 'TRC東京流通センター',
          zip: '143-0006',
          startDate: '2020-09-20',
        },
      ],
    });
    const response = await handleBadge(
      new Request(`https://example.com/api/badge.svg?event=${encodeURIComponent('けもケット17')}`),
      env,
    );
    // 終了済みイベントでも解決できる（告知ページに貼られたまま残るため）
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<svg');
  });

  it('cityとeventの両方指定・両方欠落は400を返す', async () => {
    for (const query of ['', '?city=東京&event=けもケット17']) {
      const response = await handleBadge(
        new Request(`https://example.com/api/badge.svg${query}`),
        createEnv(),
      );
      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it('主要都市にない都市名は400を返す（任意座標の封じ込め）', async () => {
    const response = await handleBadge(
      new Request('https://example.com/api/badge.svg?city=パリ'),
      createEnv(),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('主要都市名');
  });

  it('空・100文字超のイベント名は400を返す', async () => {
    for (const name of ['', 'あ'.repeat(101)]) {
      const response = await handleBadge(
        new Request(`https://example.com/api/badge.svg?event=${encodeURIComponent(name)}`),
        createEnv(),
      );
      expect(response.status).toBe(400);
    }
  });

  it('登録されていないイベント名は404を返す', async () => {
    const response = await handleBadge(
      new Request('https://example.com/api/badge.svg?event=未登録イベント'),
      createEnv({ events: [] }),
    );
    expect(response.status).toBe(404);
  });

  it('開催地の座標を解決できないときは404を返す', async () => {
    // 地点検索が0件（zipcloudも地名検索も候補なし）のケース
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 })),
    );
    const env = createEnv({
      events: [{ name: '孤島イベント', place: '孤島', zip: '999-9999', startDate: '2099-01-01' }],
    });
    const response = await handleBadge(
      new Request('https://example.com/api/badge.svg?event=孤島イベント'),
      env,
    );
    expect(response.status).toBe(404);
  });

  it('上流データに当日分がないときはUpstreamErrorを投げる（ルーターの502に委ねる）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(openMeteoBody('2000-01-01')), { status: 200 })),
    );
    await expect(
      handleBadge(new Request('https://example.com/api/badge.svg?city=東京'), createEnv()),
    ).rejects.toThrow('気象データがありません');
  });

  it('events.jsonが読めないときは例外を投げる（ルーターの500に委ねる）', async () => {
    await expect(
      handleBadge(
        new Request('https://example.com/api/badge.svg?event=けもケット17'),
        createEnv({}, 500),
      ),
    ).rejects.toThrow('events.json');
  });
});
