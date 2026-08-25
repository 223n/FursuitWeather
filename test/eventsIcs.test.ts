// /api/events.ics エンドポイント（events.json→iCalendar変換）のテスト

import { describe, expect, it, vi } from 'vitest';
import { handleEventsCalendar } from '../src/api/events';
import type { AssetsEnv } from '../src/api/assets';
import { parseCalendarEvents } from '../src/logic/events';

/** 検証を通る最小のイベント定義 */
function validEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'けもケット17',
    place: 'TRC東京流通センター',
    zip: '143-0006',
    startDate: '2099-09-20',
    startTime: '12:00',
    endTime: '17:00',
    ...overrides,
  };
}

/** events.jsonを配信するASSETSスタブ環境を作る */
function createEnv(body: unknown, status = 200): AssetsEnv {
  return {
    ASSETS: {
      fetch: vi.fn(async () => new Response(JSON.stringify(body), { status })),
    },
  } as unknown as AssetsEnv;
}

const TODAY = '2026-08-25';

describe('parseCalendarEvents', () => {
  it('有効な項目を通し、endDate省略はstartDateで埋める', () => {
    const events = parseCalendarEvents({ events: [validEvent()] }, TODAY);
    expect(events).toHaveLength(1);
    expect(events[0]!.endDate).toBe('2099-09-20');
  });

  it('形式が不正な項目は黙って除外する（フロントの一覧と同じ基準）', () => {
    const events = parseCalendarEvents(
      {
        events: [
          validEvent(),
          null,
          '文字列',
          validEvent({ name: '' }),
          validEvent({ place: '' }),
          validEvent({ zip: '14-30006' }),
          validEvent({ startDate: '2099-02-30' }),
          validEvent({ endDate: '2099/09/21' }),
          validEvent({ startTime: '24:00' }),
          validEvent({ endTime: 900 }),
        ],
      },
      TODAY,
    );
    expect(events).toHaveLength(1);
  });

  it('終了日が開始日より前の定義と、終了済みイベントは載せない', () => {
    const events = parseCalendarEvents(
      {
        events: [
          validEvent({ name: '逆転', startDate: '2099-09-20', endDate: '2099-09-19' }),
          validEvent({ name: '終了済み', startDate: '2026-08-20', endDate: '2026-08-24' }),
          validEvent({ name: '最終日が今日', startDate: '2026-08-24', endDate: '2026-08-25' }),
        ],
      },
      TODAY,
    );
    expect(events.map((event) => event.name)).toEqual(['最終日が今日']);
  });

  it('開催が近い順に並べ替える（同日開催は定義順を保つ）', () => {
    const events = parseCalendarEvents(
      {
        events: [
          validEvent({ name: '後', startDate: '2099-12-01' }),
          validEvent({ name: '先', startDate: '2099-09-01' }),
          validEvent({ name: '同日2', startDate: '2099-10-01' }),
          validEvent({ name: '同日1', startDate: '2099-10-01' }),
        ],
      },
      TODAY,
    );
    expect(events.map((event) => event.name)).toEqual(['先', '同日2', '同日1', '後']);
  });

  it('bodyがオブジェクトでない・events配列がないときは空にする', () => {
    expect(parseCalendarEvents(null, TODAY)).toEqual([]);
    expect(parseCalendarEvents('text', TODAY)).toEqual([]);
    expect(parseCalendarEvents({ events: 'oops' }, TODAY)).toEqual([]);
  });
});

describe('handleEventsCalendar', () => {
  it('text/calendar（添付ファイル名付き・キャッシュ可）でVEVENTを返す', async () => {
    const env = createEnv({ events: [validEvent()] });
    const response = await handleEventsCalendar(
      new Request('https://example.com/api/events.ics'),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toContain('fursuit-weather-events.ics');
    expect(response.headers.get('Cache-Control')).toContain('max-age');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const body = await response.text();
    expect(body).toContain('BEGIN:VEVENT');
    expect(body).toContain('SUMMARY:けもケット17');
    // リンクはリクエストのオリジンを使う（workers.dev・ローカル開発でもリンク切れしない）
    expect(body).toContain('https://example.com/?event=');
  });

  it('events.jsonはリクエストと同じオリジンのアセットから読む', async () => {
    const assetFetch = vi.fn(
      async (_input: RequestInfo | URL) => new Response(JSON.stringify({ events: [] })),
    );
    const env = { ASSETS: { fetch: assetFetch } } as unknown as AssetsEnv;
    await handleEventsCalendar(new Request('https://example.com/api/events.ics'), env);
    const requested = assetFetch.mock.calls[0]![0] as Request;
    expect(requested.url).toBe('https://example.com/events.json');
  });

  it('アセットが読めないときは例外を投げる（ルーターの500に委ねる）', async () => {
    const env = createEnv({}, 404);
    await expect(
      handleEventsCalendar(new Request('https://example.com/api/events.ics'), env),
    ).rejects.toThrow('events.json');
  });

  it('?event=イベント名で該当の1件だけを返す（参加イベントのみ登録したい人向け）', async () => {
    const env = createEnv({
      events: [validEvent(), validEvent({ name: 'Kemocon 19', zip: '412-0033' })],
    });
    const response = await handleEventsCalendar(
      new Request(`https://example.com/api/events.ics?event=${encodeURIComponent('Kemocon 19')}`),
      env,
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('SUMMARY:Kemocon 19');
    expect(body).not.toContain('SUMMARY:けもケット17');
  });

  it('?event=が未登録の名前なら404を返す（固定リンク・バッジと同じ照合キー）', async () => {
    const env = createEnv({ events: [validEvent()] });
    const response = await handleEventsCalendar(
      new Request('https://example.com/api/events.ics?event=存在しないイベント'),
      env,
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('登録されていません');
  });
});
